// End-to-end tests for admin toolbar settings (docs/decisions/0014-admin-toolbar-settings.md):
// the dashboard "Text formatting" page narrows rich text toolbars in the editor.
//
// Prereqs: same as editor.e2e.mjs. Restores the settings and the demo page afterwards.
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
	step,
	summary,
	working,
} from './helpers.mjs';

const pageId = await homePageId();
// StudioCMS 0.6.1 links plugin pages without the slash after "plugins" (known issue #27).
const SETTINGS_PAGE = '/dashboard/plugins@nascencestudio/tapestry';
const SETTINGS_PAGE_FIXED = '/dashboard/plugins/@nascencestudio/tapestry';
const FULL = [
	'heading1',
	'heading2',
	'heading3',
	'heading4',
	'heading5',
	'heading6',
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
	'alignLeft',
	'alignCenter',
	'alignRight',
	'alignJustify',
	'clearFormatting',
];
const FIELD = '#tp-field-text-2-body';

const stored = async () => {
	const row = (
		await db.execute({
			sql: 'select data from StudioCMSPluginData where id = ?',
			args: ['@nascencestudio/tapestry-toolbars'],
		})
	).rows[0];
	return row ? JSON.parse(String(row.data)) : null;
};

/** Save settings through the endpoint, as the settings form would. */
async function save(cookie, buttons, { origin = BASE } = {}) {
	const form = new URLSearchParams({ return: SETTINGS_PAGE, 'field:text.body': '1' });
	for (const b of buttons) form.append('toolbar:text.body', b);
	return fetch(`${BASE}/_tapestry/settings`, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			Origin: origin,
			'Content-Type': 'application/x-www-form-urlencoded',
			...(cookie ? { Cookie: `auth_session=${cookie}` } : {}),
		},
		body: form.toString(),
	});
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let cookie;

try {
	cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('the endpoint refuses visitors, other origins and is limited to the developer toolbar', async () => {
		assert.equal((await save(null, ['bold'])).status, 403, 'anonymous');
		assert.equal((await save(`${cookie}x`, ['bold'])).status, 403, 'forged session');
		assert.equal((await save(cookie, ['bold'], { origin: 'https://evil.example' })).status, 403, 'cross-origin');
		const ok = await save(cookie, [...FULL, 'underline', 'sparkles']);
		assert.equal(ok.status, 303);
		assert.equal(ok.headers.get('location'), `${SETTINGS_PAGE}?saved=1`);
		assert.deepEqual((await stored()).disabled, {}, 'everything on; unknown buttons are ignored');
		const offsite = await fetch(`${BASE}/_tapestry/settings`, {
			method: 'POST',
			redirect: 'manual',
			headers: { Origin: BASE, Cookie: `auth_session=${cookie}`, 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ return: 'https://evil.example/x', 'field:text.body': '1' }).toString(),
		});
		assert.equal(offsite.headers.get('location'), '/?saved=1', 'never redirects off-site');
		await save(cookie, FULL);
	});

	await step('admins see the Text formatting page with the current choices', async () => {
		assert.notEqual((await get(SETTINGS_PAGE)).status, 200, 'visitors are redirected');
		assert.equal((await get(SETTINGS_PAGE_FIXED, cookie)).status, 200, 'also served at the intended URL');
		assert.equal(
			(await get('/somewhere/plugins/@nascencestudio/tapestry', cookie)).status,
			404,
			'only under the dashboard',
		);
		await page.goto(`${BASE}${SETTINGS_PAGE}`);
		await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-settings-field="text.body"]')));
		const boxes = await page.eval(() =>
			[...document.querySelectorAll('[data-tapestry-settings-field="text.body"] input[type=checkbox]')].map((b) => [
				b.value,
				b.checked,
			]),
		);
		assert.deepEqual(
			boxes,
			FULL.map((b) => [b, true]),
		);
		const placement = await page.eval(() => ({
			plugins: [...document.querySelectorAll('.sidebar-plugin-link')].map((a) => [
				a.getAttribute('href'),
				a.querySelector('.sidebar-plugin-name')?.textContent.trim(),
			]),
			sections: document.querySelector('[data-tapestry-settings-nav]')?.innerText.includes('Text formatting'),
		}));
		assert.ok(
			placement.plugins.some(([href, name]) => href === SETTINGS_PAGE && name === 'Tapestry'),
			'Tapestry is listed under Plugins',
		);
		assert.equal(placement.sections, true, 'Text formatting is a Tapestry section');
	});

	await step('unchecking buttons and saving updates the settings', async () => {
		await page.click('[data-tapestry-settings-button="italic"]');
		await page.click('[data-tapestry-settings-button="heading3"]');
		await page.click('[data-tapestry-settings-save]');
		await page.waitFor(() => Boolean(document.querySelector('[data-tapestry-settings-saved]')), [], {
			message: 'saved message',
		});
		if (SHOTS) await page.screenshot(`${SHOTS}/settings-page.png`);
		assert.deepEqual((await stored()).disabled['text.body'], ['heading3', 'italic']);
		const italic = await page.eval(() => document.querySelector('[data-tapestry-settings-button="italic"]').checked);
		assert.equal(italic, false);
	});

	await step('the editor toolbar follows the settings; disallowed formatting is not pasted', async () => {
		await resetToDemo(page, pageId);
		await openEditor(page, pageId);
		await page.click('[data-tp-row="text-2"] .tp-row__label');
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
		const styleButton = '[data-tapestry-richtext="tp-field-text-2-body"] [data-tapestry-format="heading"]';
		await page.click(styleButton);
		const levels = await page.eval(() =>
			[...document.querySelectorAll('[data-tapestry-menu="heading"] [data-tapestry-menu-item]')].map(
				(item) => item.dataset.tapestryMenuItem,
			),
		);
		await page.click(styleButton);
		assert.deepEqual(levels, ['0', '1', '2', '4', '5', '6'], 'Heading 3 is not offered');
		await page.eval((sel) => {
			const el = document.querySelector(sel);
			el.focus();
			const range = document.createRange();
			range.selectNodeContents(el);
			getSelection().removeAllRanges();
			getSelection().addRange(range);
			const data = new DataTransfer();
			data.setData('text/html', '<h3>Head</h3><p><i>slanted</i> <b>strong</b></p>');
			el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
		}, FIELD);
		await new Promise((r) => setTimeout(r, 200));
		const doc = await working(page);
		const json = JSON.stringify(doc.root[1].children[1].children[1].props.body);
		assert.match(json, /"marks":\[\{"type":"bold"\}\],"text":"strong"/);
		assert.doesNotMatch(json, /italic|"level":3/);
	});

	await step('the public page keeps rendering existing formatting', async () => {
		assert.match(await (await get('/')).text(), /<strong[^>]*>server-side<\/strong>/);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Settings suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/settings-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (cookie) await save(cookie, FULL).catch(() => {});
	if (page) await resetToDemo(page, pageId).catch((e) => console.error('Cleanup failed:', e));
	cdp.close();
	await chrome.close();
	db.close();
}
