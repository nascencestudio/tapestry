// End-to-end tests for draft / publish / history on Tapestry pages
// (docs/decisions/0011-draft-publish-history.md).
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after;
// creates and deletes a throwaway page ("e2e-unpublished").
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import {
	BASE,
	db,
	get,
	homePageId,
	login,
	openEditor,
	parseStored,
	resetToDemo,
	SHOTS,
	saveAndWait,
	step,
	storedContent,
	summary,
	working,
} from './helpers.mjs';

const pageId = await homePageId();
const NEW_SLUG = 'e2e-unpublished';

/** Text of the page's <h1> (HTML entities decoded), as a visitor or editor. */
const heading = async (path, cookie) => {
	const html = await (await get(path, cookie)).text();
	const text = /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1];
	if (text === undefined) return null;
	const entities = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'" };
	return text.replace(/&(quot|amp|lt|gt|#39);/g, (e) => entities[e]);
};
const status = (page) =>
	page.eval(() => document.querySelector('[data-tapestry-publish-status]')?.dataset.tapestryPublishStatus);
const stored = async () => parseStored(await storedContent(pageId));

/** Select the hero and type a new heading into its settings field. */
async function setHeading(page, text) {
	await page.click('[data-tp-row="hero-1"] .tp-row__label');
	await page.waitFor(() => document.querySelector('#tp-field-hero-1-heading'));
	await page.fill('#tp-field-hero-1-heading', text);
	await page.waitFor((t) => document.querySelector('#tp-field-hero-1-heading').value === t, [text]);
}

async function deleteNewPage(cookie) {
	const row = (await db.execute({ sql: 'select id from StudioCMSPageData where slug = ?', args: [NEW_SLUG] })).rows[0];
	if (!row) return;
	await fetch(`${BASE}/studiocms_api/dashboard/content/page`, {
		method: 'DELETE',
		headers: { Origin: BASE, 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
		body: JSON.stringify({ id: String(row.id), slug: NEW_SLUG }),
	});
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let cookie;

try {
	cookie = await login();
	await deleteNewPage(cookie);
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('reset: the demo page is published with no draft', async () => {
		await resetToDemo(page, pageId);
		await openEditor(page, pageId);
		assert.equal(await status(page), 'published');
		assert.equal(await page.eval(() => document.querySelector('[data-tapestry-publish]').disabled), true);
	});

	const live = await heading('/');

	await step('Save draft stores the change; visitors still see the published page', async () => {
		await setHeading(page, 'Draft heading');
		assert.equal(await status(page), 'changed');
		await saveAndWait(page, pageId, '[data-tapestry-save]');
		const s = await stored();
		assert.equal(s.draft.root[0].props.heading, 'Draft heading');
		assert.equal(s.published.root[0].props.heading, live);
		assert.equal(await heading('/'), live);
		assert.equal(await heading('/', cookie), live, 'editors see the published version by default');
	});

	await step('editors can preview the draft; visitors never can (even right after a preview)', async () => {
		const asEditor = await (await get('/', cookie)).text();
		assert.match(asEditor, /data-tapestry-status="changed"/);
		assert.match(asEditor, /data-tapestry-preview-link/);
		assert.equal(await heading('/?tapestry-preview', cookie), 'Draft heading');
		const preview = await get('/?tapestry-preview', cookie);
		assert.equal(preview.headers.get('x-robots-tag'), 'noindex, nofollow');
		assert.match(await preview.text(), /data-tapestry-previewing/);
		// StudioCMS caches pages: the preview must not have changed the cached copy.
		assert.equal(await heading('/?tapestry-preview'), live);
		assert.equal(await heading('/'), live);
	});

	await step("StudioCMS's public REST API never exposes the draft or history to visitors", async () => {
		const api = '/studiocms_api/rest/v1/public';
		// The API router accepts many spellings of the same path; all must be covered.
		const paths = [
			`${api}/pages`,
			`${api}/pages/`,
			`${api}/pages?slug=index`,
			`${api}/%70ages`,
			`${api}/./pages`,
			`/studiocms_api//rest/v1/public/pages`,
			`${api}/pages/${pageId}`,
			`${api}/pages/${pageId}/`,
		];
		for (const path of paths) {
			const response = await fetch(`${BASE}${path}`);
			const text = await response.text();
			assert.equal(response.status, 200, path);
			assert.ok(!text.includes('Draft heading'), `draft leaked via ${path}`);
			assert.ok(!text.includes('\\"history\\"'), `history leaked via ${path}`);
			assert.ok(text.includes('Pages built from'), `published content missing from ${path}`);
		}
		const asEditor = await (await get(`${api}/pages/${pageId}`, cookie)).text();
		assert.ok(asEditor.includes('Draft heading'), 'editors still get the full stored content');
	});

	await step('the canvas shows the draft, not the published version', async () => {
		await openEditor(page, pageId);
		await page.waitFor(
			() =>
				document.querySelector('[data-tapestry-canvas]')?.contentDocument?.querySelector('h1')?.textContent ===
				'Draft heading',
			[],
			{ timeout: 20_000, message: 'canvas shows the draft heading' },
		);
	});

	await step('Publish makes the draft live and keeps the old version in history', async () => {
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		const s = await stored();
		assert.equal(s.draft, null);
		assert.equal(s.published.root[0].props.heading, 'Draft heading');
		assert.equal(s.history[0].document.root[0].props.heading, live);
		assert.equal(s.publishedBy, 'Tapestry Dev');
		assert.equal(await heading('/'), 'Draft heading');
		assert.equal(await status(page), 'published');
	});

	await step('Restore to draft brings back an old version without going live; Publish reverts', async () => {
		await page.click('[data-tapestry-history-toggle]');
		await page.waitFor(() => document.querySelector('[data-tapestry-history]'));
		if (SHOTS) await page.screenshot(`${SHOTS}/history-panel.png`);
		await page.click('[data-tapestry-restore="0"]');
		assert.equal((await working(page)).root[0].props.heading, live);
		assert.equal(await status(page), 'changed');
		assert.equal(await heading('/'), 'Draft heading', 'restore must not go live by itself');
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		assert.equal(await heading('/'), live);
		assert.equal((await stored()).history[0].document.root[0].props.heading, 'Draft heading');
	});

	await step('Discard unpublished changes returns to the live version', async () => {
		await setHeading(page, 'Throwaway edit');
		assert.equal(await status(page), 'changed');
		await page.click('[data-tapestry-history-toggle]');
		if (!(await page.eval(() => Boolean(document.querySelector('[data-tapestry-history]'))))) {
			await page.click('[data-tapestry-history-toggle]');
		}
		await page.click('[data-tapestry-discard]');
		assert.equal((await working(page)).root[0].props.heading, live);
		assert.equal(await status(page), 'published');
		await saveAndWait(page, pageId, '[data-tapestry-save]');
		assert.equal((await stored()).draft, null);
	});

	await step('history keeps the 5 most recent earlier versions, newest first', async () => {
		for (let i = 1; i <= 6; i++) {
			await setHeading(page, `Version ${i}`);
			await saveAndWait(page, pageId, '[data-tapestry-publish]');
		}
		const s = await stored();
		assert.equal(s.published.root[0].props.heading, 'Version 6');
		assert.deepEqual(
			s.history.map((h) => h.document.root[0].props.heading),
			['Version 5', 'Version 4', 'Version 3', 'Version 2', 'Version 1'],
		);
		assert.equal(
			await page.eval(() => document.querySelector('[data-tapestry-history-toggle]').textContent.trim()),
			'History (5)',
		);
	});

	await step('compare an earlier version with the live one: change list and side by side', async () => {
		const s = await stored();
		const before = s.history[0].document.root[0].props.heading;
		const after = s.published.root[0].props.heading;
		await openEditor(page, pageId);
		await page.click('[data-tapestry-history-toggle]');
		await page.click('[data-tapestry-compare="0"]');
		await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-compare]')));
		const change = await page.eval(() => ({
			count: document.querySelector('[data-tapestry-compare-changes]')?.dataset.tapestryCompareChanges,
			text: document.querySelector('[data-change="changed"]')?.textContent,
		}));
		assert.equal(change.count, '1');
		assert.ok(change.text.includes(before) && change.text.includes(after), `before/after shown: ${change.text}`);
		// Both previews load the real page at the chosen version, without the admin bar.
		const frameHeading = (which) =>
			page.eval(
				(w) => {
					const d = document.querySelector(`[data-tapestry-compare-frame="${w}"]`)?.contentDocument;
					return d?.readyState === 'complete' ? (d.querySelector('h1')?.textContent ?? null) : null;
				},
				[which],
			);
		await page.eval(() => document.querySelector('[data-tapestry-compare]').scrollIntoView());
		await page.waitFor(
			(b, a) => {
				const h = (w) =>
					document.querySelector(`[data-tapestry-compare-frame="${w}"]`)?.contentDocument?.querySelector('h1')
						?.textContent;
				return h('before') === b && h('after') === a;
			},
			[before, after],
			{ timeout: 15_000, message: 'both versions rendered side by side' },
		);
		assert.equal(await frameHeading('before'), before);
		const adminBar = await page.eval(() =>
			Boolean(
				document
					.querySelector('[data-tapestry-compare-frame="before"]')
					.contentDocument.querySelector('#tapestry-adminbar'),
			),
		);
		assert.equal(adminBar, false, 'no admin bar in the comparison');
		if (SHOTS) await page.screenshot(`${SHOTS}/compare.png`);
		// Visitors can't pick a version: the parameter is ignored for them.
		assert.equal(await heading('/?tapestry-version=history-0'), after);
		const editorResponse = await get('/?tapestry-version=history-0', cookie);
		assert.equal(editorResponse.headers.get('x-robots-tag'), 'noindex, nofollow');
		await page.click('[data-tapestry-compare-close]');
	});

	await step('scheduled publishing: nothing changes for visitors until the time, then it goes live', async () => {
		const live = await heading('/');
		/** Pick a time in the schedule panel (datetime-local, local time; seconds allowed). */
		const pick = async (date) => {
			await page.eval(
				(value) => {
					const input = document.querySelector('[data-tapestry-schedule-input]');
					input.value = value;
					input.dispatchEvent(new Event('input', { bubbles: true }));
				},
				[
					`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
				],
			);
		};
		await setHeading(page, 'Scheduled heading');
		// Schedule far ahead, then cancel.
		await page.click('[data-tapestry-schedule-toggle]');
		await pick(new Date(Date.now() + 7 * 24 * 3600 * 1000));
		await saveAndWait(page, pageId, '[data-tapestry-schedule-submit]');
		assert.ok((await stored()).scheduled, 'stored a schedule');
		await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-scheduled-status]')));
		await page.click('[data-tapestry-schedule-toggle]');
		await saveAndWait(page, pageId, '[data-tapestry-schedule-cancel]');
		assert.equal((await stored()).scheduled, undefined, 'schedule cancelled');
		// Schedule for ~70 seconds from now (the panel stays open after cancelling).
		if (!(await page.eval(() => Boolean(document.querySelector('[data-tapestry-schedule-input]'))))) {
			await page.click('[data-tapestry-schedule-toggle]');
		}
		await pick(new Date(Date.now() + 70_000));
		await saveAndWait(page, pageId, '[data-tapestry-schedule-submit]');
		const s = await stored();
		assert.equal(s.scheduled.document.root[0].props.heading, 'Scheduled heading');
		assert.equal(await heading('/'), live, 'visitors still see the published version');
		const editorView = await (await get('/', cookie)).text();
		assert.match(editorView, /data-tapestry-scheduled/, 'the admin bar shows the schedule');
		if (SHOTS) await page.screenshot(`${SHOTS}/scheduled.png`);
		// Wait for the time to pass: then every reader sees it as published, without a background job.
		const deadline = Date.now() + 120_000;
		while ((await heading('/')) !== 'Scheduled heading') {
			assert.ok(Date.now() < deadline, 'went live within two minutes');
			await new Promise((r) => setTimeout(r, 2000));
		}
		await openEditor(page, pageId);
		assert.equal(await status(page), 'published', 'the editor shows it as published');
		assert.equal(await page.eval(() => Boolean(document.querySelector('[data-tapestry-scheduled-status]'))), false);
	});

	await step('a never-published page is hidden from visitors until its first publish', async () => {
		const created = await fetch(`${BASE}/studiocms_api/dashboard/content/page`, {
			method: 'POST',
			headers: { Origin: BASE, 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
			body: JSON.stringify({
				title: 'E2E unpublished',
				slug: NEW_SLUG,
				description: 'Throwaway page',
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
			}),
		});
		assert.equal(created.status, 200);
		assert.equal((await get(`/${NEW_SLUG}`)).status, 404);
		const asEditor = await get(`/${NEW_SLUG}`, cookie);
		assert.equal(asEditor.status, 200);
		assert.match(await asEditor.text(), /Not published yet/);

		const id = String(
			(await db.execute({ sql: 'select id from StudioCMSPageData where slug = ?', args: [NEW_SLUG] })).rows[0].id,
		);
		const apiList = async () => (await fetch(`${BASE}/studiocms_api/rest/v1/public/pages`)).json();
		assert.ok(!(await apiList()).some((p) => p.slug === NEW_SLUG), 'never-published page listed in the public API');
		assert.equal((await fetch(`${BASE}/studiocms_api/rest/v1/public/pages/${id}`)).status, 404);
		await openEditor(page, id);
		assert.equal(await status(page), 'unpublished');
		await page.click('.tp-library__item[title^="Add Heading"]');
		await page.waitFor(() => document.querySelectorAll('.tp-row').length === 1);
		await saveAndWait(page, id, '[data-tapestry-publish]');
		const visitor = await get(`/${NEW_SLUG}`);
		assert.equal(visitor.status, 200);
		assert.match(await visitor.text(), /<h2[^>]*>Text<\/h2>/);
		assert.ok(
			(await apiList()).some((p) => p.slug === NEW_SLUG),
			'published page missing from the public API',
		);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Publishing suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/publishing-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (cookie) await deleteNewPage(cookie).catch(() => {});
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
	db.close();
}
