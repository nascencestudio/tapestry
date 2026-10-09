// End-to-end tests for Tapestry + the media library (docs/decisions/0016-media-library.md):
// a `media` prop chosen in the picker, media inserted into rich text on the
// canvas, the published page, usage tracking and the delete warning.
//
// Prereqs: same as editor.e2e.mjs. Resets the demo page and deletes its media.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CDP, launchChrome } from './cdp.mjs';
import {
	BASE,
	db,
	get,
	homePageId,
	login,
	openEditor,
	resetToDemo,
	SHOTS,
	saveAndWait,
	step,
	summary,
	working,
} from './helpers.mjs';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const pageId = await homePageId();
const findIn = (nodes, id) => {
	for (const node of nodes) {
		if (node.id === id) return node;
		const found = findIn(node.children ?? [], id);
		if (found) return found;
	}
	return null;
};

async function canvasClick(page, selector, scroll = true) {
	const { x, y } = await page.eval(
		(sel, doScroll) => {
			const frame = document.querySelector('[data-tapestry-canvas]');
			frame.scrollIntoView({ block: 'nearest' });
			const el = frame.contentDocument.querySelector(sel);
			if (doScroll) el.scrollIntoView({ block: 'center' });
			const b = el.getBoundingClientRect();
			const f = frame.getBoundingClientRect();
			return { x: f.left + b.left + b.width / 2, y: f.top + b.top + b.height / 2 };
		},
		selector,
		scroll,
	);
	await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
	await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** Choose an item in the open picker dialog. */
async function pick(page, id) {
	await page.waitFor((i) => Boolean(document.querySelector(`[data-media-picker] [data-media-item="${i}"]`)), [id], {
		timeout: 15_000,
		message: 'picker shows the item',
	});
	await page.click(`[data-media-picker] [data-media-item="${id}"]`);
	await page.waitFor(() => !document.querySelector('[data-media-picker] [data-media-pick]')?.disabled);
	await page.click('[data-media-picker] [data-media-pick]');
	await page.waitFor(() => !document.querySelector('[data-media-picker]'), [], { message: 'picker closed' });
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let cookie;
const created = [];
const api = (path, init = {}) =>
	fetch(`${BASE}/_media/api${path}`, {
		...init,
		headers: { Origin: BASE, Cookie: `auth_session=${cookie}`, ...(init.headers ?? {}) },
	});

try {
	cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });
	const upload = async (file) => {
		const r = await api('/upload', {
			method: 'POST',
			body: readFileSync(`${FIXTURES}/${file}`),
			headers: { 'X-File-Name': file },
		});
		const { item } = await r.json();
		created.push(item.id);
		return item;
	};
	const image = await upload('sample.png');
	const pdf = await upload('sample.pdf');

	await step('reset; a media field offers "Choose…" in the settings panel', async () => {
		await resetToDemo(page, pageId);
		await openEditor(page, pageId);
		await page.click('[data-tp-row="hero-1"] .tp-row__label');
		await page.waitFor(() =>
			Boolean(document.querySelector('#tp-field-hero-1-backgroundImage [data-tapestry-media-choose]')),
		);
	});

	await step('the picker opens, limited to images; choosing sets the prop and shows a preview', async () => {
		await page.click('#tp-field-hero-1-backgroundImage [data-tapestry-media-choose]');
		await page.waitFor(() => Boolean(document.querySelector('[data-media-picker] [data-media-library="pick"]')));
		await page.waitFor(
			(i) => Boolean(document.querySelector(`[data-media-picker] [data-media-item="${i}"]`)),
			[image.id],
		);
		const shown = await page.eval(() =>
			[...document.querySelectorAll('[data-media-picker] [data-media-item]')].map((el) => el.title),
		);
		assert.ok(!shown.includes('sample.pdf'), 'documents are not offered for an image field');
		if (SHOTS) await page.screenshot(`${SHOTS}/media-picker.png`);
		await pick(page, image.id);
		assert.equal(findIn((await working(page)).root, 'hero-1').props.backgroundImage, image.id);
		await page.waitFor(
			() =>
				document.querySelector('#tp-field-hero-1-backgroundImage .tp-media-field__name')?.textContent === 'sample.png',
		);
	});

	await step('the canvas renders the hero with the chosen background image', async () => {
		await page.waitFor(
			(url) => {
				const frame = document.querySelector('[data-tapestry-canvas]');
				const hero = frame?.contentDocument?.querySelector('.hero--image');
				return !frame.hasAttribute('data-tapestry-pending') && hero?.getAttribute('style')?.includes(url);
			},
			[image.url],
			{ timeout: 20_000, message: 'hero background on the canvas' },
		);
	});

	await step('"Insert media" on the canvas toolbar adds a document to rich text', async () => {
		await canvasClick(page, '[data-tapestry-text="text-3"] p');
		await page.waitFor(
			() => {
				const frame = document.querySelector('[data-tapestry-canvas]');
				const bar = frame.contentDocument.querySelector('.tc-format');
				return Boolean(
					!frame.hasAttribute('data-tapestry-pending') &&
						bar &&
						getComputedStyle(bar).display !== 'none' &&
						bar.querySelector('[data-tapestry-format="media"]') &&
						frame.contentDocument.querySelector('[data-tapestry-text="text-3"][data-tapestry-editing]'),
				);
			},
			[],
			{ message: 'editing text-3 with the toolbar shown' },
		);
		await new Promise((r) => setTimeout(r, 150)); // let the toolbar settle into position
		await canvasClick(page, '.tc-format [data-tapestry-format="media"]', false);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-picker]')), [], { message: 'picker opened' });
		await pick(page, pdf.id);
		const body = findIn((await working(page)).root, 'text-3').props.body;
		assert.ok(
			body.content.some((b) => b.type === 'media' && b.attrs.id === pdf.id),
			'media block stored',
		);
		await page.waitFor(
			() =>
				(
					document
						.querySelector('[data-tapestry-canvas]')
						.contentDocument.querySelector('[data-tapestry-text="text-3"] .tp-media-node')?.textContent ?? ''
				).includes('sample.pdf'),
			[],
			{ message: 'preview in the inline editor' },
		);
	});

	await step('published: the hero background and the document link are on the public page', async () => {
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		const html = await (await get('/')).text();
		assert.match(
			html,
			new RegExp(`--hero-image: url\\(&quot;${image.url}&quot;\\)|--hero-image: url\\("${image.url}"\\)`),
		);
		assert.match(html, new RegExp(`<a[^>]*href="${pdf.url}"[^>]*download="sample.pdf"[^>]*>sample.pdf`));
	});

	await step('the library knows where media is used and warns before deleting it', async () => {
		const details = await (await api(`/items/${image.id}`)).json();
		assert.deepEqual(
			details.usage.map((u) => u.title),
			['Home'],
		);
		const refused = await api(`/items/${image.id}`, { method: 'DELETE' });
		assert.equal(refused.status, 409);
		assert.equal((await refused.json()).usage[0].title, 'Home');
	});

	await step('Remove clears a media field', async () => {
		await page.click('[data-tp-row="hero-1"] .tp-row__label');
		await page.waitFor(() => Boolean(document.querySelector('#tp-field-hero-1-backgroundImage .tp-media-field__name')));
		await page.click('#tp-field-hero-1-backgroundImage [data-tapestry-media-remove]');
		await page.waitFor(
			() => document.querySelector('#tp-field-hero-1-backgroundImage')?.textContent.includes('Nothing chosen'),
			[],
			{
				message: 'field cleared',
			},
		);
		assert.equal(findIn((await working(page)).root, 'hero-1').props.backgroundImage, undefined);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Media + Tapestry suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/media-tapestry-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	for (const id of created) await api(`/items/${id}?force=1`, { method: 'DELETE' }).catch(() => {});
	cdp.close();
	await chrome.close();
	db.close();
}
