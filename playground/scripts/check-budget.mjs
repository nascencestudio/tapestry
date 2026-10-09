// Performance budget for public pages (docs/decisions/0034-accessibility-and-performance.md).
//
// Measures what an anonymous visitor downloads from a running **production** server (dev output
// isn't representative): the HTML, every stylesheet and script (inline and linked, same-origin),
// all gzipped, and the number of requests. Compares with perf-budget.json and exits 1 when a page
// is over budget.
//
// Pages: the demo home page (no islands), and a throwaway page with one Counter island (created
// through StudioCMS's API with the e2e login, deleted afterwards).
//
// Usage: build, start the server (e.g. `node dist/server/entry.mjs` with the site's env and PORT),
// then `BASE_URL=http://localhost:4600 node scripts/check-budget.mjs`.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { BASE, db, login } from '../e2e/helpers.mjs';

const budget = JSON.parse(readFileSync(new URL('../perf-budget.json', import.meta.url), 'utf8'));
const gz = (text) => gzipSync(Buffer.from(text)).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

async function text(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.text();
}

/** What a visitor downloads for one page (gzipped bytes) and how many requests it takes. */
async function measure(path) {
	const url = new URL(path, BASE);
	const html = await text(url);
	const attr = (tag, name) => new RegExp(`\\s${name}=["']?([^"'\\s>]+)`).exec(tag)?.[1];
	const sameOrigin = (href) => {
		const resolved = new URL(href, url);
		return resolved.origin === url.origin ? resolved : null;
	};
	let css = 0;
	let js = 0;
	let requests = 1;
	for (const [, style] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css += gz(style);
	for (const [tag] of html.matchAll(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi)) {
		const href = attr(tag, 'href');
		const resolved = href && sameOrigin(href);
		requests++;
		if (resolved) css += gz(await text(resolved));
	}
	const seen = new Set();
	const addScript = async (resolved) => {
		if (seen.has(resolved.href)) return;
		seen.add(resolved.href);
		requests++;
		const source = await text(resolved);
		js += gz(source);
		// Module imports (islands load the component, the framework and Astro's client).
		for (const [, spec] of source.matchAll(/(?:import|from)\s*\(?\s*["']([^"']+\.m?js)["']/g)) {
			const next = sameOrigin(new URL(spec, resolved).href);
			if (next) await addScript(next);
		}
	};
	for (const [tag, inline] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
		const src = attr(tag, 'src');
		if (src) {
			const resolved = sameOrigin(src);
			if (resolved) await addScript(resolved);
			else requests++;
		} else if (inline.trim()) {
			js += gz(inline);
		}
	}
	// Island code is loaded when it hydrates: count it as the page's JavaScript.
	for (const [tag] of html.matchAll(/<astro-island\b[^>]*>/gi)) {
		for (const name of ['component-url', 'renderer-url']) {
			const value = attr(tag, name);
			const resolved = value && sameOrigin(value);
			if (resolved) await addScript(resolved);
		}
	}
	for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) if (attr(tag, 'src')) requests++;
	return { html: gz(html), css, js, requests };
}

async function withIslandPage(run) {
	const cookie = await login();
	const api = (method, path, body) =>
		fetch(`${BASE}/studiocms_api/dashboard${path}`, {
			method,
			headers: { Origin: BASE, 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
			body: JSON.stringify(body),
		});
	const slug = 'budget-island';
	const pageRow = async () =>
		(await db.execute({ sql: 'select id from StudioCMSPageData where slug = ?', args: [slug] })).rows[0];
	const old = await pageRow();
	if (old) await api('DELETE', '/content/page', { id: String(old.id), slug });
	await api('POST', '/content/page', {
		title: 'Budget: island',
		slug,
		description: 'Throwaway page for the performance budget',
		package: 'tapestry/canvas',
		showOnNav: 0,
		draft: 0,
		showAuthor: 0,
		showContributors: 0,
		categories: '[]',
		tags: '[]',
		augments: '[]',
		heroImage: '',
		parentFolder: null,
	});
	const id = String((await pageRow()).id);
	const doc = { version: 1, root: [{ id: 'c', type: 'counter', version: 2, props: { label: 'Likes' } }] };
	await db.execute({
		sql: 'update StudioCMSPageContent set content = ? where contentId = ?',
		args: [
			JSON.stringify({ version: 2, published: doc, publishedAt: new Date().toISOString(), draft: null, history: [] }),
			id,
		],
	});
	try {
		return await run(`/${slug}`);
	} finally {
		await api('DELETE', '/content/page', { id, slug });
	}
}

const results = {
	home: await measure('/'),
	island: await withIslandPage(measure),
};
db.close();

let failed = false;
for (const [page, measured] of Object.entries(results)) {
	const limits = budget[page] ?? {};
	console.log(`\n${page}`);
	for (const metric of ['html', 'css', 'js', 'requests']) {
		const value = measured[metric];
		const limit = limits[metric];
		const over = limit !== undefined && value > limit;
		failed ||= over;
		const show = (v) => (metric === 'requests' ? String(v) : kb(v));
		console.log(
			`  ${over ? '✗' : '✓'} ${metric.padEnd(8)} ${show(value).padStart(9)}${limit !== undefined ? `  (budget ${show(limit)})` : ''}`,
		);
	}
}
if (failed) {
	console.error('\nOver the performance budget (perf-budget.json). Find what grew, or raise the budget with a reason.');
	process.exit(1);
}
console.log('\nWithin the performance budget.');
