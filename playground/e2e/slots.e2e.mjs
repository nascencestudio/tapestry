// End-to-end tests for named slots (docs/decisions/0027-named-slots.md), with the playground's
// "Two columns" component (slots `left` and `right`): drop zones per slot on the canvas and in
// the page structure, dropping into a slot from the library (canvas and tree), keyboard moves
// across slots, and what visitors get.
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, homePageId, login, openEditor, resetToDemo, saveAndWait, step, summary, working } from './helpers.mjs';

const pageId = await homePageId();

/** Children of the split as `id:slot`, from the editor's working document. */
async function slotted(page, id) {
	const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
	const split = all((await working(page)).root).find((n) => n.id === id);
	return (split?.children ?? []).map((n) => `${n.type}:${n.slot ?? ''}`);
}

const settled = (page) =>
	page.waitFor(() => !document.querySelector('[data-tapestry-canvas]')?.hasAttribute('data-tapestry-pending'), [], {
		message: 'canvas settled',
	});

/** Top-level viewport point inside an element of the canvas iframe (scrolled into view). */
function canvasPoint(page, selector, { yFraction = 0.5, scroll = true } = {}) {
	return () =>
		page.eval(
			(sel, yf, scrollIntoView) => {
				const frame = document.querySelector('[data-tapestry-canvas]');
				const el = frame.contentDocument.querySelector(sel);
				if (!el) throw new Error(`no canvas element ${sel}`);
				// Scrolling (the page or the canvas) would move points resolved earlier, e.g. a drag's target.
				if (scrollIntoView) {
					frame.scrollIntoView({ block: 'nearest' });
					el.scrollIntoView({ block: 'center' });
				}
				const box = el.getBoundingClientRect();
				const frameBox = frame.getBoundingClientRect();
				return { x: frameBox.left + box.left + box.width / 2, y: frameBox.top + box.top + box.height * yf };
			},
			selector,
			yFraction,
			scroll,
		);
}

const inCanvas = (page, selector) =>
	page.eval(
		(sel) => [...document.querySelector('[data-tapestry-canvas]').contentDocument.querySelectorAll(sel)].length,
		selector,
	);

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let id;

try {
	const cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('reset; a new "Two columns" shows an empty area per slot (tree and canvas)', async () => {
		await resetToDemo(page, pageId);
		await openEditor(page, pageId);
		await page.click('.tp-library__item[title^="Add Two columns"]');
		id = await page.waitFor(() => {
			const row = document.querySelector('.tp-row[aria-selected="true"]');
			return row?.dataset.tpRow?.startsWith('split') && row.dataset.tpRow;
		});
		const areas = await page.eval(
			(splitId) =>
				[...document.querySelectorAll(`[data-tp-area^="${splitId}:"] .tp-tree__area-label`)].map(
					(el) => el.textContent,
				),
			id,
		);
		assert.deepEqual(areas, ['Left column', 'Right column']);
		await settled(page);
		await page.waitFor(
			(splitId) =>
				document
					.querySelector('[data-tapestry-canvas]')
					.contentDocument.querySelectorAll(`tapestry-canvas-drop[data-tapestry-drop-into="${splitId}"]`).length === 2,
			[id],
			{ message: 'two drop zones on the canvas' },
		);
	});

	await step('drag a Heading from the library into the right column on the canvas', async () => {
		await page.drag(
			'.tp-library__item[title^="Add Heading"]',
			canvasPoint(page, `[data-tapestry-drop-into="${id}"][data-tapestry-drop-slot="right"]`),
		);
		assert.deepEqual(await slotted(page, id), ['heading:right']);
		await settled(page);
		await page.waitFor(
			(splitId) =>
				document
					.querySelector('[data-tapestry-canvas]')
					.contentDocument.querySelector(`[data-tapestry-slot-of="${splitId}"][data-tapestry-slot="right"] h2`),
			[id],
			{ message: 'heading rendered in the right column' },
		);
		assert.equal(await inCanvas(page, `tapestry-canvas-drop[data-tapestry-drop-into="${id}"]`), 1, 'left still empty');
	});

	await step('drag a Text from the library into the left column in the page structure', async () => {
		await page.drag('.tp-library__item[title^="Add Text"]', `[data-tp-endzone="${id}:left"]`);
		assert.deepEqual(await slotted(page, id), ['text:left', 'heading:right']);
		const rows = await page.eval(
			(splitId) =>
				[...document.querySelectorAll(`[data-tp-area^="${splitId}:"]`)].map((area) => [
					area.dataset.tpArea.split(':')[1],
					[...area.querySelectorAll(':scope > ul > li > .tp-row')].map((row) => row.dataset.tpRow.split('-')[0]),
				]),
			id,
		);
		assert.deepEqual(rows, [
			['left', ['text']],
			['right', ['heading']],
		]);
	});

	await step('Alt+↑ on the first item of a slot moves it into the previous slot; undo', async () => {
		const heading = await page.eval(
			(splitId) => document.querySelector(`[data-tp-area="${splitId}:right"] .tp-row`).dataset.tpRow,
			id,
		);
		await page.click(`[data-tp-row="${heading}"] .tp-row__label`);
		await page.press('ArrowUp', ['Alt']);
		assert.deepEqual(await slotted(page, id), ['text:left', 'heading:left']);
		await page.press('z', ['Control']);
		assert.deepEqual(await slotted(page, id), ['text:left', 'heading:right']);
	});

	await step('drag a component on the canvas into the other column (real mouse drag)', async () => {
		await settled(page);
		const [textId, headingId] = await page.eval((splitId) => {
			const rows = (slot) => document.querySelector(`[data-tp-area="${splitId}:${slot}"] .tp-row`).dataset.tpRow;
			return [rows('left'), rows('right')];
		}, id);
		// Both points before pressing: the target first (it may scroll), then the source without scrolling.
		const to = await canvasPoint(page, `[data-tapestry-node="${headingId}"] > h2`, { yFraction: 0.85 })();
		const from = await canvasPoint(page, `[data-tapestry-node="${textId}"] > *`, { scroll: false })();
		await page.realDrag(
			async () => from,
			async () => to,
		);
		assert.deepEqual(await slotted(page, id), ['heading:right', 'text:right']);
		await page.press('z', ['Control']);
		assert.deepEqual(await slotted(page, id), ['text:left', 'heading:right']);
	});

	await step('publish; visitors get each component in its column', async () => {
		await settled(page);
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		const html = await (await fetch(`${BASE}/`)).text();
		const columns = [
			...html.matchAll(/<div class="split__column"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="split__column"|<\/div>)/g),
		].map((m) => m[1]);
		assert.equal(columns.length, 2, 'two columns rendered');
		assert.match(columns[0], /class="text"/);
		assert.doesNotMatch(columns[0], /<h2/);
		assert.match(columns[1], /<h2/);
		assert.doesNotMatch(html, /tapestry-slot|tapestry-canvas/);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Slots suite');
} catch (error) {
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
}
