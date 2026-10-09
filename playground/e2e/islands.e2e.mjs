// End-to-end tests for interactive components (islands, docs/decisions/0030-islands.md) with the
// playground's Preact Counter (`client: 'visible'`): it hydrates on the canvas after being added
// (live update, no reload) and works for visitors once published.
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import {
	BASE,
	db,
	homePageId,
	login,
	openEditor,
	resetToDemo,
	saveAndWait,
	step,
	summary,
	working,
} from './helpers.mjs';

const pageId = await homePageId();

const settled = (page) =>
	page.waitFor(() => !document.querySelector('[data-tapestry-canvas]')?.hasAttribute('data-tapestry-pending'), [], {
		message: 'canvas settled',
	});

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let visitor;

try {
	const cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('the demo page (no islands) ships no island scripts', async () => {
		await resetToDemo(page, pageId);
		const html = await (await fetch(`${BASE}/`)).text();
		assert.doesNotMatch(html, /<astro-island/);
		assert.doesNotMatch(html, /astro-island|client:visible|renderer-url/);
	});

	let id;
	await step('add a Counter: it hydrates on the canvas after the live update', async () => {
		await openEditor(page, pageId);
		await page.click('.tp-library__item[title^="Add Counter "]');
		id = await page.waitFor(() => {
			const row = document.querySelector('.tp-row[aria-selected="true"]');
			return row?.dataset.tpRow?.startsWith('counter') && row.dataset.tpRow;
		});
		await settled(page);
		// client:visible: bring it into view in the canvas, then wait for hydration (Astro drops `ssr`).
		await page.waitFor(
			(nodeId) => {
				const doc = document.querySelector('[data-tapestry-canvas]').contentDocument;
				const island = doc.querySelector(`[data-tapestry-node="${nodeId}"] astro-island`);
				island?.scrollIntoView({ block: 'center' });
				return Boolean(island && !island.hasAttribute('ssr'));
			},
			[id],
			{ message: 'island hydrated on the canvas', timeout: 15_000 },
		);
		const node = (await working(page)).root
			.flatMap(function all(n) {
				return [n, ...(n.children ?? []).flatMap(all)];
			})
			.find((n) => n.id === id);
		assert.deepEqual(node.props, { label: 'Label', initial: 0 });
		assert.equal(node.version, 2, 'new nodes carry the current component version');
	});

	await step('publish; a visitor gets the server-rendered counter, and it works', async () => {
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		visitor = await cdp.page({ isolated: true });
		await visitor.goto(`${BASE}/`);
		const ssr = await visitor.eval(() => document.querySelector('.counter__value')?.textContent);
		assert.equal(ssr, '0', 'rendered on the server');
		await visitor.eval(() => document.querySelector('.counter').scrollIntoView({ block: 'center' }));
		await visitor.waitFor(() => !document.querySelector('astro-island')?.hasAttribute('ssr'), [], {
			message: 'hydrated for the visitor',
			timeout: 15_000,
		});
		await visitor.click('.counter__button[aria-label$="increase"]');
		await visitor.click('.counter__button[aria-label$="increase"]');
		await visitor.waitFor(() => document.querySelector('.counter__value').textContent === '2', [], {
			message: 'counter incremented',
		});
		assert.deepEqual(visitor.errors, []);
	});

	await step('content still cannot add scripts: text and links stay inert on a Tapestry page', async () => {
		const slug = 'e2e-islands-xss';
		const api = (method, path, body) =>
			fetch(`${BASE}/studiocms_api/dashboard${path}`, {
				method,
				headers: { Origin: BASE, 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
				body: JSON.stringify(body),
			});
		const created = await api('POST', '/content/page', {
			title: 'XSS probe',
			slug,
			description: 'x',
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
		assert.equal(created.status, 200);
		const row = (await db.execute({ sql: 'select id from StudioCMSPageData where slug = ?', args: [slug] })).rows[0];
		try {
			const evil = '</h2><script>window.__pwned=1</script><img src=x onerror=alert(1)>';
			const doc = {
				version: 1,
				root: [
					{ id: 'h', type: 'heading', props: { text: evil } },
					{ id: 'b', type: 'button', props: { label: evil, href: 'javascript:alert(1)' } },
					{ id: 'c', type: 'counter', props: { label: '<script>window.__pwned=1</script>' } }, // ≤ 60 characters
				],
			};
			const stored = { version: 2, published: doc, publishedAt: new Date().toISOString(), draft: null, history: [] };
			await db.execute({
				sql: 'update StudioCMSPageContent set content = ? where contentId = ?',
				args: [JSON.stringify(stored), String(row.id)],
			});
			const html = await (await fetch(`${BASE}/${slug}`)).text();
			assert.doesNotMatch(html, /<script>window\.__pwned/);
			assert.doesNotMatch(html, /<img src=x/i);
			assert.doesNotMatch(html, /href="javascript:/i);
			assert.match(html, /&lt;script&gt;window\.__pwned=1&lt;\/script&gt;/, 'shown as text');
			// The island's props are serialized data, not markup.
			assert.match(html, /<astro-island[^>]*props="[^"]*__pwned/);
		} finally {
			await api('DELETE', '/content/page', { id: String(row.id), slug });
		}
	});

	await step('no uncaught errors in the editor', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Islands suite');
} catch (error) {
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	if (visitor?.errors.length) console.error('Visitor errors:', visitor.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
}
