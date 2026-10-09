// End-to-end test of the Tapestry editor in a real (headless) Chrome against
// the running playground dev server.
//
// Prereqs: `pnpm dev` running on :4321, plugin built, first-time setup done.
// Usage:   pnpm --filter playground e2e        (HEADED=1 to watch it)
//
// It resets the demo home page through the editor's JSON view + Save before
// and after (direct database writes would be hidden by StudioCMS's page
// cache), so it's safe to re-run.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import {
	BASE,
	db,
	field,
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

const doc = (page) => working(page);
const rows = (page) => page.eval(() => document.querySelectorAll('.tp-row').length);
const selectedLabel = (page) =>
	page.eval(() => document.querySelector('.tp-row[aria-selected="true"] .tp-row__label')?.textContent);

const pageId = await homePageId();

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;

try {
	page = await cdp.page();
	const cookie = await login();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('reset the page to the demo document via the JSON view and Save', async () => {
		await resetToDemo(page, pageId);
	});

	await step('editor mounts with the stored page', async () => {
		await openEditor(page, pageId);
		assert.equal(await rows(page), 9);
		assert.equal(await page.eval(() => document.querySelector('textarea[data-tapestry-field]').hidden), true);
	});

	await step('opening the page does not rewrite stored content', async () => {
		assert.equal(await field(page), await storedContent(pageId));
	});

	await step('selecting a row shows its settings; editing a prop updates the document', async () => {
		await page.click('[data-tp-row="hero-1"] .tp-row__label');
		await page.waitFor(() => document.querySelector('#tp-props-heading')?.textContent === 'Hero');
		await page.fill('#tp-field-hero-1-heading', 'Edited by the e2e test');
		const d = await doc(page);
		assert.equal(d.root[0].props.heading, 'Edited by the e2e test');
	});

	await step('Enter in a settings field does not submit (save) the page form', async () => {
		await page.press('Enter');
		const before = await storedContent(pageId);
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await storedContent(pageId), before);
	});

	await step('clicking a library item inserts after the selected leaf and selects it', async () => {
		await page.click('.tp-library__item[title^="Add Heading"]');
		await page.waitFor(() => document.querySelectorAll('.tp-row').length === 10);
		assert.equal(await selectedLabel(page), 'Heading');
		assert.equal((await doc(page)).root[1].type, 'heading');
	});

	await step('keyboard: Alt+↑ moves, Ctrl+Z undoes, Ctrl+Shift+Z redoes', async () => {
		await page.eval(() => document.querySelector('.tp-row[aria-selected="true"]').focus());
		await page.press('ArrowUp', ['Alt']);
		assert.equal((await doc(page)).root[0].type, 'heading');
		await page.press('z', ['Control']);
		assert.equal((await doc(page)).root[1].type, 'heading');
		await page.press('z', ['Control', 'Shift']);
		assert.equal((await doc(page)).root[0].type, 'heading');
		await page.press('z', ['Control']);
	});

	await step('keyboard: Delete removes the node, undo restores it', async () => {
		await page.eval(() => document.querySelector('.tp-row[aria-selected="true"]').focus());
		await page.press('Delete');
		assert.equal(await rows(page), 9);
		await page.press('z', ['Control']);
		assert.equal(await rows(page), 10);
	});

	await step('drag a row above another row (reorder-before, across containers)', async () => {
		await page.drag('[data-tp-row="button-1"] .tp-row__label', '[data-tp-row="heading-1"]', { yFraction: 0.1 });
		const d = await doc(page);
		const section1 = d.root.find((n) => n.id === 'section-1');
		const section2 = d.root.find((n) => n.id === 'section-2');
		assert.deepEqual(
			section1.children.map((n) => n.id),
			['button-1', 'heading-1', 'columns-1'],
		);
		assert.deepEqual(section2.children, []);
	});

	await step('drag a library item onto a container row (combine → append inside)', async () => {
		await page.drag('.tp-library__item[title^="Add Text"]', '[data-tp-row="section-2"]', { yFraction: 0.5 });
		const d = await doc(page);
		const section2 = d.root.find((n) => n.id === 'section-2');
		assert.equal(section2.children.length, 1);
		assert.equal(section2.children[0].type, 'text');
	});

	await step('dragging a container into its own child is refused', async () => {
		const before = JSON.stringify(await doc(page));
		await page.drag('[data-tp-row="section-1"] .tp-row__label', '[data-tp-row="columns-1"]', { yFraction: 0.5 });
		assert.equal(JSON.stringify(await doc(page)), before);
	});

	if (SHOTS) await page.screenshot(`${SHOTS}/editor.png`);

	await step('Save stores a draft through StudioCMS; the public page is unchanged', async () => {
		await saveAndWait(page, pageId);
		const stored = parseStored(await storedContent(pageId));
		assert.match(JSON.stringify(stored.draft), /Edited by the e2e test/);
		assert.doesNotMatch(JSON.stringify(stored.published), /Edited by the e2e test/);
		assert.doesNotMatch(await (await fetch(`${BASE}/`)).text(), /Edited by the e2e test/);
	});

	await step('Publish makes the edits live', async () => {
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		assert.match(await (await fetch(`${BASE}/`)).text(), /Edited by the e2e test/);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Editor suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page && !process.exitCode) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
	db.close();
}
