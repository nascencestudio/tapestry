// End-to-end tests for translations (docs/decisions/0032-translations.md), with the playground's
// languages ['en', 'fr']: creating the French version from the editor's translations menu,
// visibility (unpublished translations stay hidden), `<html lang>`, hreflang links and the
// language switcher, and page links that follow the current language.
//
// Prereqs: same as editor.e2e.mjs. Creates throwaway pages ("e2e-tr-*", "fr/e2e-tr-*") and
// deletes them (and their translation rows) afterwards.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, db, login, openEditor, saveAndWait, step, storedContent, summary } from './helpers.mjs';

const SOURCE = 'e2e-tr-source';
const TARGET = 'e2e-tr-target';

async function api(cookie, method, path, body, origin = BASE) {
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: response.status, body: await response.text() };
}

const pageBySlug = async (slug) =>
	(await db.execute({ sql: 'select id, title, slug from StudioCMSPageData where slug = ?', args: [slug] })).rows[0];

async function cleanup(cookie) {
	const rows = (
		await db.execute({
			sql: "select id, slug from StudioCMSPageData where slug like 'e2e-tr-%' or slug like 'fr/e2e-tr-%'",
			args: [],
		})
	).rows;
	for (const row of rows) {
		await api(cookie, 'DELETE', '/studiocms_api/dashboard/content/page', { id: String(row.id), slug: row.slug });
		await db.execute({
			sql: 'delete from StudioCMSPluginData where id = ?',
			args: [`@nascencestudio/tapestry-language:${row.id}`],
		});
	}
}

/** A published Tapestry page with the given document (stored before it's first requested). */
async function createPage(cookie, slug, title, doc) {
	const created = await api(cookie, 'POST', '/studiocms_api/dashboard/content/page', {
		title,
		slug,
		description: 'Throwaway page for the translations suite',
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
	const id = String((await pageBySlug(slug)).id);
	const stored = { version: 2, published: doc, publishedAt: new Date().toISOString(), draft: null, history: [] };
	await db.execute({
		sql: 'update StudioCMSPageContent set content = ? where contentId = ?',
		args: [JSON.stringify(stored), id],
	});
	return id;
}

const html = async (path, cookie) =>
	(await fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: `auth_session=${cookie}` } : {} })).text();

/** Create the French version from the editor's menu; resolves to its page id. */
async function createFrench(page, pageId) {
	await openEditor(page, pageId);
	await page.click('[data-tp-info="tp-translations"]');
	await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-translation-create="fr"]')), [], {
		message: 'create button',
	});
	await page.click('[data-tapestry-translation-create="fr"]');
	const id = await page.waitFor(
		(source) => {
			const edit = new URL(location.href).searchParams.get('edit');
			return edit && edit !== source && document.querySelector('.tp-editor') ? edit : false;
		},
		[pageId],
		{ message: 'the editor opened the new translation', timeout: 20_000 },
	);
	await openEditor(page, id); // make sure the page-content tab is showing
	return id;
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

	let sourceId;
	let targetId;
	await step('set up an English page linking to another English page', async () => {
		targetId = await createPage(cookie, TARGET, 'Target', {
			version: 1,
			root: [{ id: 'h', type: 'heading', props: { text: 'Target page' } }],
		});
		sourceId = await createPage(cookie, SOURCE, 'Source', {
			version: 1,
			root: [
				{ id: 'h', type: 'heading', props: { text: 'Hello' } },
				{ id: 'b', type: 'button', props: { label: 'Go', href: { type: 'page', page: targetId } } },
			],
		});
		const source = await html(`/${SOURCE}`);
		assert.match(source, /<html lang="en"/);
		assert.doesNotMatch(source, /hreflang/, 'no other language versions yet');
	});

	await step('the translations endpoint is for editors; creating is same-origin only', async () => {
		assert.equal((await fetch(`${BASE}/_tapestry/translations?page=${sourceId}`)).status, 403);
		const crossOrigin = await api(
			cookie,
			'POST',
			'/_tapestry/translations',
			{ page: sourceId, lang: 'fr' },
			'https://evil.example',
		);
		assert.equal(crossOrigin.status, 403);
		assert.equal((await api(cookie, 'POST', '/_tapestry/translations', { page: sourceId, lang: 'xx' })).status, 400);
		assert.equal((await api(cookie, 'POST', '/_tapestry/translations', { page: sourceId, lang: 'en' })).status, 400);
	});

	let frenchId;
	await step('the editor creates the French version: an unpublished copy, slug fr/…, opened for editing', async () => {
		frenchId = await createFrench(page, sourceId);
		const row = (await db.execute({ sql: 'select title, slug from StudioCMSPageData where id = ?', args: [frenchId] }))
			.rows[0];
		assert.deepEqual({ title: row.title, slug: row.slug }, { title: 'Source (Français)', slug: `fr/${SOURCE}` });
		const stored = JSON.parse(await storedContent(frenchId));
		assert.equal(stored.published, null);
		assert.deepEqual(
			stored.draft.root.map((n) => n.id),
			['h', 'b'],
		);
		assert.equal(
			await page.eval(() => document.querySelector('[data-tapestry-current-language]').textContent),
			'Français',
		);
	});

	await step('visitors cannot see the translation until it is published', async () => {
		assert.equal((await fetch(`${BASE}/fr/${SOURCE}`)).status, 404);
		assert.doesNotMatch(await html(`/${SOURCE}`), /hreflang/);
	});

	await step('translate and publish: lang="fr", hreflang links and a language switcher', async () => {
		await page.click('[data-tp-row="h"] .tp-row__label');
		await page.fill('#tp-field-h-text', 'Bonjour');
		await saveAndWait(page, frenchId, '[data-tapestry-publish]');
		const french = await html(`/fr/${SOURCE}`);
		assert.match(french, /<html lang="fr"/);
		assert.match(french, />Bonjour</);
		assert.match(french, new RegExp(`<link rel="alternate" hreflang="en" href="${BASE}/${SOURCE}"`));
		assert.match(
			french,
			/<nav class="site-languages"[^>]*>[\s\S]*<span aria-current="page" lang="fr"[^>]*>Français<\/span>/,
		);
		const english = await html(`/${SOURCE}`);
		assert.match(english, new RegExp(`<link rel="alternate" hreflang="fr" href="${BASE}/fr/${SOURCE}"`));
		assert.match(english, new RegExp(`<a href="/fr/${SOURCE}" hreflang="fr" lang="fr"[^>]*>Français</a>`));
	});

	await step('page links follow the current language once the linked page has a published translation', async () => {
		const button = (h) => /<a class="button[^"]*"[^>]*href="([^"]*)"/.exec(h)?.[1];
		assert.equal(button(await html(`/fr/${SOURCE}`)), `/${TARGET}`, 'no French target yet: the English page');
		const targetFr = await createFrench(page, targetId);
		await page.click('[data-tp-row="h"] .tp-row__label');
		await page.fill('#tp-field-h-text', 'Page cible');
		await saveAndWait(page, targetFr, '[data-tapestry-publish]');
		assert.equal(button(await html(`/fr/${SOURCE}`)), `/fr/${TARGET}`);
		assert.equal(button(await html(`/${SOURCE}`)), `/${TARGET}`, 'the English page still links in English');
	});

	await step('the menu lists both versions with their status', async () => {
		await openEditor(page, sourceId);
		await page.click('[data-tp-info="tp-translations"]');
		const items = await page.waitFor(() => {
			const list = [...document.querySelectorAll('[data-tapestry-translation]')];
			return list.length === 2 && list.every((li) => !li.textContent.includes('Loading'))
				? list.map((li) => [li.dataset.tapestryTranslation, li.querySelector('.tp-translations__status')?.textContent])
				: false;
		});
		assert.deepEqual(items, [
			['en', 'Published'],
			['fr', 'Published'],
		]);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Translations suite');
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
