// End-to-end tests for the media library's editing extras (docs/decisions/0019-media-editing-extras.md):
// resized image copies, focal point, tags (editor and filter), replacing a file, video captions, and
// the settings page's "Image sizes" section.
//
// Prereqs: same as editor.e2e.mjs. Deletes every media item it creates.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, db, get, login, SHOTS, step, summary } from './helpers.mjs';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MEDIA_PAGE = '/dashboard/nascencestudio_medialibrary/media';
const SETTINGS_PAGE = '/dashboard/plugins@nascencestudio/medialibrary';

const row = async (id) => {
	const result = await db.execute({ sql: 'select * from NascenceMediaItems where id = ?', args: [id] });
	return result.rows[0] ? { ...result.rows[0] } : null;
};
const ids = async () =>
	new Set((await db.execute('select id from NascenceMediaItems').catch(() => ({ rows: [] }))).rows.map((r) => r.id));

async function setFiles(page, selector, files) {
	const { root } = await page.send('DOM.getDocument', { depth: 1 });
	const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
	await page.send('DOM.setFileInputFiles', { nodeId, files });
}

/** Real mouse click at a fraction of an element's box. */
async function clickAt(page, selector, fx, fy) {
	// The image must be loaded, on screen and done moving: a half-loaded image has another box.
	const point = await page.waitFor(
		(sel, x, y) =>
			new Promise((resolve) => {
				const el = document.querySelector(sel);
				if (!el || (el.tagName === 'IMG' && !(el.complete && el.naturalWidth > 0))) return resolve(false);
				el.scrollIntoView({ block: 'center' });
				const first = el.getBoundingClientRect();
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						const box = el.getBoundingClientRect();
						const still = box.top === first.top && box.height === first.height && box.height > 0;
						resolve(still ? { x: box.left + box.width * x, y: box.top + box.height * y } : false);
					}),
				);
			}),
		[selector, fx, fy],
		{ message: `${selector} ready to click` },
	);
	for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
		await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
	}
}

const api = (cookie, path) => fetch(`${BASE}/_media/api${path}`, { headers: { Cookie: `auth_session=${cookie}` } });

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;
let cookie;
let before = new Set();
let photoId;
let videoId;

try {
	cookie = await login();
	before = await ids();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });
	await page.goto(`${BASE}${MEDIA_PAGE}`);
	await page.waitFor(() => Boolean(document.querySelector('[data-media-library="manage"]')), [], { timeout: 20_000 });

	await step('a large image gets resized WebP copies and a srcset', async () => {
		await setFiles(page, '[data-media-file-input]', [`${FIXTURES}/photo-1600.jpg`]);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-details] [data-media-focal]')), [], {
			timeout: 20_000,
			message: 'uploaded photo selected',
		});
		photoId = [...(await ids())].find((id) => !before.has(id));
		const { item } = await (await api(cookie, `/items/${photoId}`)).json();
		assert.deepEqual(
			item.variants.map((v) => [v.width, v.mime]),
			[
				[480, 'image/webp'],
				[960, 'image/webp'],
				[1440, 'image/webp'],
			],
		);
		assert.match(item.srcset, /480w, .* 960w, .* 1440w, .*\.jpg 1600w$/);
		const variant = await get(item.variants[0].url);
		assert.equal(variant.status, 200);
		assert.equal(variant.headers.get('content-type'), 'image/webp');
	});

	await step('clicking the image sets the focal point; Reset clears it', async () => {
		await clickAt(page, '.ml-focal__target img', 0.25, 0.75);
		await page.waitFor(() => document.querySelector('[data-media-focal-reset]') !== null, [], {
			message: 'reset link shown',
		});
		await page.waitFor(() => document.querySelector('.ml-status')?.textContent === 'Saved.');
		const saved = await row(photoId);
		assert.ok(
			Math.abs(Number(saved.focalX) - 25) <= 2 && Math.abs(Number(saved.focalY) - 75) <= 2,
			'stored near 25/75',
		);
		const crop = await page.eval(() => document.querySelector('.ml-focal__crop').style.objectPosition);
		assert.match(crop, /^2\d% 7\d%$/);
		if (SHOTS) await page.screenshot(`${SHOTS}/media-focal.png`);
		// Arrow keys nudge it (keyboard users).
		await page.eval(() => document.querySelector('.ml-focal__target').focus());
		await page.press('ArrowRight', ['Shift']);
		await new Promise((r) => setTimeout(r, 300));
		assert.ok(Number((await row(photoId)).focalX) >= 33, 'moved right by 10');
		await page.click('[data-media-focal-reset]');
		await page.waitFor(() => !document.querySelector('[data-media-focal-reset]'));
		await new Promise((r) => setTimeout(r, 200));
		assert.equal((await row(photoId)).focalX, null);
	});

	await step('tags: add with Enter and comma, invalid tags are explained, filter by tag, remove', async () => {
		await page.fill('[data-media-tag-input]', 'Summer Campaign');
		await page.press('Enter');
		await page.waitFor(() => Boolean(document.querySelector('[data-media-tag="summer campaign"]')));
		await page.fill('[data-media-tag-input]', 'homepage,');
		await page.waitFor(() => Boolean(document.querySelector('[data-media-tag="homepage"]')));
		await new Promise((r) => setTimeout(r, 300));
		assert.equal((await row(photoId)).tags, '|homepage|summer campaign|');
		await page.fill('[data-media-tag-input]', 'bad|tag');
		await page.press('Enter');
		await page.waitFor(() => Boolean(document.querySelector('[data-media-tags] [role="alert"]')), [], {
			message: 'invalid tag message',
		});
		await page.fill('[data-media-tag-input]', '');
		// The toolbar filter lists the tags; picking one narrows the grid.
		await page.waitFor(() =>
			[...document.querySelectorAll('[data-media-tag-filter] option')].some((o) => o.value === 'homepage'),
		);
		await page.eval(() => {
			const select = document.querySelector('[data-media-tag-filter]');
			select.value = 'homepage';
			select.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await page.waitFor(
			(id) => [...document.querySelectorAll('[data-media-item]')].map((el) => el.dataset.mediaItem).join() === id,
			[photoId],
			{ message: 'only the tagged photo' },
		);
		await page.click('[data-media-tag="homepage"] .ml-tag__remove');
		await page.waitFor(() => !document.querySelector('[data-media-tag="homepage"]'));
		await new Promise((r) => setTimeout(r, 300));
		assert.equal((await row(photoId)).tags, '|summer campaign|');
		await page.waitFor(() => document.querySelector('[data-media-tag-filter]')?.value === '', [], {
			message: 'filter resets when its tag is gone',
		});
	});

	await step('replacing the file keeps the item (id, tags) and gives it a new URL', async () => {
		const old = await row(photoId);
		await setFiles(page, '[data-media-replace-input]', [`${FIXTURES}/photo-800.png`]);
		await page.waitFor(
			(oldKey) => {
				const link = document.querySelector('[data-media-details] .ml-info__url a');
				return link && !link.textContent.includes(oldKey) && link.textContent.endsWith('.png');
			},
			[old.storageKey],
			{ timeout: 20_000, message: 'details show the new file' },
		);
		const updated = await row(photoId);
		assert.equal(updated.id, old.id);
		assert.equal(updated.tags, '|summer campaign|');
		assert.equal(updated.name, 'photo-800.png', 'a file-name name follows the new file');
		assert.equal(Number(updated.width), 800);
		assert.equal((await get(`/files/${old.storageKey}`)).status, 404, 'old file removed');
		assert.equal((await get(`/files/${updated.storageKey}`)).status, 200);
		// Another kind is refused with a message.
		await setFiles(page, '[data-media-replace-input]', [`${FIXTURES}/sample.pdf`]);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-replace-state="error"]')), [], {
			message: 'refusal shown',
		});
		assert.match(
			await page.eval(() => document.querySelector('[data-media-replace-state="error"]').textContent),
			/must be an image/,
		);
	});

	await step('videos get caption tracks (SRT converted to WebVTT); they can be removed', async () => {
		await setFiles(page, '[data-media-file-input]', [`${FIXTURES}/sample.mp4`]);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-captions]')), [], {
			timeout: 20_000,
			message: 'video selected',
		});
		videoId = [...(await ids())].find((id) => !before.has(id) && id !== photoId);
		await page.fill('[data-media-track-lang]', 'en');
		await page.fill('[data-media-track-label]', 'English');
		await setFiles(page, '[data-media-track-file]', [`${FIXTURES}/sample.srt`]);
		await page.waitFor(() => document.querySelectorAll('[data-media-track]').length === 1, [], {
			message: 'track listed',
		});
		const stored = JSON.parse((await row(videoId)).tracks);
		assert.deepEqual(
			stored.map((t) => [t.srclang, t.label, t.kind]),
			[['en', 'English', 'subtitles']],
		);
		const trackSrc = await page.eval(() => document.querySelector('.ml-preview video track')?.getAttribute('src'));
		const vtt = await get(trackSrc);
		assert.equal(vtt.headers.get('content-type'), 'text/vtt; charset=utf-8');
		assert.equal(
			await vtt.text(),
			'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello from the <i>caption</i> file\n\n00:00:01.500 --> 00:00:03.000\nSecond cue\n',
		);
		// A file that isn't captions is refused with a message.
		await page.fill('[data-media-track-lang]', 'de');
		await page.fill('[data-media-track-label]', 'Deutsch');
		await setFiles(page, '[data-media-track-file]', [`${FIXTURES}/sample.csv`]);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-captions] [role="alert"]')));
		await page.click('[data-media-track] .ml-link');
		await page.waitFor(() => document.querySelectorAll('[data-media-track]').length === 0);
		assert.equal((await get(trackSrc)).status, 404, 'caption file removed');
		if (SHOTS) await page.screenshot(`${SHOTS}/media-captions.png`);
	});

	await step('the settings page shows the image sizes and can create missing copies', async () => {
		// Make the test photo look like an old upload without copies (it's 800px wide: one copy, 480).
		const others = (
			await db.execute({
				sql: "select count(*) as n from NascenceMediaItems where kind = 'image' and variants = '[]' and width >= 534 and mime in ('image/jpeg','image/png','image/webp','image/avif') and id != ?",
				args: [photoId],
			})
		).rows[0].n;
		const saved = await row(photoId);
		await db.execute({ sql: "update NascenceMediaItems set variants = '[]' where id = ?", args: [photoId] });
		await page.goto(`${BASE}${SETTINGS_PAGE}`);
		await page.waitFor(() => Boolean(document.querySelector('[data-media-settings-variants]')));
		const text = await page.eval(() => document.querySelector('[data-media-settings-variants]').textContent);
		assert.match(text, /480, 960, 1440, 1920 pixels wide/);
		assert.match(text, /existing images? (has|have) none yet/);
		if (Number(others) === 0) {
			// Only run it when no other images need copies, so the suite never changes your library.
			await page.click('[data-media-variants-run]');
			await page.waitFor(() => Boolean(document.querySelector('[data-media-variants-result]')), [], {
				timeout: 30_000,
			});
			assert.match(
				await page.eval(() => document.querySelector('[data-media-variants-result]').textContent),
				/Made resized copies of 1 image\./,
			);
			assert.equal(JSON.parse((await row(photoId)).variants).length, 1);
		} else {
			await db.execute({
				sql: 'update NascenceMediaItems set variants = ? where id = ?',
				args: [saved.variants, photoId],
			});
			console.log(`    (skipped running it: ${others} other image(s) in the library need copies)`);
		}
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Media extras suite');
} catch (error) {
	if (page && SHOTS) await page.screenshot(`${SHOTS}/media-extras-failure.png`).catch(() => {});
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	if (cookie) {
		for (const id of await ids()) {
			if (before.has(id)) continue;
			await fetch(`${BASE}/_media/api/items/${id}?force=1`, {
				method: 'DELETE',
				headers: { Origin: BASE, Cookie: `auth_session=${cookie}` },
			}).catch(() => {});
		}
	}
	cdp.close();
	await chrome.close();
	db.close();
}
