// End-to-end tests for `list` (repeater) and `object` props (docs/decisions/0026-list-and-object-props.md),
// with the playground's FAQ component: adding, editing, reordering and removing questions,
// undo, the "More help" object, the canvas, and what visitors get.
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, homePageId, login, openEditor, resetToDemo, saveAndWait, step, summary, working } from './helpers.mjs';

const pageId = await homePageId();

/** The FAQ node in the editor's working document. */
async function faq(page, id) {
	const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
	return all((await working(page)).root).find((n) => n.id === id);
}

const questions = async (page, id) => ((await faq(page, id))?.props.items ?? []).map((item) => item.question);

/** Titles of the list items shown in the settings panel. */
const itemTitles = (page) =>
	page.eval(() => [...document.querySelectorAll('.tp-list-item__title')].map((el) => el.textContent));

const fieldId = (id, prop, ...path) => `#tp-field-${id}-${[prop, ...path].join('__')}`;

const canvasText = (page) =>
	page.eval(() => document.querySelector('[data-tapestry-canvas]')?.contentDocument?.body?.textContent ?? '');

const settled = (page) =>
	page.waitFor(() => !document.querySelector('[data-tapestry-canvas]')?.hasAttribute('data-tapestry-pending'), [], {
		message: 'canvas settled',
	});

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let id;

try {
	const cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('reset the demo page; adding an FAQ starts with one open question', async () => {
		await resetToDemo(page, pageId);
		await openEditor(page, pageId);
		await page.click('.tp-library__item[title^="Add FAQ"]');
		id = await page.waitFor(() => {
			const row = document.querySelector('.tp-row[aria-selected="true"]');
			return row?.dataset.tpRow?.startsWith('faq') && row.dataset.tpRow;
		});
		await page.waitFor(() => document.querySelector('[data-tapestry-list-field]'));
		assert.deepEqual(await questions(page, id), ['Question']);
		assert.deepEqual(await itemTitles(page), ['Question']);
		assert.equal(
			await page.eval(() => document.querySelector('[data-tapestry-list-toggle]').getAttribute('aria-expanded')),
			'true',
		);
		// Field order and defaults inside the item.
		assert.deepEqual((await faq(page, id)).props.items, [{ question: 'Question', open: false }]);
	});

	await step('edit a question; add two more (each opens, focused)', async () => {
		await page.fill(fieldId(id, 'items', 0, 'question'), 'What is Tapestry?');
		await page.click('[data-tapestry-list-add]');
		await page.waitFor(
			(sel) => document.activeElement === document.querySelector(sel),
			[fieldId(id, 'items', 1, 'question')],
			{
				message: 'new item focused',
			},
		);
		await page.fill(fieldId(id, 'items', 1, 'question'), 'Is it free?');
		await page.click('[data-tapestry-list-add]');
		await page.fill(fieldId(id, 'items', 2, 'question'), 'Does it need JavaScript?');
		assert.deepEqual(await questions(page, id), ['What is Tapestry?', 'Is it free?', 'Does it need JavaScript?']);
		assert.deepEqual(await itemTitles(page), ['What is Tapestry?', 'Is it free?', 'Does it need JavaScript?']);
	});

	await step('move a question up; undo puts it back in one step', async () => {
		await page.click('[data-tapestry-list-item="2"] [data-tapestry-list-up]');
		assert.deepEqual(await questions(page, id), ['What is Tapestry?', 'Does it need JavaScript?', 'Is it free?']);
		// Focus follows the moved item.
		await page.waitFor(
			() => document.activeElement?.closest('[data-tapestry-list-item]')?.dataset.tapestryListItem === '1',
			[],
			{ message: 'focus on the moved item' },
		);
		await page.press('z', ['Control']);
		assert.deepEqual(await questions(page, id), ['What is Tapestry?', 'Is it free?', 'Does it need JavaScript?']);
	});

	await step('remove a question; undo brings it back', async () => {
		await page.click('[data-tapestry-list-item="1"] [data-tapestry-list-remove]');
		assert.deepEqual(await questions(page, id), ['What is Tapestry?', 'Does it need JavaScript?']);
		await page.press('z', ['Control']);
		assert.deepEqual(await questions(page, id), ['What is Tapestry?', 'Is it free?', 'Does it need JavaScript?']);
	});

	await step('a cleared required question is flagged in its item', async () => {
		const toggle = '[data-tapestry-list-item="1"] [data-tapestry-list-toggle]';
		if ((await page.eval((sel) => document.querySelector(sel).getAttribute('aria-expanded'), toggle)) !== 'true') {
			await page.click(toggle);
		}
		await page.waitFor((sel) => document.querySelector(sel), [fieldId(id, 'items', 1, 'question')]);
		await page.fill(fieldId(id, 'items', 1, 'question'), '');
		await page.waitFor(
			(sel) => document.querySelector(`${sel}-error`)?.textContent.includes('required'),
			[fieldId(id, 'items', 1, 'question')],
		);
		await page.fill(fieldId(id, 'items', 1, 'question'), 'Is it free?');
	});

	await step('fill the "More help" object (text and link)', async () => {
		await page.fill(fieldId(id, 'more', 'label'), 'Read the guide');
		await page.click(`[data-tp-field="${id}.more.link"] [data-tapestry-link-mode="url"]`);
		await page.fill(`[data-tp-field="${id}.more.link"] [data-tapestry-link-url]`, '/guide');
		assert.equal(
			JSON.stringify((await faq(page, id)).props.more),
			'{"label":"Read the guide","link":{"type":"url","url":"/guide"}}',
		);
	});

	await step('the canvas shows the questions in order', async () => {
		await settled(page);
		await page.waitFor(() =>
			(document.querySelector('[data-tapestry-canvas]')?.contentDocument?.body?.textContent ?? '').includes(
				'Does it need JavaScript?',
			),
		);
		const text = await canvasText(page);
		const order = ['What is Tapestry?', 'Is it free?', 'Does it need JavaScript?'].map((q) => text.indexOf(q));
		assert.ok(
			order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])),
			`canvas order ${order}`,
		);
	});

	await step('publish; visitors get the questions as <details> and the help link', async () => {
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		const html = await (await fetch(`${BASE}/`)).text();
		const summaries = [...html.matchAll(/<summary class="faq__question"[^>]*>([^<]*)<\/summary>/g)].map((m) => m[1]);
		assert.deepEqual(summaries, ['What is Tapestry?', 'Is it free?', 'Does it need JavaScript?']);
		assert.match(html, /<p class="faq__more"[^>]*>\s*<a href="\/guide"[^>]*>Read the guide<\/a>/);
		assert.doesNotMatch(html, /<details[^>]* open/);
		assert.doesNotMatch(html, /undefined|\[object Object\]/);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Lists suite');
} catch (error) {
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
}
