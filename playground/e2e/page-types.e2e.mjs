// End-to-end checks that other StudioCMS page types (here: Markdown)
// work alongside Tapestry: each can be created, opens its own editor (not
// Tapestry's), and renders on the site through getPage() with the admin bar.
// Also checks the create form's default page type is a real option
// (docs/known-issues.md #15).
//
// Creates throwaway pages (slugs "e2e-type-*") and deletes them afterwards.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, db, get, login, step, summary } from './helpers.mjs';

const TYPES = [
	// `editor`: the element each plugin's editor creates once it has really loaded.
	{
		key: 'markdown',
		package: 'studiocms/markdown',
		editor: '.TinyMDE',
		content: '# Hello from Markdown\n\nSome *emphasis*.',
		expect: /<h1[^>]*>Hello from Markdown<\/h1>/,
	},
];
const slugFor = (t) => `e2e-type-${t.key}`;

async function api(method, path, cookie, body) {
	const response = await fetch(`${BASE}/studiocms_api/dashboard${path}`, {
		method,
		headers: { Origin: BASE, 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
		body: body && JSON.stringify(body),
	});
	return { status: response.status, body: await response.text() };
}

async function pageBySlug(slug) {
	return (await db.execute({ sql: 'select id, package from StudioCMSPageData where slug = ?', args: [slug] })).rows[0];
}

async function cleanup(cookie) {
	for (const type of TYPES) {
		const row = await pageBySlug(slugFor(type));
		if (row) await api('DELETE', '/content/page', cookie, { id: String(row.id), slug: slugFor(type) });
	}
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let cookie;

try {
	cookie = await login();
	await cleanup(cookie);
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('create form offers all page types and its default is a real option', async () => {
		await page.goto(`${BASE}/dashboard/content-management/create`);
		const select = await page.eval(() => {
			const field = document.querySelector('[name="page-type"]');
			const options = [
				...document.querySelectorAll('[id^="page-type"] [role="option"], select[name="page-type"] option'),
			].map((o) => o.getAttribute('value') ?? o.dataset.value ?? o.textContent.trim());
			return { value: field?.value, options };
		});
		assert.equal(select.value, 'studiocms/markdown');
		for (const expected of ['studiocms/markdown', 'tapestry/canvas']) {
			assert.ok(
				select.options.some((o) => o.includes(expected)),
				`missing page type ${expected} in ${select.options}`,
			);
		}
	});

	for (const type of TYPES) {
		await step(`${type.key}: create via the dashboard API`, async () => {
			// Same fields the dashboard's create form sends, in the API's encoded form
			// (booleans as numbers, arrays as JSON strings).
			const created = await api('POST', '/content/page', cookie, {
				title: `E2E ${type.key}`,
				slug: slugFor(type),
				description: `Throwaway ${type.key} page`,
				package: type.package,
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
			const row = await pageBySlug(slugFor(type));
			assert.equal(row?.package, type.package);
			if (type.content) {
				// Content goes straight to the database before the page is first requested
				// (so StudioCMS's page cache has nothing stale).
				await db.execute({
					sql: 'update StudioCMSPageContent set content = ? where contentId = ?',
					args: [type.content, String(row.id)],
				});
			}
		});

		await step(`${type.key}: dashboard shows its own editor, not Tapestry's`, async () => {
			const row = await pageBySlug(slugFor(type));
			await page.goto(`${BASE}/dashboard/content-management/edit?edit=${row.id}`);
			await page.waitFor(() => document.querySelector('.page-content-editor'), [], { message: 'edit page loaded' });
			await page.eval(() =>
				[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes('Page Content'))?.click(),
			);
			await page.waitFor((selector) => document.querySelector(selector), [type.editor], {
				timeout: 15_000,
				message: `${type.key} editor (${type.editor}) loaded`,
			});
			const info = await page.eval(() => ({
				tapestry: Boolean(document.querySelector('.tp-editor, [data-tapestry-editor]')),
				editorArea: document.querySelector('.page-content-editor')?.children.length ?? 0,
				error: /Unable to render|undefined!/.test(document.body.innerText),
			}));
			assert.equal(info.tapestry, false);
			assert.equal(info.error, false);
			assert.ok(info.editorArea > 0, 'editor area is empty');
		});

		await step(`${type.key}: renders on the site via getPage(), with the admin bar for editors only`, async () => {
			const asEditor = await get(`/${slugFor(type)}`, cookie);
			assert.equal(asEditor.status, 200);
			const html = await asEditor.text();
			assert.match(html, /data-tapestry-adminbar/);
			if (type.expect) assert.match(html, type.expect);
			const anonymous = await get(`/${slugFor(type)}`);
			assert.equal(anonymous.status, 200);
			assert.doesNotMatch(await anonymous.text(), /data-tapestry-adminbar/);
		});
	}

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Page types suite');
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
