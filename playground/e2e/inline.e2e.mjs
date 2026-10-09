// End-to-end tests for editing rich text directly on the canvas
// (docs/decisions/0013-inline-canvas-editing.md) and the remove-formatting button.
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after.
import assert from 'node:assert/strict';
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

const pageId = await homePageId();
const TEXT = '[data-tapestry-text="text-3"][data-tapestry-prop="body"]';
const BAR = '#tapestry-canvas-overlay .tc-format';
const barButton = (name) => `${BAR} [data-tapestry-format="${name}"]`;

const findIn = (nodes, id) => {
	for (const node of nodes) {
		if (node.id === id) return node;
		const found = findIn(node.children ?? [], id);
		if (found) return found;
	}
	return null;
};
const body = async (page) => findIn((await working(page)).root, 'text-3')?.props.body;
const plain = (value) =>
	(value?.content ?? []).map((b) => (b.content ?? []).map((i) => i.text ?? '').join('')).join('\n');

/** Evaluate `fn(canvasDocument, ...args)` inside the canvas iframe. */
function inCanvas(page, fn, ...args) {
	return page.eval(
		(source, fnArgs) => {
			const frame = document.querySelector('[data-tapestry-canvas]');
			return Function(`return (${source})`)()(frame.contentDocument, ...fnArgs);
		},
		fn.toString(),
		args,
	);
}

/** Top-level viewport point inside an element of the canvas iframe. */
function canvasPoint(page, selector, { xFraction = 0.5, scroll = true } = {}) {
	return page.eval(
		(sel, xf, doScroll) => {
			const frame = document.querySelector('[data-tapestry-canvas]');
			frame.scrollIntoView({ block: 'nearest' });
			const el = frame.contentDocument.querySelector(sel);
			if (!el) throw new Error(`no canvas element ${sel}`);
			if (doScroll) el.scrollIntoView({ block: 'center' });
			const box = el.getBoundingClientRect();
			const frameBox = frame.getBoundingClientRect();
			return { x: frameBox.left + box.left + box.width * xf, y: frameBox.top + box.top + box.height / 2 };
		},
		selector,
		xFraction,
		scroll,
	);
}

async function mouse(page, { x, y }, clickCount = 1) {
	await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
	for (let n = 1; n <= clickCount; n++) {
		await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n });
		await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n });
	}
}

/** Click a toolbar element inside the canvas (without scrolling the page under it). */
const clickInCanvas = async (page, selector) => mouse(page, await canvasPoint(page, selector, { scroll: false }));

const editing = (page) =>
	inCanvas(page, (d, sel) => d.querySelector(sel)?.hasAttribute('data-tapestry-editing') ?? false, TEXT);
const waitEditing = (page, on, message) =>
	page.waitFor(
		(sel, want) => {
			const el = document.querySelector('[data-tapestry-canvas]').contentDocument.querySelector(sel);
			return (el?.hasAttribute('data-tapestry-editing') ?? false) === want;
		},
		[TEXT, on],
		{ message },
	);
const barVisible = (page) =>
	inCanvas(
		page,
		(d, sel) => {
			const bar = d.querySelector(sel);
			return Boolean(bar && getComputedStyle(bar).display !== 'none' && bar.querySelector('[data-tapestry-format]'));
		},
		BAR,
	);
const waitBar = (page) =>
	page.waitFor(
		(sel) => {
			const bar = document.querySelector('[data-tapestry-canvas]').contentDocument.querySelector(sel);
			return Boolean(bar && getComputedStyle(bar).display !== 'none' && bar.querySelector('[data-tapestry-format]'));
		},
		[BAR],
		{ message: 'toolbar shown' },
	);

/** Select all text inside the inline editor (a DOM selection in the iframe). */
async function selectAllInline(page) {
	await inCanvas(
		page,
		(d, sel) => {
			const el = d.querySelector(sel);
			el.focus();
			const range = d.createRange();
			range.selectNodeContents(el);
			const s = d.getSelection();
			s.removeAllRanges();
			s.addRange(range);
		},
		TEXT,
	);
	await new Promise((r) => setTimeout(r, 80));
}

const type = (page, text) => page.send('Input.insertText', { text });

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;

try {
	const cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('reset; rich text is marked for inline editing on the canvas only', async () => {
		await resetToDemo(page, pageId);
		await openEditor(page, pageId);
		await page.waitFor(
			(sel) => Boolean(document.querySelector('[data-tapestry-canvas]')?.contentDocument?.querySelector(sel)),
			[TEXT],
			{ timeout: 20_000, message: 'canvas text marker' },
		);
		assert.doesNotMatch(await (await get('/')).text(), /tapestry-canvas-text|data-tapestry-text/);
	});

	await step('one click on text selects the component and edits it there, toolbar under the chip', async () => {
		await mouse(page, await canvasPoint(page, `${TEXT} p`, { xFraction: 0.3 }));
		await waitEditing(page, true, 'inline editing started');
		await waitBar(page);
		assert.equal(
			await page.eval(() => document.querySelector('[data-tp-row="text-3"]')?.getAttribute('aria-selected')),
			'true',
		);
		assert.equal(
			await inCanvas(page, (d, sel) => d.activeElement === d.querySelector(sel), TEXT),
			true,
			'caret in the text',
		);
		const layout = await inCanvas(
			page,
			(d, textSel, barSel) => {
				const text = d.querySelector(`${textSel} p`).getBoundingClientRect();
				const bar = d.querySelector(barSel).getBoundingClientRect();
				const chip = d.querySelector('[data-tapestry-chip]').getBoundingClientRect();
				return {
					barUnderChip: Math.round(bar.top) >= Math.round(chip.bottom),
					clearOfText: bar.bottom <= text.top || bar.top >= text.bottom,
					outline: getComputedStyle(d.querySelector(textSel)).outlineStyle,
					buttons: [...d.querySelectorAll(`${barSel} [data-tapestry-format]`)].map((b) => b.dataset.tapestryFormat),
				};
			},
			TEXT,
			BAR,
		);
		assert.deepEqual(layout, {
			barUnderChip: true,
			clearOfText: true,
			outline: 'none',
			buttons: [
				'heading',
				'bold',
				'italic',
				'strike',
				'subscript',
				'superscript',
				'link',
				'bulletList',
				'orderedList',
				'blockquote',
				'horizontalRule',
				'media',
				'align',
				'clearFormatting',
			],
		});
		if (SHOTS) await page.screenshot(`${SHOTS}/inline-editing.png`);
	});

	await step('the settings panel points to the canvas; the field is one click away', async () => {
		const note = await page.eval(() => document.querySelector('[data-tapestry-canvas-note]')?.textContent ?? '');
		assert.match(note, /directly on the canvas/);
		assert.equal(
			await page.eval(() => Boolean(document.querySelector('#tp-field-text-3-body[contenteditable]'))),
			false,
		);
	});

	await step('typing on the canvas updates the document without re-rendering', async () => {
		await selectAllInline(page);
		await type(page, 'Inline edit');
		assert.equal(plain(await body(page)), 'Inline edit');
		assert.equal(await editing(page), true, 'still editing');
		assert.equal(
			await page.eval(() => document.querySelector('[data-tapestry-canvas]').hasAttribute('data-tapestry-pending')),
			false,
		);
	});

	await step('the toolbar formats without ending the edit; links use the toolbar form', async () => {
		await clickInCanvas(page, barButton('bold'));
		await type(page, ' bold');
		assert.equal(await editing(page), true);
		await clickInCanvas(page, barButton('link'));
		await page.waitFor(() => {
			const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
			const input = d.querySelector('.tc-format [data-tapestry-link-form] input');
			return Boolean(input) && d.activeElement === input;
		});
		// The address field has focus inside the canvas: type and press Enter.
		await type(page, '/docs');
		await page.press('Enter');
		await page.waitFor(
			() =>
				!document.querySelector('[data-tapestry-canvas]').contentDocument.querySelector('[data-tapestry-link-form]'),
		);
		assert.equal(await editing(page), true, 'the link form did not end editing');
		const runs = (await body(page)).content[0].content;
		assert.deepEqual(runs[1], { type: 'text', marks: [{ type: 'bold' }], text: ' bold' });
		assert.deepEqual(runs.at(-1).marks, [{ type: 'link', attrs: { href: '/docs' } }, { type: 'bold' }]);
	});

	await step('Remove formatting strips bold and links from the selection', async () => {
		await selectAllInline(page);
		await clickInCanvas(page, barButton('clearFormatting'));
		const runs = (await body(page)).content[0].content;
		assert.equal(runs.length, 1, 'one plain run');
		assert.equal(runs[0].marks, undefined);
		assert.equal(runs[0].text, 'Inline edit bold/docs');
	});

	await step('other changes re-render the canvas and editing continues', async () => {
		await page.click('.tp-toolbar [title^="Undo"]');
		await page.waitFor(
			(sel) => {
				const frame = document.querySelector('[data-tapestry-canvas]');
				const el = frame.contentDocument.querySelector(sel);
				return (
					!frame.hasAttribute('data-tapestry-pending') &&
					el?.hasAttribute('data-tapestry-editing') &&
					el.textContent !== 'Inline edit bold/docs'
				);
			},
			[TEXT],
			{ message: 'undo re-rendered, still editing' },
		);
		await page.click('.tp-toolbar [title^="Redo"]');
		await page.waitFor(
			(sel) =>
				document.querySelector('[data-tapestry-canvas]').contentDocument.querySelector(sel)?.textContent ===
				'Inline edit bold/docs',
			[TEXT],
			{ message: 'redo shown' },
		);
		assert.equal(await editing(page), true);
	});

	await step('Escape stops editing (the component stays selected); clicking the text resumes', async () => {
		await inCanvas(page, (d, sel) => d.querySelector(sel).focus(), TEXT);
		await page.press('Escape');
		await waitEditing(page, false, 'editing stopped');
		assert.equal(await barVisible(page), false);
		assert.equal(
			await page.eval(() => document.querySelector('[data-tp-row="text-3"]')?.getAttribute('aria-selected')),
			'true',
		);
		await mouse(page, await canvasPoint(page, `${TEXT} p`));
		await waitEditing(page, true, 'editing again');
	});

	await step('selecting in the page structure makes the text editable without taking focus', async () => {
		await page.click('[data-tp-row="heading-1"] .tp-row__label');
		await waitEditing(page, false, 'stopped on selection change');
		await page.click('[data-tp-row="text-3"] .tp-row__label');
		await waitEditing(page, true, 'editable after selecting in the tree');
		await waitBar(page);
		assert.equal(
			await page.eval(() => document.activeElement?.closest('[data-tp-row]')?.dataset.tpRow),
			'text-3',
			'focus stays in the tree',
		);
	});

	await step('the settings field ("Edit here instead") has Remove formatting too', async () => {
		await page.click('[data-tapestry-edit-here]');
		await page.waitFor(() =>
			Boolean(
				document.querySelector(
					'[data-tapestry-richtext="tp-field-text-3-body"] [data-tapestry-format="clearFormatting"]',
				),
			),
		);
		await page.eval(() => {
			const el = document.querySelector('#tp-field-text-3-body');
			el.focus();
			const range = document.createRange();
			range.selectNodeContents(el);
			getSelection().removeAllRanges();
			getSelection().addRange(range);
		});
		await new Promise((r) => setTimeout(r, 60));
		await page.click('[data-tapestry-richtext="tp-field-text-3-body"] [data-tapestry-format="bold"]');
		assert.deepEqual((await body(page)).content[0].content[0].marks, [{ type: 'bold' }]);
		await page.click('[data-tapestry-richtext="tp-field-text-3-body"] [data-tapestry-format="clearFormatting"]');
		assert.equal((await body(page)).content[0].content[0].marks, undefined);
	});

	await step('style and alignment menus: icons follow the text; mouse and keyboard both work', async () => {
		const formatValue = (format) =>
			inCanvas(
				page,
				(d, sel) => {
					const b = d.querySelector(sel);
					return { text: b.textContent.trim(), value: b.dataset.value };
				},
				`${BAR} [data-tapestry-format="${format}"]`,
			);
		assert.equal((await formatValue('heading')).text, 'P');
		await clickInCanvas(page, barButton('heading'));
		await clickInCanvas(page, `${BAR} [data-tapestry-menu-item="2"]`);
		assert.equal((await body(page)).content[0].type, 'heading');
		assert.equal((await body(page)).content[0].attrs.level, 2);
		assert.equal((await formatValue('heading')).text, 'H2', 'style icon shows H2');

		await clickInCanvas(page, barButton('align'));
		const inside = await inCanvas(
			page,
			(d, sel) => {
				const menu = d.querySelector(sel).getBoundingClientRect();
				return menu.left >= 0 && menu.right <= d.documentElement.clientWidth;
			},
			`${BAR} [data-tapestry-menu="align"]`,
		);
		assert.equal(inside, true, 'the alignment menu stays inside the canvas');
		await clickInCanvas(page, `${BAR} [data-tapestry-menu-item="center"]`);
		assert.equal((await body(page)).content[0].attrs.textAlign, 'center');
		assert.equal((await formatValue('align')).value, 'center', 'alignment icon shows center');

		// Keyboard: ArrowDown opens the menu on its first item; arrows move; Enter picks.
		await inCanvas(page, (d, sel) => d.querySelector(sel).focus(), barButton('align'));
		await page.press('ArrowDown');
		await page.waitFor(
			(sel) => {
				const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
				return d.activeElement?.matches(sel);
			},
			[`${BAR} [data-tapestry-menu-item=""]`],
		);
		await page.press('ArrowDown'); // left
		await page.press('ArrowDown'); // center
		await page.press('ArrowDown'); // right
		await page.press('Enter');
		assert.equal((await body(page)).content[0].attrs.textAlign, 'right');
		// Let the toolbar settle (the menu closes and the icon updates) before moving focus.
		await page.waitFor(
			(sel) => {
				const frame = document.querySelector('[data-tapestry-canvas]');
				const d = frame.contentDocument;
				return (
					!frame.hasAttribute('data-tapestry-pending') &&
					!d.querySelector(`${sel} [data-tapestry-menu]`) &&
					d.querySelector(`${sel} [data-tapestry-format="align"]`)?.dataset.value === 'right'
				);
			},
			[BAR],
			{ message: 'toolbar settled after picking right' },
		);
		// Escape closes a menu without ending inline editing.
		await inCanvas(page, (d, sel) => d.querySelector(sel).focus(), barButton('heading'));
		await page.waitFor(
			(sel) => document.querySelector('[data-tapestry-canvas]').contentDocument.activeElement?.matches(sel),
			[barButton('heading')],
			{ message: 'style button focused' },
		);
		await page.press('ArrowDown');
		await page.waitFor(() => {
			const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
			return Boolean(d.activeElement?.closest('[data-tapestry-menu]'));
		});
		await page.press('Escape');
		assert.equal(await inCanvas(page, (d, sel) => Boolean(d.querySelector(sel)), `${BAR} [data-tapestry-menu]`), false);
		assert.equal(await editing(page), true, 'still editing');
	});

	await step('plain text props are editable on the page too (no component changes needed)', async () => {
		const plainIn = (sel) =>
			inCanvas(page, (d, s) => d.querySelector(s)?.getAttribute('data-tapestry-plain') ?? null, sel);
		await page.press('Escape');
		// Ending the rich text edit re-renders the canvas; let that finish first.
		await new Promise((r) => setTimeout(r, 300));
		await page.waitFor(() => !document.querySelector('[data-tapestry-canvas]').hasAttribute('data-tapestry-pending'));
		await mouse(page, await canvasPoint(page, '[data-tapestry-node="hero-1"] h1'));
		await page.waitFor(
			() =>
				document
					.querySelector('[data-tapestry-canvas]')
					.contentDocument.querySelector('[data-tapestry-node="hero-1"] h1')
					?.getAttribute('data-tapestry-plain') === 'heading',
			[],
			{ message: 'hero heading editable' },
		);
		assert.equal(await plainIn('[data-tapestry-node="hero-1"] .hero__cta'), 'ctaLabel', 'the button label too');
		// Click into the heading (real input, so focus moves into the canvas), then select its text and replace it.
		await mouse(page, await canvasPoint(page, '[data-tapestry-node="hero-1"] h1', { scroll: false }));
		await page.waitFor(
			() => {
				const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
				return d.activeElement === d.querySelector('[data-tapestry-node="hero-1"] h1') && d.hasFocus();
			},
			[],
			{ message: 'caret in the heading' },
		);
		// Selecting the hero ended the previous text edit, which re-renders the canvas: the caret
		// must survive that (focus and caret are restored after the swap).
		await new Promise((r) => setTimeout(r, 300));
		await page.waitFor(() => !document.querySelector('[data-tapestry-canvas]').hasAttribute('data-tapestry-pending'));
		await page.waitFor(
			() => {
				const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
				return d.activeElement === d.querySelector('[data-tapestry-node="hero-1"] h1');
			},
			[],
			{ message: 'caret still in the heading after the re-render' },
		);
		await page.eval(() => {
			const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
			const h1 = d.querySelector('[data-tapestry-node="hero-1"] h1');
			h1.dataset.e2eSame = 'yes';
			const range = d.createRange();
			range.selectNodeContents(h1);
			d.getSelection().removeAllRanges();
			d.getSelection().addRange(range);
		});
		await page.send('Input.insertText', { text: 'Typed on the page' });
		assert.equal((await working(page)).root[0].props.heading, 'Typed on the page');
		await new Promise((r) => setTimeout(r, 400)); // longer than the render debounce
		assert.equal(
			await inCanvas(page, (d) => d.querySelector('[data-tapestry-node="hero-1"] h1')?.dataset.e2eSame ?? null),
			'yes',
			'typing does not re-render (same element, caret kept)',
		);
		// Enter finishes; the settings field shows the new value.
		await page.press('Enter');
		await page.waitFor(() => {
			const d = document.querySelector('[data-tapestry-canvas]').contentDocument;
			return d.activeElement !== d.querySelector('[data-tapestry-node="hero-1"] h1');
		});
		assert.equal(await page.eval(() => document.querySelector('#tp-field-hero-1-heading')?.value), 'Typed on the page');
		// Undo (from inside the canvas) puts the old text back on the page.
		const isMac = process.platform === 'darwin';
		await page.press('z', [isMac ? 'Meta' : 'Control']);
		await page.waitFor(
			() =>
				document
					.querySelector('[data-tapestry-canvas]')
					.contentDocument.querySelector('[data-tapestry-node="hero-1"] h1')?.textContent !== 'Typed on the page',
			[],
			{ message: 'undo restored the heading on the page' },
		);
		// A container's selection doesn't make its children's text editable.
		await page.click('[data-tp-row="section-1"] .tp-row__label');
		await page.waitFor(
			() =>
				document.querySelector('[data-tapestry-canvas]').contentDocument.querySelectorAll('[data-tapestry-plain]')
					.length === 0,
			[],
			{ message: 'no editable text for the section' },
		);
	});

	await step('inline edits save and publish like any other edit', async () => {
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		assert.match(await (await get('/')).text(), /Inline edit bold\/docs/);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Inline editing suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/inline-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
	db.close();
}
