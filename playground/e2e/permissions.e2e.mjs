// End-to-end tests for `publishPermission` (docs/decisions/0022-publish-permission.md). The
// playground requires an admin to publish. A throwaway editor-level account (created and
// deleted here) can edit and save drafts but can't publish, in the editor or by crafting
// requests; the owner (the e2e login) still can.
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CDP, launchChrome } from './cdp.mjs';
import {
	BASE,
	db,
	homePageId,
	login,
	openEditor,
	parseStored,
	resetToDemo,
	step,
	storedContent,
	summary,
} from './helpers.mjs';

const pageId = await homePageId();
const USERNAME = `e2e-editor-${randomBytes(3).toString('hex')}`;
const PASSWORD = `Ed-${randomBytes(18).toString('base64url')}`;

const api = (cookie, method, path, body) =>
	fetch(`${BASE}${path}`, {
		method,
		headers: { Origin: BASE, Cookie: `auth_session=${cookie}`, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

async function loginAs(username, password) {
	const response = await fetch(`${BASE}/studiocms_api/auth/login`, {
		method: 'POST',
		headers: { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ username, password }),
		redirect: 'manual',
	});
	const cookie = /auth_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
	assert.ok(cookie, `login as ${username} failed (HTTP ${response.status})`);
	return cookie;
}

/** The fields StudioCMS's edit form sends for this page, with `content` replaced. */
async function savePayload(content) {
	const page = (await db.execute({ sql: 'select * from StudioCMSPageData where id = ?', args: [pageId] })).rows[0];
	const row = (
		await db.execute({
			sql: "select id from StudioCMSPageContent where contentId = ? and contentLang = 'default'",
			args: [pageId],
		})
	).rows[0];
	return {
		id: pageId,
		contentId: row.id,
		title: page.title,
		slug: page.slug,
		description: page.description,
		package: page.package,
		showOnNav: Boolean(page.showOnNav),
		showAuthor: Boolean(page.showAuthor),
		showContributors: Boolean(page.showContributors),
		heroImage: page.heroImage ?? '',
		draft: Boolean(page.draft),
		parentFolder: page.parentFolder ?? null,
		categories: [],
		tags: [],
		augments: [],
		pluginFields: {},
		content,
	};
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let ownerCookie;
let userId;

try {
	ownerCookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: ownerCookie, url: BASE });

	await step('reset the demo page; the owner creates an editor-level account', async () => {
		await resetToDemo(page, pageId);
		const response = await api(ownerCookie, 'POST', '/studiocms_api/dashboard/create-user', {
			username: USERNAME,
			email: `${USERNAME}@example.com`,
			displayname: 'E2E Editor',
			password: PASSWORD,
			rank: 'editor',
			originalUrl: `${BASE}/dashboard/user-management`,
		});
		assert.equal(response.status, 200, await response.text());
		userId = (await db.execute({ sql: 'select id from StudioCMSUsersTable where username = ?', args: [USERNAME] }))
			.rows[0]?.id;
		assert.ok(userId, 'user created');
	});

	let editorCookie;
	await step('an editor sees Publish and Schedule disabled, with the reason', async () => {
		editorCookie = await loginAs(USERNAME, PASSWORD);
		await page.send('Network.clearBrowserCookies');
		await page.send('Network.setCookie', { name: 'auth_session', value: editorCookie, url: BASE });
		await openEditor(page, pageId);
		const buttons = await page.eval(() => {
			const publish = document.querySelector('[data-tapestry-publish]');
			const schedule = document.querySelector('[data-tapestry-schedule-toggle]');
			return { publish: publish.disabled, schedule: schedule.disabled, title: publish.title };
		});
		assert.equal(buttons.publish, true);
		assert.equal(buttons.schedule, true);
		assert.match(buttons.title, /Only admins can publish/);
	});

	await step("an editor's draft saves; the live version is untouched", async () => {
		const before = parseStored(await storedContent(pageId));
		const draft = JSON.parse(JSON.stringify(before.published));
		draft.root[1].children[0].props.text = 'Editor draft'; // heading-1 (the Hero is admin-only)
		const content = JSON.stringify({ ...before, draft });
		const response = await api(
			editorCookie,
			'PATCH',
			'/studiocms_api/dashboard/content/page',
			await savePayload(content),
		);
		assert.equal(response.status, 200, await response.text());
		const after = parseStored(await storedContent(pageId));
		assert.equal(after.draft.root[1].children[0].props.text, 'Editor draft');
		assert.deepEqual(after.published, before.published);
	});

	await step('crafted requests from an editor cannot publish, schedule, rewrite history or unpublish', async () => {
		const before = parseStored(await storedContent(pageId));
		const sneaky = JSON.parse(JSON.stringify(before.published));
		sneaky.root[1].children[0].props.text = 'Sneaky publish';
		const attempts = [
			// A published version of their own, with forged history and a schedule.
			JSON.stringify({
				version: 2,
				published: sneaky,
				publishedAt: new Date().toISOString(),
				publishedBy: 'Mallory',
				draft: null,
				history: [],
				scheduled: { document: sneaky, at: '2000-01-01T00:00:00.000Z' },
			}),
			// The old single-document format (renders as published).
			JSON.stringify(sneaky),
			// Empty content (would unpublish).
			'',
		];
		for (const content of attempts) {
			const response = await api(
				editorCookie,
				'PATCH',
				'/studiocms_api/dashboard/content/page',
				await savePayload(content),
			);
			assert.equal(response.status, 200, await response.text());
			const after = parseStored(await storedContent(pageId));
			assert.deepEqual(after.published, before.published, `live version unchanged after ${content.slice(0, 40)}`);
			assert.deepEqual(after.history, before.history, 'history unchanged');
			assert.equal(after.scheduled, undefined, 'no schedule');
		}
		// The public page still shows the live heading.
		const html = await (await fetch(`${BASE}/`)).text();
		assert.doesNotMatch(html, /Sneaky publish/);
		// Other path spellings go through the same guard.
		const odd = await api(
			editorCookie,
			'PATCH',
			'/studiocms_api/dashboard//content/page',
			await savePayload(attempts[0]),
		);
		if (odd.status === 200) {
			assert.deepEqual(parseStored(await storedContent(pageId)).published, before.published);
		}
	});

	await step('an editor sees admin-only components locked and cannot change them (UI or crafted request)', async () => {
		await openEditor(page, pageId);
		const ui = await page.eval(() => ({
			rowLock: Boolean(document.querySelector('[data-tp-row="hero-1"] [data-tapestry-locked]')),
			rowActionsHidden: document.querySelector('[data-tp-row="hero-1"] .tp-row__actions')?.hidden,
			library: document
				.querySelector('.tp-library__item[title^="Only admins can add Hero"]')
				?.getAttribute('aria-disabled'),
		}));
		assert.deepEqual(ui, { rowLock: true, rowActionsHidden: true, library: 'true' });
		await page.click('[data-tp-row="hero-1"] .tp-row__label');
		await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-locked-note]')), [], {
			message: 'locked note',
		});
		assert.equal(await page.eval(() => document.querySelector('fieldset.tp-props__fields').disabled), true);
		await page.press('Delete');
		const notice = await page.waitFor(
			() => document.querySelector('[data-tapestry-locked-notice]')?.textContent.trim(),
			[],
			{
				message: 'locked notice',
			},
		);
		assert.equal(notice, 'Only admins can remove “Hero”.');
		assert.equal(await page.eval(() => Boolean(document.querySelector('[data-tp-row="hero-1"]'))), true, 'still there');

		const before = await storedContent(pageId);
		const stored = parseStored(before);
		const draft = JSON.parse(JSON.stringify(stored.published));
		draft.root[0].props.heading = 'Hero changed by an editor';
		const response = await api(
			editorCookie,
			'PATCH',
			'/studiocms_api/dashboard/content/page',
			await savePayload(JSON.stringify({ ...stored, draft })),
		);
		assert.equal(response.status, 403);
		assert.match(await response.text(), /Only admins can change “Hero”/);
		assert.equal(await storedContent(pageId), before, 'nothing saved');
	});

	await step('the owner can still publish', async () => {
		await page.send('Network.clearBrowserCookies');
		await page.send('Network.setCookie', { name: 'auth_session', value: ownerCookie, url: BASE });
		await openEditor(page, pageId);
		assert.equal(await page.eval(() => document.querySelector('[data-tapestry-publish]').disabled), false);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Permissions suite');
} catch (error) {
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) {
		await page.send('Network.clearBrowserCookies').catch(() => {});
		await page.send('Network.setCookie', { name: 'auth_session', value: ownerCookie, url: BASE }).catch(() => {});
		await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	}
	if (userId) {
		const response = await api(ownerCookie, 'DELETE', '/studiocms_api/dashboard/users', {
			userId,
			username: USERNAME,
			usernameConfirm: USERNAME,
		}).catch((e) => e);
		if (response?.status !== 200)
			console.error('Could not delete the test user', response?.status, await response?.text?.());
	}
	cdp.close();
	await chrome.close();
	db.close();
}
