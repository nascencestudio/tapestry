// End-to-end tests for patterns / saved sections (docs/decisions/0028-patterns.md): saving a
// section from the settings panel, inserting copies from the library (click and drag onto the
// canvas), deleting, and the endpoint's access rules.
//
// Prereqs: same as editor.e2e.mjs. Patterns named "E2E …" are removed before and after; the
// demo home page is reset before and after.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, homePageId, login, openEditor, resetToDemo, step, summary, working } from './helpers.mjs';

const pageId = await homePageId();
const NAME = 'E2E Intro section';

const api = (cookie, method, path, { body, origin = BASE } = {}) =>
	fetch(`${BASE}${path}`, {
		method,
		headers: { Origin: origin, Cookie: `auth_session=${cookie}`, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

async function cleanup(cookie) {
	const response = await api(cookie, 'GET', '/_tapestry/patterns');
	if (!response.ok) return;
	const { patterns } = await response.json();
	for (const pattern of patterns.filter((p) => p.name.startsWith('E2E'))) {
		await api(cookie, 'DELETE', `/_tapestry/patterns?id=${pattern.id}`);
	}
}

const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
/** A subtree's shape without ids: types, props and nesting. */
const shape = (node) => ({ type: node.type, props: node.props, children: (node.children ?? []).map(shape) });

const settled = (page) =>
	page.waitFor(() => !document.querySelector('[data-tapestry-canvas]')?.hasAttribute('data-tapestry-pending'), [], {
		message: 'canvas settled',
	});

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let cookie;

try {
	cookie = await login();
	await cleanup(cookie);
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('the patterns endpoint is for editors, and writes are same-origin only', async () => {
		assert.equal((await fetch(`${BASE}/_tapestry/patterns`)).status, 403);
		const crossOrigin = await api(cookie, 'POST', '/_tapestry/patterns', {
			body: { name: 'E2E evil', nodes: [{ id: 'h', type: 'heading', props: { text: 'x' } }] },
			origin: 'https://evil.example',
		});
		assert.equal(crossOrigin.status, 403);
		const invalid = await api(cookie, 'POST', '/_tapestry/patterns', {
			body: { name: 'E2E invalid', nodes: [{ id: 'x', type: 'script', props: {} }] },
		});
		assert.equal(invalid.status, 400);
		assert.equal((await api(cookie, 'GET', '/_tapestry/patterns?id=../../x')).status, 404);
	});

	let original;
	await step('save a section as a pattern from the settings panel', async () => {
		await resetToDemo(page, pageId);
		await openEditor(page, pageId);
		await page.click('[data-tp-row="section-1"] .tp-row__label');
		await page.click('[data-tapestry-save-pattern]');
		await page.waitFor(() => document.activeElement?.hasAttribute('data-tapestry-pattern-name'), [], {
			message: 'name field focused',
		});
		await page.fill('[data-tapestry-pattern-name]', NAME);
		await page.click('[data-tapestry-pattern-save]');
		await page.waitFor(
			(name) =>
				[...document.querySelectorAll('[data-tapestry-pattern] .tp-library__label')].some(
					(el) => el.textContent === name,
				),
			[NAME],
			{
				message: 'pattern listed in the library',
			},
		);
		original = all((await working(page)).root).find((n) => n.id === 'section-1');
		const description = await page.eval(
			(name) =>
				[...document.querySelectorAll('[data-tapestry-pattern]')]
					.find((el) => el.querySelector('.tp-library__label').textContent === name)
					.querySelector('.tp-library__description').textContent,
			NAME,
		);
		assert.equal(description, `Section with ${all(original.children).length} components inside`);
	});

	const patternSelector = `[data-tapestry-pattern] .tp-library__item[title*="${NAME}"]`;

	await step('click the pattern: a copy with fresh ids is inserted and selected', async () => {
		const before = (await working(page)).root;
		const beforeIds = new Set(all(before).map((n) => n.id));
		await page.click('[data-tp-row="section-2"] .tp-row__label'); // a section: inserts inside it, at the end
		await page.click(patternSelector);
		await page.waitFor((count) => document.querySelectorAll('.tp-row').length > count, [beforeIds.size], {
			message: 'copy inserted',
		});
		const doc = (await working(page)).root;
		const section2 = doc.find((n) => n.id === 'section-2');
		const copy = section2.children.at(-1);
		assert.deepEqual(shape(copy), shape(original));
		assert.equal(copy.label, original.label);
		for (const node of all([copy])) assert.equal(beforeIds.has(node.id), false, `fresh id for ${node.type}`);
		assert.equal(
			await page.eval(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow),
			copy.id,
		);
	});

	await step('drag the pattern onto the canvas: another copy goes where it is dropped', async () => {
		await settled(page);
		const before = (await working(page)).root.length;
		await page.drag(patternSelector, () =>
			page.eval(() => {
				const frame = document.querySelector('[data-tapestry-canvas]');
				frame.scrollIntoView({ block: 'nearest' });
				const first = frame.contentDocument.querySelector('[data-tapestry-root] > [data-tapestry-node] > *');
				first.scrollIntoView({ block: 'center' });
				const box = first.getBoundingClientRect();
				const frameBox = frame.getBoundingClientRect();
				// The top edge of the first component: before it, at the top of the page.
				return { x: frameBox.left + box.left + box.width / 2, y: frameBox.top + box.top + 3 };
			}),
		);
		// The pattern is fetched, then inserted: wait for the document to grow.
		const deadline = Date.now() + 10_000;
		let root = before;
		while (root === before && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 100));
			root = (await working(page)).root.length;
		}
		assert.equal(root, before + 1);
		const first = (await working(page)).root[0];
		assert.deepEqual(shape(first), shape(original));
	});

	await step('delete the pattern (with confirmation); pages keep their copies', async () => {
		const rowsBefore = await page.eval(() => document.querySelectorAll('.tp-row').length);
		const item = `[data-tapestry-pattern]:has(.tp-library__item[title*="${NAME}"])`;
		await page.click(`${item} [data-tapestry-pattern-delete]`);
		await page.click(`${item} [data-tapestry-pattern-delete-confirm]`);
		await page.waitFor((sel) => !document.querySelector(sel), [item], { message: 'pattern removed from the library' });
		const { patterns } = await (await api(cookie, 'GET', '/_tapestry/patterns')).json();
		assert.equal(
			patterns.some((p) => p.name === NAME),
			false,
		);
		assert.equal(await page.eval(() => document.querySelectorAll('.tp-row').length), rowsBefore);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Patterns suite');
} catch (error) {
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (cookie) await cleanup(cookie).catch((e) => console.error('Cleanup failed:', e));
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
}
