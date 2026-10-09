// Accessibility checks with axe-core (docs/decisions/0034-accessibility-and-performance.md):
// WCAG 2.2 A/AA plus axe's best practices, on the public page (as a visitor) and on Tapestry's
// own UI in the editor in many states (settings, link and list fields, rich text, popovers,
// translations, history, compare, schedule, JSON view, save as pattern) and on the media
// library's page, in the dashboard's dark and light themes. StudioCMS's own dashboard chrome is
// out of scope (it's StudioCMS's).
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after, and switches the
// dashboard theme back to dark at the end (StudioCMS saves it per user).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, homePageId, login, openEditor, resetToDemo, step, summary } from './helpers.mjs';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const MEDIA_PAGE = '/dashboard/nascencestudio_medialibrary/media';
const pageId = await homePageId();

/** Run axe on `context` (a selector) and fail with a readable list of violations. */
async function audit(page, context, label) {
	await page.eval(AXE);
	const violations = await page.eval(
		`axe.run(${JSON.stringify(context)}, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} } })
			.then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help,
				nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })))`,
	);
	assert.deepEqual(violations, [], `${label}: ${JSON.stringify(violations, null, 2)}`);
}

const editorStates = async (page, theme) => {
	await openEditor(page, pageId);
	await page.waitFor(() => document.querySelector('.tp-canvas__status')?.dataset.state === 'ready');
	await audit(page, '.tp-editor', `${theme}: editor`);
	await page.click('[data-tp-row="text-1"] .tp-row__label');
	await page.click('[data-tapestry-edit-here]').catch(() => {}); // the rich text field itself, not the canvas note
	await audit(page, '.tp-editor', `${theme}: rich text settings`);
	await page.click('[data-tp-row="button-1"] .tp-row__label');
	await audit(page, '.tp-editor', `${theme}: link field`);
	await page.click('[data-tapestry-save-pattern]');
	await audit(page, '.tp-editor', `${theme}: save as pattern`);
	await page.click('.tp-library__item[title^="Add FAQ "]');
	await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-list-field]')));
	await audit(page, '.tp-editor', `${theme}: list field`);
	// An error state: a required field emptied shows its problem (danger text must be readable).
	const faq = await page.eval(() => document.querySelector('.tp-row[aria-selected="true"]').dataset.tpRow);
	await page.fill(`#tp-field-${faq}-items__0__question`, '');
	await page.waitFor((id) => Boolean(document.getElementById(`tp-field-${id}-items__0__question-error`)), [faq]);
	await audit(page, '.tp-editor', `${theme}: field error`);
	for (const [id, name] of [
		['tp-layers-help', 'page structure help'],
		['tp-canvas-help', 'canvas help'],
		['tp-translations', 'translations menu'],
	]) {
		await page.click(`[data-tp-info="${id}"]`);
		if (id === 'tp-translations') {
			await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-translations]')));
		}
		await audit(page, '.tp-editor', `${theme}: ${name}`);
		await page.press('Escape');
	}
	await page.click('[data-tapestry-history-toggle]');
	await audit(page, '.tp-editor', `${theme}: history`);
	if (await page.eval(() => Boolean(document.querySelector('[data-tapestry-compare="0"]')))) {
		await page.click('[data-tapestry-compare="0"]');
		await audit(page, '.tp-editor', `${theme}: compare`);
	}
	await openEditor(page, pageId);
	await page.click('[data-tapestry-schedule-toggle]');
	await audit(page, '.tp-editor', `${theme}: schedule`);
	await page.click('[data-tapestry-json-toggle]');
	await audit(page, '.tp-editor', `${theme}: JSON view`);
	await page.goto(`${BASE}${MEDIA_PAGE}`);
	await page.waitFor(() => Boolean(document.querySelector('[data-media-library]')));
	await audit(page, '[data-media-library]', `${theme}: media library`);
};

const setTheme = (page, theme) =>
	page.eval((t) => {
		document.documentElement.setAttribute('data-theme', t);
		return new Promise((r) => setTimeout(r, 800)); // StudioCMS saves the preference
	}, theme);

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;

try {
	const cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('the public page has no violations (as a visitor)', async () => {
		await resetToDemo(page, pageId);
		const visitor = await cdp.page({ isolated: true });
		await visitor.goto(`${BASE}/`);
		await audit(visitor, 'html', 'public page');
	});

	await step('the editor has no violations in the dark theme (panels, fields, popovers, history)', async () => {
		await editorStates(page, 'dark');
	});

	await step('…nor in the light theme', async () => {
		await openEditor(page, pageId);
		await setTheme(page, 'light');
		await editorStates(page, 'light');
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Accessibility suite');
} catch (error) {
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) {
		await openEditor(page, pageId)
			.then(() => setTheme(page, 'dark'))
			.catch((e) => console.error('Theme reset failed:', e));
		await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	}
	cdp.close();
	await chrome.close();
}
