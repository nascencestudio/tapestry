// End-to-end tests for the visual canvas (see docs/decisions/0010-visual-canvas.md):
// the real page in an iframe, live updates, click-to-select, drag and drop
// onto the page, the selection chip, viewports, full screen, and the render
// endpoint's security rules.
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import {
	BASE,
	db,
	field,
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

const pageId = await homePageId();
const doc = (page) => working(page);
/** Find a node anywhere in the tree. */
const findIn = (nodes, id) => {
	for (const node of nodes) {
		if (node.id === id) return node;
		const found = findIn(node.children ?? [], id);
		if (found) return found;
	}
	return null;
};
const childIds = async (page, parentId) => findIn((await doc(page)).root, parentId)?.children?.map((c) => c.id) ?? [];

/** Evaluate `fn(canvasDocument, ...args)` inside the canvas iframe's document. */
function inCanvas(page, fn, ...args) {
	return page.eval(
		(source, fnArgs) => {
			const frame = document.querySelector('[data-tapestry-canvas]');
			// Test-only bridge: rebuild the function from its source and run it on the iframe's document.
			return Function(`return (${source})`)()(frame.contentDocument, ...fnArgs);
		},
		fn.toString(),
		args,
	);
}

/**
 * Top-level viewport point inside an element of the canvas iframe. Scrolls the
 * element into view unless `scroll: false` (use that for a drag's second point,
 * so resolving it doesn't move the first one).
 */
function canvasPoint(page, selector, { xFraction = 0.5, yFraction = 0.5, scroll = true } = {}) {
	return () =>
		page.eval(
			(sel, xf, yf, scrollIntoView) => {
				const frame = document.querySelector('[data-tapestry-canvas]');
				frame.scrollIntoView({ block: 'nearest' });
				const el = frame.contentDocument.querySelector(sel);
				if (!el) throw new Error(`no canvas element ${sel}`);
				if (scrollIntoView) el.scrollIntoView({ block: 'center' });
				const box = el.getBoundingClientRect();
				const frameBox = frame.getBoundingClientRect();
				return { x: frameBox.left + box.left + box.width * xf, y: frameBox.top + box.top + box.height * yf };
			},
			selector,
			xFraction,
			yFraction,
			scroll,
		);
}

/** Wait until the canvas has rendered the latest document (no queued or in-flight update). */
const settled = (page) =>
	page.waitFor(() => !document.querySelector('[data-tapestry-canvas]')?.hasAttribute('data-tapestry-pending'), [], {
		message: 'canvas settled',
	});

async function clickCanvas(page, selector) {
	await settled(page);
	await new Promise((r) => setTimeout(r, 50)); // let the overlay redraw (requestAnimationFrame)
	const { x, y } = await canvasPoint(page, selector)();
	await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
	await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
	await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

const waitForCanvas = (page) =>
	page.waitFor(
		() => {
			const frame = document.querySelector('[data-tapestry-canvas]');
			return (
				frame?.contentDocument?.querySelector('[data-tapestry-root] [data-tapestry-node]') &&
				document.querySelector('.tp-canvas__status')?.dataset.state === 'ready'
			);
		},
		[],
		{ timeout: 20_000, message: 'canvas ready' },
	);

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;

try {
	const cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('reset the page to the demo document', async () => {
		await resetToDemo(page, pageId);
	});

	await step('canvas loads the real page with node markers and no admin bar', async () => {
		await openEditor(page, pageId);
		await waitForCanvas(page);
		const info = await inCanvas(page, (d) => ({
			nodes: d.querySelectorAll('[data-tapestry-node]').length,
			adminBar: Boolean(d.querySelector('[data-tapestry-adminbar]')),
			path: d.location.pathname + d.location.search,
		}));
		assert.equal(info.nodes, 9);
		assert.equal(info.adminBar, false);
		assert.equal(info.path, '/?tapestry-canvas=');
	});

	await step('canvas looks like the public page (same text, same site CSS)', async () => {
		const canvas = await inCanvas(page, (d) => ({
			text: d.querySelector('[data-tapestry-root]').textContent.replace(/\s+/g, ' ').trim(),
			font: getComputedStyle(d.querySelector('h1')).fontFamily,
			cta: getComputedStyle(d.querySelector('.hero__cta')).backgroundColor,
		}));
		const publicTab = await cdp.page();
		await publicTab.goto(`${BASE}/`);
		const live = await publicTab.eval(() => ({
			text: document.querySelector('main').textContent.replace(/\s+/g, ' ').trim(),
			font: getComputedStyle(document.querySelector('h1')).fontFamily,
			cta: getComputedStyle(document.querySelector('.hero__cta')).backgroundColor,
		}));
		await publicTab.send('Page.close');
		assert.deepEqual(canvas, live);
	});

	await step('clicking a link in the canvas selects its component instead of navigating', async () => {
		await clickCanvas(page, '.hero__cta');
		await page.waitFor(() => document.querySelector('#tp-props-heading')?.textContent === 'Hero');
		assert.equal(await inCanvas(page, (d) => d.location.pathname), '/');
		assert.equal(
			await page.eval(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow),
			'hero-1',
		);
		assert.equal(
			await inCanvas(page, (d) => d.querySelector('[data-tapestry-chip]').textContent.includes('Hero')),
			true,
		);
	});

	await step('editing a setting updates the canvas live, re-rendering only that component', async () => {
		await settled(page);
		// Mark an element outside the hero: a partial re-render leaves it in place.
		await page.eval(() => {
			const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
			d.querySelector('[data-tapestry-node="section-1"]').dataset.e2eKeep = 'yes';
		});
		await page.fill('#tp-field-hero-1-heading', 'Live from the canvas');
		await page.waitFor(
			() =>
				document.querySelector('[data-tapestry-canvas]').contentDocument.querySelector('h1')?.textContent ===
				'Live from the canvas',
			[],
			{ message: 'canvas h1 updated' },
		);
		await settled(page);
		const state = await page.eval(() => {
			const frame = document.querySelector('[data-tapestry-canvas]');
			return {
				render: frame.dataset.tapestryRender,
				kept: frame.contentDocument.querySelector('[data-tapestry-node="section-1"]')?.dataset.e2eKeep,
			};
		});
		assert.deepEqual(state, { render: 'partial', kept: 'yes' }, 'only the hero was re-rendered');
	});

	await step('drag a library component onto the canvas (inside a section)', async () => {
		await page.drag(
			'.tp-library__item[title^="Add Button"]',
			canvasPoint(page, '[data-tapestry-node="section-1"] > section', { yFraction: 0.08 }),
		);
		const children = await childIds(page, 'section-1');
		assert.equal(children.length, 3);
		const added = (await doc(page)).root.find((n) => n.id === 'section-1').children[0];
		assert.equal(added.type, 'button');
		await page.waitFor(
			(id) =>
				document
					.querySelector('[data-tapestry-canvas]')
					.contentDocument.querySelector(`[data-tapestry-node="${id}"] a`),
			[added.id],
			{ message: 'new button rendered in canvas' },
		);
		await settled(page);
		assert.equal(
			await page.eval(() => document.querySelector('[data-tapestry-canvas]').dataset.tapestryRender),
			'full',
			'adding a component re-renders the page',
		);
	});

	await step('drag the selection chip to move a component (real mouse drag)', async () => {
		await clickCanvas(page, '[data-tapestry-node="button-1"] a');
		await page.waitFor(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow === 'button-1');
		await settled(page);
		await page.realDrag(
			canvasPoint(page, '[data-tapestry-chip-handle]'),
			canvasPoint(page, '[data-tapestry-node="heading-1"] > h2', { yFraction: 0.2 }),
		);
		const children = await childIds(page, 'section-1');
		assert.equal(children[children.indexOf('heading-1') - 1], 'button-1');
		assert.deepEqual(await childIds(page, 'section-2'), []);
	});

	await step('drag a component directly on the canvas (real mouse drag)', async () => {
		await settled(page);
		// text-3 is the third column; drop it on the left half of the first column.
		await page.realDrag(
			canvasPoint(page, '[data-tapestry-node="text-3"] p'),
			canvasPoint(page, '[data-tapestry-node="text-1"] p', { xFraction: 0.1 }),
		);
		assert.deepEqual(await childIds(page, 'columns-1'), ['text-3', 'text-1', 'text-2']);
		assert.equal(
			await page.eval(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow),
			'text-3',
		);
	});

	await step('a selected container drags as a whole, even when pressed on a child', async () => {
		await page.click('[data-tp-row="columns-1"] .tp-row__label');
		await settled(page);
		// Scroll once, then measure both points without scrolling (a scroll between the two
		// measurements would make the first one stale).
		await canvasPoint(page, '[data-tapestry-node="heading-1"] > h2')();
		await page.realDrag(
			canvasPoint(page, '[data-tapestry-node="text-2"] p', { scroll: false }),
			canvasPoint(page, '[data-tapestry-node="heading-1"] > h2', { yFraction: 0.2, scroll: false }),
		);
		const children = await childIds(page, 'section-1');
		assert.equal(children[children.indexOf('heading-1') - 1], 'columns-1');
		assert.deepEqual(
			(await doc(page)).root
				.find((n) => n.id === 'section-1')
				.children.find((n) => n.id === 'columns-1')
				.children.map((n) => n.id),
			['text-3', 'text-1', 'text-2'],
		);
	});

	await step('components show a grab cursor in the canvas', async () => {
		assert.equal(
			await inCanvas(page, (d) => getComputedStyle(d.querySelector('[data-tapestry-node="hero-1"] > header')).cursor),
			'grab',
		);
	});

	await step('dragging a link on the page moves its component, never the link itself', async () => {
		await settled(page);
		// Target first (it may scroll), then the source without scrolling, so both are on screen.
		await page.realDrag(
			canvasPoint(page, '.hero__cta', { scroll: false }),
			canvasPoint(page, '[data-tapestry-node="heading-1"] > h2', { yFraction: 0.8 }),
		);
		const tree = (nodes) => nodes.map((n) => (n.children ? `${n.id}[${tree(n.children)}]` : n.id)).join(',');
		const section1 = await childIds(page, 'section-1');
		assert.equal(
			section1[section1.indexOf('heading-1') + 1],
			'hero-1',
			`tree after drop: ${tree((await doc(page)).root)}`,
		);
		assert.equal(await inCanvas(page, (d) => d.location.pathname), '/');
		await page.press('z', ['Control']);
		assert.equal((await doc(page)).root[0].id, 'hero-1');
	});

	await step('chip delete removes the component; Ctrl+Z inside the canvas restores it', async () => {
		await page.click('[data-tp-row="button-1"] .tp-row__label');
		await page.waitFor(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow === 'button-1');
		await clickCanvas(page, '[data-tapestry-chip] button[aria-label="Delete"]');
		assert.equal((await childIds(page, 'section-1')).includes('button-1'), false);
		await clickCanvas(page, '[data-tapestry-node="heading-1"] > h2');
		await page.press('z', ['Control']);
		assert.equal((await childIds(page, 'section-1')).includes('button-1'), true);
	});

	await step('selecting in the layer tree outlines the component in the canvas', async () => {
		await page.click('[data-tp-row="text-2"] .tp-row__label');
		await page.waitFor(() => {
			const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
			const box = d.querySelector('#tapestry-canvas-overlay .tc-selected');
			return box && getComputedStyle(box).display === 'block';
		});
	});

	await step('mobile viewport narrows the canvas and the page layout responds', async () => {
		await page.click('[data-tapestry-viewport="mobile"]');
		await page.waitFor(() => document.querySelector('[data-tapestry-canvas]').getBoundingClientRect().width <= 391);
		await page.waitFor(() => {
			const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
			return getComputedStyle(d.querySelector('.columns')).gridTemplateColumns.split(' ').length === 1;
		});
		if (SHOTS) await page.screenshot(`${SHOTS}/canvas-mobile.png`);
		await page.click('[data-tapestry-viewport="desktop"]');
	});

	await step('full screen covers the window; its Save button persists the page', async () => {
		await page.click('[data-tapestry-fullscreen-toggle]');
		const size = await page.eval(() => {
			const box = document.querySelector('.tp-editor').getBoundingClientRect();
			return { w: Math.round(box.width), h: Math.round(box.height), vw: innerWidth, vh: innerHeight };
		});
		assert.equal(size.w, size.vw);
		assert.equal(size.h, size.vh);
		// The canvas frame fills its stage at the Desktop width (after its width transition).
		await page.waitFor(() => {
			const frame = document.querySelector('[data-tapestry-canvas]');
			return Math.abs(frame.getBoundingClientRect().width - frame.parentElement.clientWidth) < 2;
		});
		if (SHOTS) await page.screenshot(`${SHOTS}/canvas-fullscreen.png`);
		await saveAndWait(page, pageId, '[data-tapestry-save]');
		assert.match(await field(page), /Live from the canvas/);
		await page.click('[data-tapestry-fullscreen-toggle]');
	});

	await step(
		'an empty container shows a drop zone on the canvas; dropping there puts the component inside',
		async () => {
			// Click "Section" in the library with nothing selected: an empty section at the end of the page.
			const ids = (d) => {
				const out = [];
				const walk = (nodes) => {
					for (const n of nodes) {
						out.push(n);
						if (n.children) walk(n.children);
					}
				};
				walk(d.root);
				return out;
			};
			const before = new Set(ids(await doc(page)).map((n) => n.id));
			await page.click('.tp-library__item[title^="Add Section"]');
			await settled(page);
			const empty = ids(await doc(page)).find((n) => !before.has(n.id));
			assert.equal(empty.type, 'section');
			assert.equal(empty.children?.length ?? 0, 0);
			const zone = await page.eval(
				(id) => {
					const el = document
						.querySelector('[data-tapestry-canvas]')
						.contentDocument.querySelector(`[data-tapestry-node="${id}"] tapestry-canvas-drop`);
					return el && { text: el.textContent.trim(), height: el.getBoundingClientRect().height };
				},
				[empty.id],
			);
			assert.equal(zone?.text, 'Drop components here');
			assert.ok(zone.height >= 60, `drop zone has room (${zone.height}px)`);
			await page.drag(
				'.tp-library__item[title^="Add Heading"]',
				canvasPoint(page, `[data-tapestry-node="${empty.id}"] tapestry-canvas-drop`),
			);
			await settled(page);
			const filled = ids(await doc(page)).find((n) => n.id === empty.id);
			assert.deepEqual(
				filled.children?.map((c) => c.type),
				['heading'],
				'heading dropped inside the empty section',
			);
			assert.equal(
				await page.eval(
					(id) =>
						Boolean(
							document
								.querySelector('[data-tapestry-canvas]')
								.contentDocument.querySelector(`[data-tapestry-node="${id}"] tapestry-canvas-drop`),
						),
					[empty.id],
				),
				false,
				'drop zone gone once the section has content',
			);
			// The public page never has drop zones.
			assert.doesNotMatch(await (await get('/')).text(), /tapestry-canvas-drop/);
			// Remove the section again so later steps see the demo layout.
			await page.click(`[data-tp-row="${empty.id}"] .tp-row__label`);
			await page.press('Delete');
			await settled(page);
		},
	);

	await step('keyboard on the canvas: arrows select, Alt+arrows move, copy/paste, undo', async () => {
		const selected = () => page.eval(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow);
		const expectSelected = (id) =>
			page.waitFor((want) => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow === want, [id], {
				message: `${id} selected`,
			});
		await clickCanvas(page, '[data-tapestry-node="hero-1"] > header');
		await expectSelected('hero-1');
		// Focus is now inside the canvas iframe: keys go to the canvas.
		assert.equal(await page.eval(() => document.activeElement?.matches('[data-tapestry-canvas]')), true);
		await page.press('ArrowDown');
		await expectSelected('section-1');
		await page.press('ArrowRight');
		await expectSelected(
			await page.eval(() => document.querySelector('[data-tp-row="section-1"] + ul .tp-row')?.dataset.tpRow),
		);
		const firstChild = await selected();
		await page.press('ArrowLeft');
		await expectSelected('section-1');
		const before = JSON.stringify(await doc(page));
		await page.press('ArrowUp', ['Alt']);
		await settled(page);
		assert.equal((await doc(page)).root[0].id, 'section-1', 'moved above the hero');
		// Copy and paste on the canvas.
		await page.press('ArrowRight');
		await expectSelected(firstChild);
		const isMac = process.platform === 'darwin';
		for (const command of ['copy', 'paste']) {
			const k = command === 'copy' ? 'c' : 'v';
			const base = {
				key: k,
				code: `Key${k.toUpperCase()}`,
				modifiers: isMac ? 4 : 2,
				windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
			};
			await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, commands: [command] });
			await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
		}
		await settled(page);
		const pasted = (await doc(page)).root[0].children[1];
		assert.equal(pasted.type, (await doc(page)).root[0].children[0].type, 'pasted a copy right after it');
		assert.notEqual(pasted.id, firstChild);
		// Undo both changes from inside the canvas.
		await page.press('z', [isMac ? 'Meta' : 'Control']);
		await page.press('z', [isMac ? 'Meta' : 'Control']);
		await settled(page);
		assert.equal(JSON.stringify(await doc(page)), before, 'undo restored the document');
	});

	await step('security: canvas markers and the render endpoint are editors-only', async () => {
		assert.doesNotMatch(await (await get('/?tapestry-canvas')).text(), /data-tapestry-node/);
		const body = JSON.stringify({ version: 1, root: [] });
		const post = (headers) => fetch(`${BASE}/_tapestry/render`, { method: 'POST', body, headers });
		assert.equal((await post({ Origin: BASE })).status, 403);
		assert.equal((await post({ Origin: 'https://evil.example', Cookie: `auth_session=${cookie}` })).status, 403);
		assert.equal((await get('/_tapestry/render', cookie)).status, 405);
		assert.equal((await post({ Origin: BASE, Cookie: `auth_session=${cookie}` })).status, 200);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Canvas suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/canvas-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page && !process.exitCode) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
	db.close();
}
