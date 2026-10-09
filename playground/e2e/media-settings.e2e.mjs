// End-to-end tests for the media library's upload settings (docs/decisions/0018-media-upload-settings.md):
// Plugins → Media Library → Uploads changes the size limits and the SVG switch, and uploads follow them.
//
// Prereqs: same as editor.e2e.mjs. Removes the saved settings and every media item it creates.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, db, get, login, SHOTS, step, summary } from './helpers.mjs';

// StudioCMS 0.6.1 links plugin pages without the slash after "plugins" (known issue #27).
const SETTINGS_PAGE = '/dashboard/plugins@nascencestudio/medialibrary';
const SETTINGS_PAGE_FIXED = '/dashboard/plugins/@nascencestudio/medialibrary';
const MEDIA_PAGE = '/dashboard/nascencestudio_medialibrary/media';
const ROW_ID = '@nascencestudio/medialibrary-settings';
const MB = 1024 * 1024;
const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

const stored = async () => {
	const row = (await db.execute({ sql: 'select data from StudioCMSPluginData where id = ?', args: [ROW_ID] })).rows[0];
	return row ? JSON.parse(String(row.data)) : null;
};
const mediaIds = async () =>
	new Set((await db.execute('select id from NascenceMediaItems').catch(() => ({ rows: [] }))).rows.map((r) => r.id));

/** Save settings through the endpoint, as the settings form would. */
function save(cookie, values, { origin = BASE, ret = SETTINGS_PAGE } = {}) {
	return fetch(`${BASE}/_media/settings`, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			Origin: origin,
			'Content-Type': 'application/x-www-form-urlencoded',
			...(cookie ? { Cookie: `auth_session=${cookie}` } : {}),
		},
		body: new URLSearchParams({ return: ret, ...values }).toString(),
	});
}
const limits = (image, video = 200, audio = 100, document = 25) => ({
	'limit-image': String(image),
	'limit-video': String(video),
	'limit-audio': String(audio),
	'limit-document': String(document),
});

/** Upload through the API, as the library does. */
function upload(cookie, name, body) {
	return fetch(`${BASE}/_media/api/upload`, {
		method: 'POST',
		headers: { Origin: BASE, Cookie: `auth_session=${cookie}`, 'X-File-Name': encodeURIComponent(name) },
		body,
	});
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
const scratch = mkdtempSync(join(tmpdir(), 'media-settings-'));
let page;
let cookie;
let before = new Set();
const savedBefore = await stored();

try {
	cookie = await login();
	before = await mediaIds();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('the endpoint refuses visitors, other origins and invalid values', async () => {
		assert.equal((await save(null, limits(10))).status, 403, 'anonymous');
		assert.equal((await save(`${cookie}x`, limits(10))).status, 403, 'forged session');
		assert.equal((await save(cookie, limits(10), { origin: 'https://evil.example' })).status, 403, 'cross-origin');
		const bad = await save(cookie, { ...limits(10, 0), 'limit-audio': '5000' });
		assert.equal(bad.status, 303);
		assert.equal(bad.headers.get('location'), `${SETTINGS_PAGE}?error=video,audio`);
		assert.deepEqual(await stored(), savedBefore, 'nothing saved');
		const offsite = await save(cookie, { ...limits(10), 'allow-svg': 'on' }, { ret: 'https://evil.example/x' });
		assert.equal(offsite.headers.get('location'), '/?saved=1', 'never redirects off-site');
		assert.deepEqual(await stored(), {
			version: 1,
			limits: { image: 10 * MB, video: 200 * MB, audio: 100 * MB, document: 25 * MB },
			allowSvg: true,
		});
	});

	await step('admins find Media Library under Plugins, with the current settings', async () => {
		assert.notEqual((await get(SETTINGS_PAGE)).status, 200, 'visitors are redirected');
		assert.equal((await get(SETTINGS_PAGE_FIXED, cookie)).status, 200, 'also served at the intended URL');
		assert.equal(
			(await get('/somewhere/plugins/@nascencestudio/medialibrary', cookie)).status,
			404,
			'only under the dashboard',
		);
		await page.goto(`${BASE}${SETTINGS_PAGE}`);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-settings]')));
		const state = await page.eval(() => ({
			limits: [...document.querySelectorAll('[data-media-settings-limit]')].map((i) => [
				i.dataset.mediaSettingsLimit,
				i.value,
				i.max,
			]),
			svg: document.querySelector('[data-media-settings-svg]').checked,
			plugins: [...document.querySelectorAll('.sidebar-plugin-link')].map((a) => [
				a.getAttribute('href'),
				a.querySelector('.sidebar-plugin-name')?.textContent.trim(),
			]),
			sections: document.querySelector('[data-media-settings-nav]')?.innerText.includes('Uploads'),
		}));
		assert.deepEqual(state.limits, [
			['image', '10', '1024'],
			['video', '200', '1024'],
			['audio', '100', '1024'],
			['document', '25', '1024'],
		]);
		assert.equal(state.svg, true);
		assert.ok(
			state.plugins.some(([href, name]) => href === SETTINGS_PAGE && name === 'Media Library'),
			'listed under Plugins',
		);
		assert.equal(state.sections, true, 'Uploads is a Media Library section');
	});

	await step('changing a limit and turning SVG off saves the settings', async () => {
		await page.fill('[data-media-settings-limit="image"]', '1');
		await page.click('[data-media-settings-svg]');
		await page.click('[data-media-settings-save]');
		await page.waitFor(() => Boolean(document.querySelector('[data-media-settings-saved]')), [], {
			message: 'saved message',
		});
		if (SHOTS) await page.screenshot(`${SHOTS}/media-settings.png`);
		const settings = await stored();
		assert.equal(settings.limits.image, MB);
		assert.equal(settings.allowSvg, false);
		const shown = await page.eval(() => [
			document.querySelector('[data-media-settings-limit="image"]').value,
			document.querySelector('[data-media-settings-svg]').checked,
		]);
		assert.deepEqual(shown, ['1', false]);
	});

	await step('the server enforces the new limit and refuses SVGs', async () => {
		const png = readFileSync(`${FIXTURES}/sample.png`);
		const big = Buffer.concat([png, Buffer.alloc(MB + 1024)]);
		const tooBig = await upload(cookie, 'big.png', big);
		assert.equal(tooBig.status, 413);
		assert.match((await tooBig.json()).error, /Image files can be at most 1 MB/);
		const svg = await upload(cookie, 'logo.svg', SVG);
		assert.equal(svg.status, 415);
		assert.equal((await svg.json()).error, 'SVG uploads are turned off.');
		assert.equal((await upload(cookie, 'small.png', png)).status, 201, 'small images still upload');
		const api = await (await get('/_media/api/settings', cookie)).json();
		assert.deepEqual(api.settings, {
			limits: { image: MB, video: 200 * MB, audio: 100 * MB, document: 25 * MB },
			allowSvg: false,
		});
	});

	await step(
		'the library follows the settings: no .svg in the dialog, large images refused before upload',
		async () => {
			await page.goto(`${BASE}${MEDIA_PAGE}`);
			await page.waitFor(() => Boolean(document.querySelector('[data-media-library="manage"]')), [], {
				timeout: 20_000,
			});
			await page.waitFor(() => !document.querySelector('[data-media-file-input]').accept.includes('.svg'), [], {
				message: 'accept without .svg',
			});
			const big = join(scratch, 'large.png');
			writeFileSync(big, Buffer.concat([readFileSync(`${FIXTURES}/sample.png`), Buffer.alloc(2 * MB)]));
			const { root } = await page.send('DOM.getDocument', { depth: 1 });
			const { nodeId } = await page.send('DOM.querySelector', {
				nodeId: root.nodeId,
				selector: '[data-media-file-input]',
			});
			await page.send('DOM.setFileInputFiles', { nodeId, files: [big] });
			await page.waitFor(() => Boolean(document.querySelector('[data-media-upload-state="error"]')), [], {
				message: 'refused before upload',
			});
			const message = await page.eval(() => document.querySelector('[data-media-upload-state="error"]').textContent);
			assert.match(message, /Too large \(max 1(\.0)? MB\)/);
		},
	);

	await step('turning SVG back on allows sanitized SVG uploads again', async () => {
		assert.equal((await save(cookie, { ...limits(10), 'allow-svg': 'on' })).status, 303);
		const svg = await upload(cookie, 'logo.svg', SVG);
		assert.equal(svg.status, 201);
		assert.equal((await svg.json()).item.mime, 'image/svg+xml');
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Media settings suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/media-settings-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (cookie) {
		for (const id of await mediaIds()) {
			if (before.has(id)) continue;
			await fetch(`${BASE}/_media/api/items/${id}?force=1`, {
				method: 'DELETE',
				headers: { Origin: BASE, Cookie: `auth_session=${cookie}` },
			}).catch(() => {});
		}
	}
	if (savedBefore) {
		await db.execute({
			sql: 'update StudioCMSPluginData set data = ? where id = ?',
			args: [JSON.stringify(savedBefore), ROW_ID],
		});
	} else {
		await db.execute({ sql: 'delete from StudioCMSPluginData where id = ?', args: [ROW_ID] });
	}
	rmSync(scratch, { recursive: true, force: true });
	cdp.close();
	await chrome.close();
	db.close();
}
