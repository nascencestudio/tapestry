// End-to-end tests for `link` props (docs/decisions/0025-link-prop.md): the demo Button's
// link field, the page list endpoint (editors only), page links that follow a renamed page,
// and what visitors get (href, target, rel).
//
// Prereqs: same as editor.e2e.mjs. Creates a throwaway Markdown page ("e2e-link-target",
// renamed to "e2e-link-renamed") and deletes it afterwards. Resets the demo home page before
// and after.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import {
	BASE,
	db,
	get,
	homePageId,
	login,
	openEditor,
	resetToDemo,
	saveAndWait,
	step,
	summary,
	working,
} from './helpers.mjs';

const SLUG = 'e2e-link-target';
const RENAMED = 'e2e-link-renamed';
const pageId = await homePageId();
let targetId;

async function api(method, path, cookie, body) {
	const response = await fetch(`${BASE}/studiocms_api/dashboard${path}`, {
		method,
		headers: { Origin: BASE, 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
		body: body && JSON.stringify(body),
	});
	return { status: response.status, body: await response.text() };
}

const pageBySlug = async (slug) =>
	(await db.execute({ sql: 'select * from StudioCMSPageData where slug = ?', args: [slug] })).rows[0];

async function cleanup(cookie) {
	for (const slug of [SLUG, RENAMED]) {
		const row = await pageBySlug(slug);
		if (row) await api('DELETE', '/content/page', cookie, { id: String(row.id), slug });
	}
}

/** Change the target page's slug and draft flag through StudioCMS's edit endpoint. */
async function updateTarget(cookie, { slug, draft }) {
	const row = (await db.execute({ sql: 'select * from StudioCMSPageData where id = ?', args: [targetId] })).rows[0];
	const content = (
		await db.execute({
			sql: "select id from StudioCMSPageContent where contentId = ? and contentLang = 'default'",
			args: [targetId],
		})
	).rows[0];
	const response = await api('PATCH', '/content/page', cookie, {
		id: targetId,
		contentId: String(content.id),
		title: row.title,
		slug,
		description: row.description,
		package: row.package,
		showOnNav: false,
		showAuthor: false,
		showContributors: false,
		heroImage: '',
		draft,
		parentFolder: null,
		categories: [],
		tags: [],
		augments: [],
		pluginFields: {},
		content: '',
	});
	assert.equal(response.status, 200, response.body);
}

/** The button's link on the public home page: { href, target, rel }. */
async function publicButton(cookie) {
	const html = await (await get('/', cookie)).text();
	const tag = /<a class="button[^"]*"[^>]*>/.exec(html)?.[0];
	assert.ok(tag, 'button link rendered');
	const attr = (name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
	return { href: attr('href'), target: attr('target'), rel: attr('rel') };
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

	await step('reset the demo page and create a page to link to', async () => {
		await resetToDemo(page, pageId);
		const created = await api('POST', '/content/page', cookie, {
			title: 'E2E link target',
			slug: SLUG,
			description: 'Throwaway page for the links suite',
			package: 'studiocms/markdown',
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
		targetId = String((await pageBySlug(SLUG)).id);
	});

	await step('the page list is for editors only', async () => {
		assert.ok([401, 403].includes((await get('/_tapestry/pages')).status), 'anonymous refused');
		const response = await get('/_tapestry/pages', cookie);
		assert.equal(response.status, 200);
		assert.match(response.headers.get('cache-control') ?? '', /no-store/);
		const { pages } = await response.json();
		const target = pages.find((p) => p.id === targetId);
		assert.deepEqual(target, { id: targetId, title: 'E2E link target', path: `/${SLUG}`, draft: false });
	});

	await step('visitors get the demo web address, opening in a new tab safely', async () => {
		assert.deepEqual(await publicButton(), {
			href: 'https://docs.studiocms.dev',
			target: '_blank',
			rel: 'noopener noreferrer',
		});
	});

	await step('the link field shows the stored web address and new-tab setting', async () => {
		await openEditor(page, pageId);
		await page.click('[data-tp-row="button-1"] .tp-row__label');
		await page.waitFor(() => document.querySelector('[data-tapestry-link-url]'), [], { message: 'url input' });
		const state = await page.eval(() => ({
			url: document.querySelector('[data-tapestry-link-url]').value,
			newTab: document.querySelector('[data-tapestry-link-newtab]').checked,
			mode: document.querySelector('[data-tapestry-link-mode="url"]').getAttribute('aria-pressed'),
		}));
		assert.deepEqual(state, { url: 'https://docs.studiocms.dev', newTab: true, mode: 'true' });
	});

	await step('pick a page on this site; the document stores its id', async () => {
		await page.click('[data-tapestry-link-mode="page"]');
		await page.waitFor(
			(id) => {
				// The list can fail to load while SQLite is busy (known issue #23): use "Try again", like an editor would.
				document.querySelector('[data-tapestry-link-retry]')?.click();
				return Boolean(document.querySelector(`[data-tapestry-link-page] option[value="${id}"]`));
			},
			[targetId],
			{
				message: 'target page listed',
			},
		);
		await page.eval((id) => {
			const select = document.querySelector('[data-tapestry-link-page]');
			select.value = id;
			select.dispatchEvent(new Event('change', { bubbles: true }));
		}, targetId);
		await page.waitFor((id) => document.querySelector('[data-tapestry-link-page]')?.value === id, [targetId]);
		const button = (await working(page)).root
			.flatMap(function all(n) {
				return [n, ...(n.children ?? []).flatMap(all)];
			})
			.find((n) => n.id === 'button-1');
		assert.deepEqual(button.props.href, { type: 'page', page: targetId, newTab: true });
	});

	await step('turn off new tab and publish; visitors get the page path', async () => {
		await page.click('[data-tapestry-link-newtab]');
		await page.waitFor(() => !document.querySelector('[data-tapestry-link-newtab]').checked);
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		assert.deepEqual(await publicButton(), { href: `/${SLUG}`, target: undefined, rel: undefined });
	});

	await step('a draft page is linked for editors only', async () => {
		await updateTarget(cookie, { slug: SLUG, draft: true });
		const anonymous = await publicButton();
		assert.equal(anonymous.href, undefined, 'visitors get no link to a draft');
		assert.doesNotMatch(await (await get('/')).text(), new RegExp(SLUG));
		assert.equal((await publicButton(cookie)).href, `/${SLUG}`);
		await updateTarget(cookie, { slug: SLUG, draft: false });
		assert.equal((await publicButton()).href, `/${SLUG}`);
	});

	await step('renaming the linked page updates the link', async () => {
		await updateTarget(cookie, { slug: RENAMED, draft: false });
		assert.equal((await publicButton()).href, `/${RENAMED}`);
	});

	await step('a deleted page leaves no broken link', async () => {
		await cleanup(cookie);
		const html = await (await get('/')).text();
		assert.doesNotMatch(html, new RegExp(RENAMED));
		const tag = /<a class="button[^"]*"[^>]*>/.exec(html)?.[0];
		assert.ok(tag, 'button still renders');
		assert.doesNotMatch(tag, /\shref=/);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Links suite');
} catch (error) {
	if (page) {
		const state = await page
			.eval(() => ({
				selected: document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow,
				modes: [...document.querySelectorAll('[data-tapestry-link-mode]')].map((b) => b.getAttribute('aria-pressed')),
				options: [...(document.querySelector('[data-tapestry-link-page]')?.options ?? [])].map((o) => o.textContent),
			}))
			.catch((e) => String(e));
		console.error('Editor state:', JSON.stringify(state));
	}
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (cookie) await cleanup(cookie).catch((e) => console.error('Cleanup failed:', e));
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
	db.close();
}
