// End-to-end tests for the public site: draft visibility, cache headers, and
// the admin bar (see docs/admin-bar.md).
//
// Prereqs: same as editor.e2e.mjs. Creates a throwaway draft page
// ("e2e-draft") and deletes it afterwards.
import assert from 'node:assert/strict';
import { demoDocument } from '../scripts/demo-document.mjs';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, db, get, login, SHOTS, step, summary } from './helpers.mjs';

const DRAFT_ID = 'e2e-draft-page';
const DRAFT_SLUG = 'e2e-draft';

async function createDraftPage() {
	const author = (await db.execute('select id from StudioCMSUsersTable limit 1')).rows[0]?.id;
	const now = new Date().toISOString();
	await db.batch(
		[
			{ sql: 'delete from StudioCMSPageContent where contentId = ?', args: [DRAFT_ID] },
			{ sql: 'delete from StudioCMSPageData where id = ?', args: [DRAFT_ID] },
			{
				sql: `insert into StudioCMSPageData
					(id, package, title, description, showOnNav, publishedAt, updatedAt, slug, contentLang, authorId, draft)
					values (?, 'tapestry/canvas', 'E2E draft', 'Draft page used by the e2e suite', 0, ?, ?, ?, 'default', ?, 1)`,
				args: [DRAFT_ID, now, now, DRAFT_SLUG, author],
			},
			{
				sql: `insert into StudioCMSPageContent (id, contentId, contentLang, content) values (?, ?, 'default', ?)`,
				args: [`${DRAFT_ID}-content`, DRAFT_ID, JSON.stringify(demoDocument)],
			},
		],
		'write',
	);
}

async function deleteDraftPage() {
	await db.batch(
		[
			{ sql: 'delete from StudioCMSPageContent where contentId = ?', args: [DRAFT_ID] },
			{ sql: 'delete from StudioCMSPageData where id = ?', args: [DRAFT_ID] },
		],
		'write',
	);
}

const homeId = String((await db.execute("select id from StudioCMSPageData where slug = 'index'")).rows[0]?.id);
await createDraftPage();
const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;

try {
	const cookie = await login();

	await step('anonymous: public page has no admin bar, no StudioCMS corner menu, no bar CSS', async () => {
		const response = await get('/');
		assert.equal(response.status, 200);
		const html = await response.text();
		assert.doesNotMatch(html, /tapestry-adminbar/);
		assert.doesNotMatch(html, /user-quick-tools/);
		assert.equal(response.headers.get('cache-control'), null);
	});

	await step('anonymous: draft page is a 404', async () => {
		assert.equal((await get(`/${DRAFT_SLUG}`)).status, 404);
	});

	await step('forged session cookie is treated as anonymous', async () => {
		assert.equal((await get(`/${DRAFT_SLUG}`, 'not-a-real-session')).status, 404);
		assert.doesNotMatch(await (await get('/', 'not-a-real-session')).text(), /data-tapestry-adminbar/);
	});

	await step('editor: draft page renders with Draft badge, noindex and private caching', async () => {
		const response = await get(`/${DRAFT_SLUG}`, cookie);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
		assert.equal(response.headers.get('cache-control'), 'private, no-store');
		const html = await response.text();
		assert.match(html, /data-tapestry-adminbar/);
		assert.match(html, /status--draft/);
	});

	await step('editor: published page shows the bar with an Edit link to that page', async () => {
		const response = await get('/', cookie);
		assert.equal(response.headers.get('cache-control'), 'private, no-store');
		const html = await response.text();
		assert.match(html, new RegExp(`href="/dashboard/content-management/edit\\?edit=${homeId}"`));
		assert.match(html, /status--published/);
	});

	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('browser: bar is the first thing on the page and stays at the top when scrolling', async () => {
		await page.goto(`${BASE}/`);
		const box = await page.eval(() => {
			const bar = document.querySelector('[data-tapestry-adminbar]');
			return { top: bar.getBoundingClientRect().top, height: bar.getBoundingClientRect().height };
		});
		assert.equal(box.top, 0);
		assert.ok(box.height >= 40);
		await page.eval(() => window.scrollTo(0, 400));
		assert.equal(
			await page.eval(() => document.querySelector('[data-tapestry-adminbar]').getBoundingClientRect().top),
			0,
		);
		await page.eval(() => window.scrollTo(0, 0));
		// Site link styles (`.site a`) must not recolor the bar's links.
		assert.equal(
			await page.eval(
				() => getComputedStyle(document.querySelector('[data-tapestry-adminbar] a[href$="/logout"]')).color,
			),
			'rgb(244, 244, 248)',
		);
		// The inline <style> must not render as visible text.
		assert.doesNotMatch(await page.eval(() => document.body.innerText), /all: initial/);
		if (SHOTS) await page.screenshot(`${SHOTS}/adminbar.png`);
	});

	await step('browser: "Edit page" opens the Tapestry editor for this page', async () => {
		const loaded = cdp.waitForEvent('Page.loadEventFired', () => true, 30_000);
		await page.click('[data-tapestry-edit]');
		await loaded;
		assert.equal(
			await page.eval(() => location.pathname + location.search),
			`/dashboard/content-management/edit?edit=${homeId}`,
		);
		await page.waitFor(() => document.querySelector('.tp-editor'), [], { message: 'editor mounted' });
	});

	await step('editor: "View page" links back to the public page', async () => {
		assert.equal(await page.eval(() => document.querySelector('[data-tapestry-view]')?.getAttribute('href')), '/');
	});

	await step('dashboard light mode stays readable (site CSS must not restyle the dashboard)', async () => {
		// In dev, StudioCMS dashboard pages load every site page's global CSS
		// (docs/known-issues.md #14); site styles must be scoped so they can't win.
		await page.goto(`${BASE}/dashboard/content-management/edit?edit=${homeId}`);
		await page.click('#studiocms-theme-toggle');
		await page.waitFor(() => document.documentElement.dataset.theme === 'light');
		const worst = await page.eval(() => {
			const channels = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
			const luminance = (c) => {
				const [r, g, b] = channels(c).map((v) => {
					const x = v / 255;
					return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
				});
				return 0.2126 * r + 0.7152 * g + 0.0722 * b;
			};
			const background = (el) => {
				for (let e = el; e; e = e.parentElement) {
					const c = getComputedStyle(e).backgroundColor;
					if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
				}
				return 'rgb(255, 255, 255)';
			};
			const results = [];
			for (const el of document.querySelectorAll('h1, [role="tab"], label')) {
				if (!el.offsetParent || !el.textContent.trim()) continue;
				const [a, b] = [luminance(getComputedStyle(el).color), luminance(background(el))].sort((x, y) => y - x);
				results.push({ text: el.textContent.trim().slice(0, 30), ratio: (a + 0.05) / (b + 0.05) });
			}
			return results.sort((x, y) => x.ratio - y.ratio)[0];
		});
		assert.ok(worst.ratio >= 4.5, `low contrast in light mode: "${worst.text}" ${worst.ratio.toFixed(2)}:1`);
		await page.click('#studiocms-theme-toggle');
	});

	await step('"Log out" in the bar ends the session', async () => {
		await page.goto(`${BASE}/`);
		const loaded = cdp.waitForEvent('Page.loadEventFired', () => true, 30_000);
		await page.eval(() => document.querySelector('[data-tapestry-adminbar] a[href$="/logout"]').click());
		await loaded;
		await page.waitFor(() => !location.pathname.endsWith('/logout'), [], {
			timeout: 10_000,
			message: 'logout redirect',
		});
		assert.doesNotMatch(await (await get('/', cookie)).text(), /data-tapestry-adminbar/);
		assert.equal((await get(`/${DRAFT_SLUG}`, cookie)).status, 404);
	});

	await step('anonymous: public pages log nothing in the console; missing pages get the site 404', async () => {
		// A logged-out tab (own cookies) recording console messages (all but debug), browser
		// log entries (failed requests, policy warnings) and exceptions.
		const visitor = await cdp.page({ isolated: true });
		await visitor.send('Log.enable');
		const messages = [];
		cdp.on(({ method, params, sessionId }) => {
			if (sessionId !== visitor.sessionId) return;
			if (method === 'Runtime.consoleAPICalled' && params.type !== 'debug')
				messages.push(`console.${params.type}: ${params.args.map((a) => a.value ?? a.description).join(' ')}`);
			if (method === 'Runtime.exceptionThrown') messages.push(`exception: ${params.exceptionDetails.text}`);
			if (method === 'Log.entryAdded' && params.entry.level !== 'verbose')
				messages.push(`${params.entry.level}: ${params.entry.text} ${params.entry.url ?? ''}`);
		});
		await visitor.goto(`${BASE}/`);
		await new Promise((r) => setTimeout(r, 1500));
		assert.equal(await visitor.eval(() => Boolean(document.querySelector('#tapestry-adminbar'))), false, 'logged out');
		assert.deepEqual(messages, [], 'home page console');
		await visitor.goto(`${BASE}/no-such-page-e2e`);
		await new Promise((r) => setTimeout(r, 500));
		// The page's own 404 status is the only expected entry.
		assert.deepEqual(
			messages.filter((m) => !m.includes('/no-such-page-e2e')),
			[],
			'404 page console',
		);
		const notFound = await visitor.eval(() => ({
			title: document.title,
			dashboardMarkup: Boolean(document.querySelector('form[id^="create-new-user"], [id^="create-user-invite"]')),
			size: document.documentElement.outerHTML.length,
		}));
		assert.equal(notFound.title, 'Page not found');
		assert.equal(notFound.dashboardMarkup, false, 'no dashboard markup on the public 404 page');
		assert.ok(notFound.size < 20_000, `404 page is small (${notFound.size} bytes)`);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Site suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/site-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	cdp.close();
	await chrome.close();
	await deleteDraftPage();
	db.close();
}
