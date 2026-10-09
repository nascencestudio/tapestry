// End-to-end tests for the layer tree extras: collapse/expand (mouse, keyboard, collapse
// all, reveal on canvas selection, expand while dragging), auto-scroll while dragging,
// per-node names, and copy/cut/paste through the clipboard (which also works between
// pages: nothing is kept in memory, so pasting after a reload is the same path).
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import {
	BASE,
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
const visibleRows = (page) =>
	page.eval(() => [...document.querySelectorAll('.tp-row')].map((row) => row.dataset.tpRow));
const allIds = (doc) => {
	const ids = [];
	const walk = (nodes) => {
		for (const node of nodes) {
			ids.push(node.id);
			if (node.children) walk(node.children);
		}
	};
	walk(doc.root);
	return ids;
};
const isMac = process.platform === 'darwin';

/** A real clipboard shortcut (Ctrl/⌘+C/X/V): the browser runs the copy/cut/paste command. */
async function clipboard(page, command) {
	const key = { copy: 'c', cut: 'x', paste: 'v' }[command];
	const base = {
		key,
		code: `Key${key.toUpperCase()}`,
		modifiers: isMac ? 4 : 2,
		windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
	};
	await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, commands: [command] });
	await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;

try {
	page = await cdp.page();
	const cookie = await login();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });
	// Copy/paste needs clipboard access in headless Chrome.
	await cdp.send('Browser.grantPermissions', {
		origin: BASE,
		permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
	});

	await step('reset the demo page', async () => {
		await resetToDemo(page, pageId);
		await openEditor(page, pageId);
	});

	await step('containers collapse and expand with the toggle; collapsed rows show a count', async () => {
		assert.deepEqual(await visibleRows(page), [
			'hero-1',
			'section-1',
			'heading-1',
			'columns-1',
			'text-1',
			'text-2',
			'text-3',
			'section-2',
			'button-1',
		]);
		await page.click('[data-tp-toggle="section-1"]');
		await page.waitFor(() => !document.querySelector('[data-tp-row="heading-1"]'));
		assert.deepEqual(await visibleRows(page), ['hero-1', 'section-1', 'section-2', 'button-1']);
		const state = await page.eval(() => ({
			expanded: document.querySelector('[data-tp-row="section-1"]').getAttribute('aria-expanded'),
			count: document.querySelector('[data-tp-row="section-1"] .tp-row__count')?.textContent,
		}));
		assert.deepEqual(state, { expanded: 'false', count: '2' });
		await page.click('[data-tp-toggle="section-1"]');
		await page.waitFor(() => Boolean(document.querySelector('[data-tp-row="text-3"]')));
	});

	await step('keyboard: → expands or enters, ← collapses or goes to the parent; ↑/↓ skip hidden rows', async () => {
		await page.click('[data-tp-row="columns-1"] .tp-row__label');
		await page.press('ArrowLeft');
		await page.waitFor(() => !document.querySelector('[data-tp-row="text-1"]'));
		await page.press('ArrowDown');
		await page.waitFor(
			() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow === 'section-2',
			[],
			{ message: '↓ skips the collapsed children' },
		);
		await page.press('ArrowUp');
		await page.press('ArrowRight'); // expand columns-1
		await page.waitFor(() => Boolean(document.querySelector('[data-tp-row="text-1"]')));
		await page.press('ArrowRight'); // enter: first child
		await page.waitFor(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow === 'text-1');
		await page.press('ArrowLeft'); // a leaf: go to the parent
		await page.waitFor(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow === 'columns-1');
	});

	await step('collapse all / expand all; selecting on the canvas reveals the node', async () => {
		await page.click('[data-tp-collapse-all]');
		await page.waitFor(() => document.querySelectorAll('.tp-row').length === 3);
		assert.equal(
			await page.eval(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow),
			'section-1',
			'the hidden selection moves to its top-level container',
		);
		// Click text-2 inside the canvas iframe: the tree reveals it.
		await page.waitFor(() => !document.querySelector('[data-tapestry-canvas]')?.hasAttribute('data-tapestry-pending'));
		await new Promise((r) => setTimeout(r, 50));
		const point = await page.eval(() => {
			const frame = document.querySelector('[data-tapestry-canvas]');
			frame.scrollIntoView({ block: 'nearest' });
			// The marker itself has no box (display: contents); click the component's element.
			const target = frame.contentDocument.querySelector('[data-tapestry-node="text-2"] > *');
			target.scrollIntoView({ block: 'center' });
			const f = frame.getBoundingClientRect();
			const t = target.getBoundingClientRect();
			return { x: f.left + t.left + t.width / 2, y: f.top + t.top + t.height / 2 };
		});
		for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
			await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
		await page.waitFor(() => Boolean(document.querySelector('[data-tp-row="text-2"][aria-selected="true"]')), [], {
			message: 'text-2 revealed and selected',
		});
		await page.click('[data-tp-expand-all]');
		await page.waitFor(() => document.querySelectorAll('.tp-row').length === 9);
	});

	await step('a name shows in the page structure and on the canvas chip; it is saved but never rendered', async () => {
		await page.click('[data-tp-row="hero-1"] .tp-row__label');
		await page.waitFor(() => !document.querySelector('[data-tapestry-canvas]').hasAttribute('data-tapestry-pending'));
		await page.fill('[data-tp-node-label]', 'Main  hero banner');
		await page.waitFor(
			() => document.querySelector('[data-tp-row="hero-1"] [data-tp-row-name]')?.textContent === 'Main hero banner',
			[],
			{ message: 'name in the row (spaces collapsed)' },
		);
		await page.waitFor(
			() =>
				document
					.querySelector('[data-tapestry-canvas]')
					.contentDocument.querySelector('.tc-chip')
					?.textContent.includes('Hero – Main hero banner'),
			[],
			{ message: 'name on the canvas chip' },
		);
		assert.equal(
			await page.eval(() => document.querySelector('[data-tapestry-canvas]').hasAttribute('data-tapestry-pending')),
			false,
			'renaming does not re-render the canvas',
		);
		assert.equal((await working(page)).root[0].label, 'Main hero banner');
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		const html = await (await get('/')).text();
		assert.doesNotMatch(html, /Main hero banner/, 'labels never reach the public page');
		if (SHOTS) await page.screenshot(`${SHOTS}/layers.png`);
	});

	await step('copy and paste a container (fresh ids); cut and paste moves it', async () => {
		const before = allIds(await working(page));
		await page.click('[data-tp-row="columns-1"] .tp-row__label');
		await clipboard(page, 'copy');
		await page.click('[data-tp-row="button-1"] .tp-row__label');
		await clipboard(page, 'paste');
		await page.waitFor((n) => document.querySelectorAll('.tp-row').length === n, [before.length + 4], {
			message: 'pasted columns with three texts',
		});
		const doc = await working(page);
		const pasted = doc.root[2].children[1];
		assert.equal(pasted.type, 'columns');
		assert.equal(pasted.children.length, 3);
		assert.equal(
			allIds({ root: [pasted] }).some((id) => before.includes(id)),
			false,
			'fresh ids',
		);
		assert.equal(
			await page.eval(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow),
			pasted.id,
			'the pasted copy is selected',
		);
		// Cut the copy and paste it at the top level, after the hero.
		await clipboard(page, 'cut');
		await page.waitFor((n) => document.querySelectorAll('.tp-row').length === n, [before.length]);
		await page.click('[data-tp-row="hero-1"] .tp-row__label');
		await clipboard(page, 'paste');
		await page.waitFor((n) => document.querySelectorAll('.tp-row').length === n, [before.length + 4]);
		assert.equal((await working(page)).root[1].type, 'columns');
	});

	await step('pasting works after a reload (between pages); other clipboard text is ignored', async () => {
		await page.click('[data-tp-row="heading-1"] .tp-row__label');
		await clipboard(page, 'copy');
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		await openEditor(page, pageId);
		const count = await page.eval(() => document.querySelectorAll('.tp-row').length);
		await page.click('[data-tp-row="hero-1"] .tp-row__label');
		await clipboard(page, 'paste');
		await page.waitFor((n) => document.querySelectorAll('.tp-row').length === n, [count + 1], {
			message: 'heading pasted after reload',
		});
		assert.equal((await working(page)).root[1].type, 'heading');
		// Plain text on the clipboard: nothing happens.
		await page.eval(() => navigator.clipboard.writeText('just some text'));
		await clipboard(page, 'paste');
		await new Promise((r) => setTimeout(r, 200));
		assert.equal(await page.eval(() => document.querySelectorAll('.tp-row').length), count + 1);
	});

	await step('dragging near the edge of the window scrolls it; hovering a collapsed container opens it', async () => {
		await page.send('Emulation.setDeviceMetricsOverride', {
			width: 1280,
			height: 520,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await page.click('[data-tp-toggle="section-1"]');
		await page.waitFor(() => !document.querySelector('[data-tp-row="heading-1"]'));
		const start = await page.center('[data-tp-row="hero-1"] .tp-row__label');
		const scroller = () =>
			page.eval(() => {
				let el = document.querySelector('.tp-tree').parentElement;
				for (; el; el = el.parentElement) {
					const s = getComputedStyle(el).overflowY;
					if ((s === 'auto' || s === 'scroll') && el.scrollHeight > el.clientHeight) return el.scrollTop;
				}
				return document.scrollingElement.scrollTop;
			});
		const before = await scroller();
		await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
		await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
		const bottom = { x: start.x, y: 505 };
		for (let i = 1; i <= 40; i++) {
			await page.send('Input.dispatchMouseEvent', {
				type: 'mouseMoved',
				x: start.x,
				y: start.y + ((bottom.y - start.y) * Math.min(i, 10)) / 10,
				button: 'left',
				buttons: 1,
			});
			await new Promise((r) => setTimeout(r, 30));
		}
		const after = await scroller();
		await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
		await page.send('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			x: -10,
			y: -10,
			button: 'left',
			clickCount: 1,
		});
		assert.ok(after > before + 40, `scrolled while dragging (${before} → ${after})`);
		await page.send('Emulation.clearDeviceMetricsOverride');
		// Hover-to-open: drag button-1 over the collapsed section-1 and keep hovering.
		// The starting point; the target is measured once the drag has started (see below).
		// Select the row first: pressing it selects it, and a different settings panel can change the
		// page height (and so the scroll position) under the pointer. Then measure once nothing moves
		// (StudioCMS's dashboard container scrolls smoothly).
		await page.click('[data-tp-row="button-1"] .tp-row__label');
		await page.waitFor(() => document.querySelector('.tp-row[aria-selected="true"]')?.dataset.tpRow === 'button-1');
		await page.eval(() => document.querySelector('[data-tp-row="section-1"]').scrollIntoView({ block: 'center' }));
		const from = await page.waitFor(
			() =>
				new Promise((resolve) => {
					const at = () => document.querySelector('[data-tp-row="button-1"] .tp-row__label').getBoundingClientRect();
					const first = at();
					requestAnimationFrame(() =>
						requestAnimationFrame(() => {
							const r = at();
							resolve(r.top === first.top ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
						}),
					);
				}),
			[],
			{ message: 'scrolling settled' },
		);
		await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
		await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', clickCount: 1 });
		// Start the drag, then measure the target: drop zones appear once a drag starts and move rows down.
		for (let i = 1; i <= 3; i++) {
			await page.send('Input.dispatchMouseEvent', {
				type: 'mouseMoved',
				x: from.x,
				y: from.y - i * 4,
				button: 'left',
				buttons: 1,
			});
			await new Promise((r) => setTimeout(r, 40));
		}
		const target = await page.eval(() => {
			const r = document.querySelector('[data-tp-row="section-1"] .tp-row__label').getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		for (let i = 1; i <= 40; i++) {
			const t = Math.min(i, 10) / 10;
			await page.send('Input.dispatchMouseEvent', {
				type: 'mouseMoved',
				x: from.x + (target.x - from.x) * t + (i % 2),
				y: from.y - 12 + (target.y - from.y + 12) * t,
				button: 'left',
				buttons: 1,
			});
			await new Promise((r) => setTimeout(r, 30));
		}
		const opened = await page.eval(() => Boolean(document.querySelector('[data-tp-row="heading-1"]')));
		// Drop back on the dragged row itself: no change.
		await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from, button: 'left', buttons: 1 });
		await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...from, button: 'left', clickCount: 1 });
		assert.equal(opened, true, 'collapsed container opened while hovering');
	});

	await step(
		'keyboard help sits behind info buttons (✕, Escape, click outside); icon buttons have labels',
		async () => {
			const labels = await page.eval(() =>
				['[data-tp-collapse-all]', '[data-tp-expand-all]', '[data-tp-info="tp-layers-help"]'].map((sel) => {
					const el = document.querySelector(sel);
					return [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent.trim()];
				}),
			);
			assert.deepEqual(labels, [
				['Collapse all', 'Collapse all', ''],
				['Expand all', 'Expand all', ''],
				['Keyboard shortcuts for the page structure', 'Keyboard shortcuts for the page structure', ''],
			]);
			// The shortcuts stay available to screen readers as the tree's description.
			assert.match(
				await page.eval(
					() =>
						document.getElementById(document.querySelector('.tp-tree').getAttribute('aria-describedby')).textContent,
				),
				/Alt\+↑ \/ ↓ move/,
			);
			const open = (id) => page.eval((i) => Boolean(document.getElementById(i)), id);
			await page.click('[data-tp-info="tp-layers-help"]');
			await page.waitFor(() => document.activeElement?.id === 'tp-layers-help', [], { message: 'popover focused' });
			assert.match(await page.eval(() => document.getElementById('tp-layers-help').textContent), /Ctrl\/⌘\+Zundo/);
			// Left-aligned with its button (opening away from StudioCMS's sidebars), never under the inner sidebar.
			const place = await page.eval(() => {
				const panel = document.getElementById('tp-layers-help').getBoundingClientRect();
				const button = document.querySelector('[data-tp-info="tp-layers-help"]').getBoundingClientRect();
				const sidebar = document.getElementById('sui-sidebar-inner')?.getBoundingClientRect();
				return {
					aligned: Math.abs(panel.left - button.left) < 1 || panel.right <= document.documentElement.clientWidth,
					startsAtButton: panel.left >= button.left - 1,
					clearOfSidebar: !sidebar || panel.left >= sidebar.right - 1,
				};
			});
			assert.deepEqual(place, { aligned: true, startsAtButton: true, clearOfSidebar: true });
			await page.press('Escape');
			assert.equal(await open('tp-layers-help'), false);
			assert.equal(
				await page.eval(() => document.activeElement?.dataset.tpInfo),
				'tp-layers-help',
				'focus back on the button',
			);
			await page.click('[data-tp-info="tp-layers-help"]');
			await page.click('#tp-layers-help [data-tp-info-close]');
			assert.equal(await open('tp-layers-help'), false);
			await page.click('[data-tp-info="tp-canvas-help"]');
			assert.match(await page.eval(() => document.getElementById('tp-canvas-help').textContent), /Escdeselect/);
			await page.click('.tp-panel__title');
			assert.equal(await open('tp-canvas-help'), false, 'closed by a click outside');
			// The canvas footer keeps at least 8px of padding.
			const padding = await page.eval(() => getComputedStyle(document.querySelector('.tp-canvas__footer')).paddingTop);
			assert.ok(Number.parseFloat(padding) >= 8, `footer padding ${padding}`);
		},
	);

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Layers suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/layers-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
}
