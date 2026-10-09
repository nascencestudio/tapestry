// End-to-end tests for rich text fields (docs/decisions/0012-rich-text.md):
// toolbar limited to the prop's buttons, formatting, lists, headings, links,
// paste cleaning, undo sync, canvas preview, publish and safe public rendering.
//
// Prereqs: same as editor.e2e.mjs. Resets the demo home page before and after.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import {
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
const FIELD = '#tp-field-text-2-body';
const button = (name) => `[data-tapestry-richtext="tp-field-text-2-body"] [data-tapestry-format="${name}"]`;
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4321';

/** The text-2 node's stored body in the editor's working document. */
async function body(page) {
	const doc = await working(page);
	const find = (nodes) => {
		for (const n of nodes) {
			if (n.id === 'text-2') return n;
			const hit = find(n.children ?? []);
			if (hit) return hit;
		}
		return null;
	};
	return find(doc.root)?.props.body;
}

/** Put the caret at the end of the field (or select all of it) with a DOM selection. */
async function caret(page, { selectAll = false } = {}) {
	await page.eval(
		(sel, all) => {
			const el = document.querySelector(sel);
			el.focus();
			const range = document.createRange();
			range.selectNodeContents(el);
			if (!all) range.collapse(false);
			const selection = getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		},
		FIELD,
		selectAll,
	);
	await new Promise((r) => setTimeout(r, 60)); // ProseMirror syncs on selectionchange
}

const type = (page, text) => page.send('Input.insertText', { text });

const buttonText = (page, format) => page.eval((sel) => document.querySelector(sel).textContent.trim(), button(format));
const buttonValue = (page, format) => page.eval((sel) => document.querySelector(sel).dataset.value, button(format));

/** Pick an option from one of the field's toolbar menus ('heading' or 'align'), with real clicks. */
async function choose(page, format, value) {
	await page.click(button(format));
	const item = `[data-tapestry-richtext="tp-field-text-2-body"] [data-tapestry-menu="${format}"] [data-tapestry-menu-item="${value}"]`;
	await page.waitFor((sel) => Boolean(document.querySelector(sel)), [item]);
	await page.click(item);
	await page.waitFor((sel) => !document.querySelector(sel), [item], { message: 'menu closed' });
}
const publicHtml = async () => (await get('/')).text();

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;

try {
	const cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE_URL });

	await step('reset; the public page renders rich text and converted plain text', async () => {
		await resetToDemo(page, pageId);
		const html = await publicHtml();
		assert.match(html, /StudioCMS renders the tree <strong[^>]*>server-side<\/strong>/);
		assert.match(html, /<a href="\/#how-it-works"[^>]*>default<\/a>/);
		// text-2 was stored as a plain string: blank line → two paragraphs.
		assert.match(html, /<p[^>]*>Editors arrange them into a tree\.<\/p>\s*<p[^>]*>The tree is stored as JSON\.<\/p>/);
	});

	await step('the field shows exactly the toolbar the component allows', async () => {
		await openEditor(page, pageId);
		await page.click('[data-tp-row="text-2"] .tp-row__label');
		// Rich text is edited on the canvas by default; this suite tests the panel field.
		await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-edit-here]')));
		await page.click('[data-tapestry-edit-here]');
		await page.waitFor((sel) => Boolean(document.querySelector(sel)), [FIELD]);
		const buttons = await page.eval(() =>
			[...document.querySelectorAll('[data-tapestry-richtext="tp-field-text-2-body"] [data-tapestry-format]')].map(
				(b) => b.dataset.tapestryFormat,
			),
		);
		assert.deepEqual(buttons, [
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
		]);
		const paragraphs = await page.eval(
			(sel) => [...document.querySelectorAll(`${sel} > p`)].map((p) => p.textContent),
			FIELD,
		);
		assert.deepEqual(paragraphs, ['Editors arrange them into a tree.', 'The tree is stored as JSON.']);
		assert.equal(await page.eval((sel) => document.querySelector(sel).getAttribute('role'), FIELD), 'textbox');
		if (SHOTS) await page.screenshot(`${SHOTS}/richtext-field.png`);
	});

	await step('typing and Bold produce formatted rich text in the document', async () => {
		await caret(page, { selectAll: true });
		await type(page, 'Hello ');
		await page.click(button('bold'));
		assert.equal(
			await page.eval((sel) => document.querySelector(sel).getAttribute('aria-pressed'), button('bold')),
			'true',
		);
		await type(page, 'world');
		await page.click(button('bold'));
		const value = await body(page);
		assert.deepEqual(value, {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Hello ' },
						{ type: 'text', text: 'world', marks: [{ type: 'bold' }] },
					],
				},
			],
		});
		const label = await page.eval(
			() => document.querySelector('[data-tp-row="text-2"] .tp-row__summary')?.textContent ?? '',
		);
		assert.match(label, /Hello world/, 'layer tree summarizes rich text as plain text');
	});

	await step('lists and sub-headings from the toolbar and Enter', async () => {
		await caret(page);
		await page.press('Enter');
		await page.click(button('bulletList'));
		await type(page, 'First');
		await page.press('Enter');
		await type(page, 'Second');
		await page.press('Enter');
		await page.press('Enter'); // an empty item leaves the list
		await choose(page, 'heading', '3');
		await type(page, 'Sub');
		const { content } = await body(page);
		assert.deepEqual(
			content.map((b) => b.type),
			['paragraph', 'bulletList', 'heading'],
		);
		assert.deepEqual(
			content[1].content.map((li) => li.content[0].content[0].text),
			['First', 'Second'],
		);
		assert.deepEqual(content[2], { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sub' }] });
	});

	await step('links: unsafe addresses are refused, safe ones are inserted', async () => {
		await caret(page);
		await page.press('Enter');
		await type(page, 'Read ');
		await page.click(button('link'));
		await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-link-form] input')));
		await page.fill('[data-tapestry-link-form] input', 'javascript:alert(1)');
		await page.click('[data-tapestry-link-apply]');
		await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-link-form] [role="alert"]')));
		assert.doesNotMatch(JSON.stringify(await body(page)), /javascript/);
		await page.fill('[data-tapestry-link-form] input', 'https://docs.example.com');
		await page.press('Enter'); // applies the link; must not submit (save) the page
		await page.waitFor(() => !document.querySelector('[data-tapestry-link-form]'));
		const last = (await body(page)).content.at(-1);
		assert.deepEqual(last.content.at(-1), {
			type: 'text',
			text: 'https://docs.example.com',
			marks: [{ type: 'link', attrs: { href: 'https://docs.example.com' } }],
		});
	});

	await step('pasted HTML is reduced to what the toolbar allows; nothing executes', async () => {
		await caret(page);
		await page.press('Enter');
		await page.eval((sel) => {
			const data = new DataTransfer();
			data.setData(
				'text/html',
				'<h1>Big</h1><p>Para <b>bold</b> <u>under</u> <a href="javascript:window.__xss=1">bad</a> <a href="/ok">ok</a>' +
					'<img src="x" onerror="window.__xss=2"></p><script>window.__xss=3</script><table><tr><td>cell</td></tr></table>',
			);
			data.setData('text/plain', 'fallback');
			document
				.querySelector(sel)
				.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
		}, FIELD);
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(await page.eval(() => window.__xss), undefined);
		const json = JSON.stringify(await body(page));
		assert.match(json, /"marks":\[\{"type":"bold"\}\],"text":"bold"/);
		assert.match(json, /"href":"\/ok"/);
		assert.match(json, /"text":"cell"/);
		assert.match(json, /"type":"heading","attrs":\{"level":1\}/, 'H1 is allowed, so a pasted <h1> stays a heading');
		assert.doesNotMatch(json, /javascript|underline|image|onerror|__xss/);
	});

	await step('the canvas shows the formatting live', async () => {
		await page.waitFor(
			() => {
				const doc = document.querySelector('[data-tapestry-canvas]')?.contentDocument;
				return (
					doc && !doc.querySelector('[data-tapestry-pending]') && doc.querySelector('strong')?.textContent === 'world'
				);
			},
			[],
			{ timeout: 20_000, message: 'canvas shows <strong>world</strong>' },
		);
	});

	await step("Tapestry's Undo updates the field (values changed from outside sync in)", async () => {
		const before = JSON.stringify(await body(page));
		await page.click('.tp-toolbar [title^="Undo"]');
		const after = JSON.stringify(await body(page));
		assert.notEqual(after, before);
		const fieldText = await page.eval((sel) => document.querySelector(sel).textContent, FIELD);
		assert.equal(fieldText.includes('cell'), after.includes('"cell"'), 'field content follows the document');
		await page.click('.tp-toolbar [title^="Redo"]');
		assert.equal(JSON.stringify(await body(page)), before);
	});

	await step('heading levels, alignment, sub/superscript, strikethrough, quotes and lines', async () => {
		assert.equal(await buttonText(page, 'heading'), 'P', 'the style button shows the current block (a paragraph)');
		await page.click(button('heading'));
		const levels = await page.eval(() =>
			[...document.querySelectorAll('[data-tapestry-menu="heading"] [role="menuitemradio"]')].map((item) => [
				item.querySelector('.tp-glyph').textContent,
				item.textContent.replace(item.querySelector('.tp-glyph').textContent, '').trim(),
			]),
		);
		await page.click(button('heading')); // close the menu
		assert.deepEqual(levels, [
			['P', 'Paragraph'],
			['H1', 'Heading 1'],
			['H2', 'Heading 2'],
			['H3', 'Heading 3'],
			['H4', 'Heading 4'],
			['H5', 'Heading 5'],
			['H6', 'Heading 6'],
		]);
		await caret(page);
		await page.press('Enter');
		await choose(page, 'heading', '1');
		await type(page, 'Title');
		await choose(page, 'align', 'center');
		assert.equal(await buttonText(page, 'heading'), 'H1', 'the style icon follows the cursor');
		assert.equal(await buttonValue(page, 'align'), 'center', 'the alignment icon follows the cursor');
		await page.press('Enter');
		await type(page, 'H');
		await page.click(button('subscript'));
		await type(page, '2');
		await page.click(button('subscript'));
		await type(page, 'O and x');
		await page.click(button('superscript'));
		await type(page, '2');
		await page.click(button('superscript'));
		await page.press('Enter');
		await page.click(button('strike'));
		await type(page, 'gone');
		await page.click(button('strike'));
		await page.press('Enter');
		await page.click(button('blockquote'));
		await type(page, 'Quoted');
		await page.click(button('horizontalRule'));
		const { content } = await body(page);
		const json = JSON.stringify(content);
		assert.ok(
			content.some(
				(b) =>
					b.type === 'heading' &&
					b.attrs.level === 1 &&
					b.attrs.textAlign === 'center' &&
					b.content[0].text === 'Title',
			),
			'centered H1',
		);
		assert.match(json, /"marks":\[\{"type":"subscript"\}\],"text":"2"/);
		assert.match(json, /"marks":\[\{"type":"superscript"\}\],"text":"2"/);
		assert.match(json, /"marks":\[\{"type":"strike"\}\],"text":"gone"/);
		assert.match(json, /"type":"blockquote"/);
		assert.match(json, /"type":"horizontalRule"/);
		assert.doesNotMatch(json, /"textAlign":null/, 'unset alignment is not stored');
		assert.equal(await buttonValue(page, 'align'), '', 'new paragraph has the default alignment');
	});

	await step('Publish renders safe HTML on the public page', async () => {
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		const html = await publicHtml();
		assert.match(html, /Hello <strong[^>]*>world<\/strong>/);
		assert.match(html, /<ul[^>]*>\s*<li[^>]*>\s*<p[^>]*>First<\/p>/);
		assert.match(html, /<h3[^>]*>Sub<\/h3>/);
		assert.match(html, /<a href="https:\/\/docs\.example\.com"[^>]*>https:\/\/docs\.example\.com<\/a>/);
		assert.match(html, /<a href="\/ok"[^>]*>ok<\/a>/);
		assert.match(html, /<h1[^>]*style="text-align: center"[^>]*>Title<\/h1>/);
		assert.match(html, /H<sub>2<\/sub>O and x<sup>2<\/sup>/);
		assert.match(html, /<s>gone<\/s>/);
		assert.match(html, /<blockquote[^>]*>/);
		assert.match(html, /<hr/);
		assert.doesNotMatch(html, /javascript:|__xss|onerror/);
	});

	await step('hostile rich text applied as JSON is cleaned and escaped', async () => {
		const doc = await working(page);
		const text2 = doc.root[1].children[1].children[1];
		text2.props.body = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 7 }, content: [{ type: 'text', text: 'H7 not allowed' }] },
				{
					type: 'paragraph',
					attrs: { textAlign: 'center; background: url(//evil.example/x)' },
					content: [{ type: 'text', text: 'Style injection' }],
				},
				{ type: 'html', content: '<img src=x onerror=alert(1)>' },
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: '<script>alert(1)</script>' },
						{
							type: 'text',
							text: ' click',
							marks: [
								{ type: 'link', attrs: { href: 'jav\tascript:alert(1)', onclick: 'alert(1)' } },
								{ type: 'underline' },
							],
						},
					],
				},
			],
		};
		await page.click('[data-tapestry-json-toggle]');
		await page.fill('.tp-json textarea', JSON.stringify(doc, null, 2));
		await page.click('.tp-json .tp-button--primary');
		await page.waitFor(() => document.querySelectorAll('.tp-row').length > 0, [], { message: 'back in visual editor' });
		await saveAndWait(page, pageId, '[data-tapestry-publish]');
		const html = await publicHtml();
		assert.match(html, /<p[^>]*>H7 not allowed<\/p>/);
		assert.match(html, /<p>Style injection<\/p>/, 'an alignment outside the list is dropped');
		assert.doesNotMatch(html, /evil\.example/);
		assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; click/);
		assert.doesNotMatch(html, /<script>alert|jav\s*ascript|onclick|onerror/i);
		const text = /<div class="text"[^>]*>((?:(?!<\/div>)[\s\S])*H7 not allowed(?:(?!<\/div>)[\s\S])*)<\/div>/.exec(
			html,
		)?.[1];
		assert.ok(text, 'text component markup found');
		assert.doesNotMatch(text, /<u[ >]|<h7|<img|<a /, 'only allowed elements, and no link');
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Rich text suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/richtext-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
	const { db } = await import('./helpers.mjs');
	db.close();
}
