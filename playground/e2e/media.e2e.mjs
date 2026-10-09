// End-to-end tests for the media library (docs/decisions/0016-media-library.md):
// the dashboard Media page, uploads (file input), refusals, filters, alt text,
// remote videos, deleting, and public file serving.
//
// Prereqs: same as editor.e2e.mjs. Deletes every media item it creates.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, db, get, login, SHOTS, step, summary } from './helpers.mjs';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MEDIA_PAGE = '/dashboard/nascencestudio_medialibrary/media';

const rows = async () =>
	(await db.execute('select id, kind, name, alt, storageKey from NascenceMediaItems order by createdAt')).rows.map(
		(r) => ({ ...r }),
	);

async function setFiles(page, selector, files) {
	const { root } = await page.send('DOM.getDocument', { depth: 1 });
	const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
	await page.send('DOM.setFileInputFiles', { nodeId, files });
}

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let cookie;
const before = new Set();

try {
	cookie = await login();
	for (const row of await rows().catch(() => [])) before.add(row.id);
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('the Media page is in the dashboard sidebar for editors, not for visitors', async () => {
		assert.notEqual((await get(MEDIA_PAGE)).status, 200, 'visitors are redirected to the login');
		await page.goto(`${BASE}/dashboard`);
		const link = await page.eval(() =>
			[...document.querySelectorAll('a, sidebar-link')].some((el) => el.textContent.trim() === 'Media'),
		);
		assert.ok(link, 'Media in the sidebar');
		await page.goto(`${BASE}${MEDIA_PAGE}`);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-library="manage"]')), [], { timeout: 20_000 });
	});

	await step('uploading files adds them to the library; unsupported files are refused', async () => {
		const files = ['sample.png', 'sample.avif', 'sample.mp4', 'sample.mp3', 'sample.pdf'].map(
			(f) => `${FIXTURES}/${f}`,
		);
		await setFiles(page, '[data-media-file-input]', files);
		// Count only this suite's uploads: the library may already hold other items.
		await page.waitFor((n) => document.querySelectorAll('[data-media-item]').length >= n, [before.size + 5], {
			timeout: 20_000,
			message: 'five uploads in the grid',
		});
		const added = (await rows()).filter((r) => !before.has(r.id));
		assert.deepEqual(added.map((r) => r.kind).sort(), ['audio', 'document', 'image', 'image', 'video']);
		await setFiles(page, '[data-media-file-input]', [`${FIXTURES}/page.html`]);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-upload-state="error"]')), [], {
			message: 'refused upload shown',
		});
		const message = await page.eval(
			() => document.querySelector('[data-media-upload-state="error"] [role="alert"]').textContent,
		);
		assert.match(message, /\.html files are not supported/);
		if (SHOTS) await page.screenshot(`${SHOTS}/media-library.png`);
	});

	await step('filters and search narrow the grid', async () => {
		const images = (await rows()).filter((r) => r.kind === 'image').length;
		await page.click('[data-media-filter="image"]');
		await page.waitFor((n) => document.querySelectorAll('[data-media-item]').length === n, [images], {
			message: 'only images',
		});
		await page.click('[data-media-filter="all"]');
		await page.fill('.ml-search', 'sample.pdf');
		await page.waitFor(
			() => [...document.querySelectorAll('[data-media-item]')].map((el) => el.title).join() === 'sample.pdf',
			[],
			{ message: 'search result' },
		);
		await page.fill('.ml-search', '');
		await page.waitFor((n) => document.querySelectorAll('[data-media-item]').length >= n, [before.size + 5]);
	});

	await step('selecting an item shows its details; alt text and name are saved', async () => {
		const png = (await rows()).find((r) => r.name === 'sample.png');
		await page.click(`[data-media-item="${png.id}"]`);
		await page.waitFor((id) => Boolean(document.querySelector(`[data-media-details="${id}"]`)), [png.id]);
		await page.fill('[data-media-field="alt"]', 'A purple rectangle');
		await page.click('[data-media-field="name"]'); // blur the alt field
		await page.waitFor(() => document.querySelector('.ml-status')?.textContent === 'Saved.', [], { message: 'saved' });
		assert.equal((await rows()).find((r) => r.id === png.id).alt, 'A purple rectangle');
		const usage = await page.eval(() => document.querySelector('[data-media-usage]').textContent);
		assert.match(usage, /no pages/);
	});

	await step('files are served publicly with safe headers', async () => {
		const png = (await rows()).find((r) => r.name === 'sample.png');
		const response = await get(`/files/${png.storageKey}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-type'), 'image/png');
		assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
		assert.match(response.headers.get('content-security-policy'), /sandbox/);
	});

	await step('a remote video can be added by link', async () => {
		await page.click('[data-media-add-remote]');
		await page.fill('[data-media-remote-form] input', 'https://vimeo.com/76979871');
		await page.click('[data-media-remote-form] button[type="submit"]');
		await page.waitFor(
			() => document.querySelector('[data-media-details] .ml-info')?.textContent.includes('Vimeo video'),
			[],
			{ timeout: 15_000, message: 'remote video added and selected' },
		);
		const remote = (await rows()).find((r) => r.kind === 'remoteVideo' && !before.has(r.id));
		assert.ok(remote, 'stored');
		// Links to other sites are refused with a message.
		await page.click('[data-media-add-remote]');
		await page.fill('[data-media-remote-form] input', 'https://evil.example/video');
		await page.click('[data-media-remote-form] button[type="submit"]');
		await page.waitFor(() => Boolean(document.querySelector('[data-media-remote-form] [role="alert"]')), [], {
			message: 'refusal shown',
		});
		assert.match(
			await page.eval(() => document.querySelector('[data-media-remote-form] [role="alert"]').textContent),
			/YouTube or Vimeo/,
		);
	});

	await step('deleting removes the item and its file', async () => {
		const pdf = (await rows()).find((r) => r.name === 'sample.pdf');
		await page.click(`[data-media-item="${pdf.id}"]`);
		await page.waitFor((id) => Boolean(document.querySelector(`[data-media-details="${id}"]`)), [pdf.id]);
		await page.click('[data-media-delete]');
		await page.waitFor((id) => !document.querySelector(`[data-media-item="${id}"]`), [pdf.id], {
			message: 'removed from grid',
		});
		assert.equal(
			(await rows()).some((r) => r.id === pdf.id),
			false,
		);
		assert.equal((await get(`/files/${pdf.storageKey}`)).status, 404);
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Media suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/media-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (cookie) {
		for (const row of await rows().catch(() => [])) {
			if (before.has(row.id)) continue;
			await fetch(`${BASE}/_media/api/items/${row.id}?force=1`, {
				method: 'DELETE',
				headers: { Origin: BASE, Cookie: `auth_session=${cookie}` },
			}).catch(() => {});
		}
	}
	cdp.close();
	await chrome.close();
	db.close();
}
