// End-to-end tests for component migrations (docs/decisions/0031-migrations.md): a page saved
// with version 1 of the playground's Counter (prop `start`) is upgraded to version 2 (`initial`)
// when visitors see it and when the editor opens it, and saved in the new shape after an edit.
//
// Prereqs: same as editor.e2e.mjs. Creates a throwaway page ("e2e-migrations") and deletes it.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, db, login, openEditor, saveAndWait, step, storedContent, summary } from './helpers.mjs';

const SLUG = 'e2e-migrations';
const oldDocument = {
	version: 1,
	root: [{ id: 'counter-old', type: 'counter', props: { label: 'Legacy', start: 7 } }],
};

async function api(cookie, method, path, body) {
	const response = await fetch(`${BASE}/studiocms_api/dashboard${path}`, {
		method,
		headers: { Origin: BASE, 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
		body: JSON.stringify(body),
	});
	return { status: response.status, body: await response.text() };
}

const pageRow = async () =>
	(await db.execute({ sql: 'select id from StudioCMSPageData where slug = ?', args: [SLUG] })).rows[0];

async function cleanup(cookie) {
	const row = await pageRow();
	if (row) await api(cookie, 'DELETE', '/content/page', { id: String(row.id), slug: SLUG });
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let cookie;
let pageId;

try {
	cookie = await login();
	await cleanup(cookie);
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('a page saved with Counter version 1 renders upgraded for visitors', async () => {
		const created = await api(cookie, 'POST', '/content/page', {
			title: 'E2E migrations',
			slug: SLUG,
			description: 'Throwaway page for the migrations suite',
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
		assert.equal(created.status, 200, created.body);
		pageId = String((await pageRow()).id);
		// Stored before the page is first requested, so StudioCMS's cache has nothing stale.
		const stored = {
			version: 2,
			published: oldDocument,
			publishedAt: new Date().toISOString(),
			draft: null,
			history: [],
		};
		await db.execute({
			sql: 'update StudioCMSPageContent set content = ? where contentId = ?',
			args: [JSON.stringify(stored), pageId],
		});
		const html = await (await fetch(`${BASE}/${SLUG}`)).text();
		assert.match(html, /<output class="counter__value"[^>]*>7<\/output>/, 'the old `start` reached the new `initial`');
		assert.match(html, /<astro-island[^>]*props="[^"]*initial/);
	});

	await step('the editor shows the upgraded props', async () => {
		await openEditor(page, pageId);
		await page.click('[data-tp-row="counter-old"] .tp-row__label');
		const value = await page.waitFor(
			() => document.querySelector('#tp-field-counter-old-initial')?.value || false,
			[],
			{ message: 'the "Starts at" field' },
		);
		assert.equal(value, '7');
	});

	await step('after an edit, the page is saved with version 2 and the new prop name', async () => {
		await page.fill('#tp-field-counter-old-label', 'Upgraded');
		await saveAndWait(page, pageId);
		const stored = JSON.parse(await storedContent(pageId));
		assert.equal(
			JSON.stringify(stored.draft.root[0]),
			'{"id":"counter-old","type":"counter","version":2,"props":{"label":"Upgraded","initial":7}}',
		);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Migrations suite');
} catch (error) {
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (cookie) await cleanup(cookie).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
	db.close();
}
