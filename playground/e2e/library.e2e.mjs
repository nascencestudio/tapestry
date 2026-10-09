// End-to-end tests for the component library's pictures (docs/decisions/0029-library-previews.md):
// developer thumbnails (the playground's "Two columns" has one) and live previews on hover and
// focus, rendered in a sandboxed frame with the site's CSS.
//
// Prereqs: same as editor.e2e.mjs. Doesn't change any page.
import assert from 'node:assert/strict';
import { CDP, launchChrome } from './cdp.mjs';
import { BASE, homePageId, login, openEditor, step, summary } from './helpers.mjs';

const pageId = await homePageId();
const item = (label) => `.tp-library__item[title^="Add ${label} "]`;

const previewState = (page, type) =>
	page.eval((t) => {
		const box = document.querySelector(`[data-tapestry-preview="${t}"]`);
		const frame = box?.querySelector('iframe');
		const doc = frame?.contentDocument;
		return box
			? {
					sandbox: frame?.getAttribute('sandbox') ?? null,
					hidden: box.getAttribute('aria-hidden'),
					text: doc?.body?.textContent?.trim() ?? '',
					headings: doc?.querySelectorAll('h1, h2, h3').length ?? 0,
					sheets: doc?.querySelectorAll('link[rel~="stylesheet"], style').length ?? 0,
					scripts: doc?.querySelectorAll('script').length ?? 0,
					height: box.querySelector('.tp-preview__viewport')?.getBoundingClientRect().height ?? 0,
				}
			: null;
	}, type);

const chrome = await launchChrome({ headless: !process.env.HEADED });
const cdp = await CDP.connect(chrome.wsUrl);
let page;

try {
	const cookie = await login();
	page = await cdp.page();
	await page.send('Network.setCookie', { name: 'auth_session', value: cookie, url: BASE });

	await step('a component with a thumbnail shows it in the library', async () => {
		await openEditor(page, pageId);
		const thumb = await page.waitFor(
			(sel) => {
				const img = document.querySelector(`${sel} img.tp-library__thumb`);
				return img?.complete && img.naturalWidth > 0 ? { src: img.getAttribute('src'), alt: img.alt } : false;
			},
			[item('Two columns')],
			{ message: 'thumbnail loaded' },
		);
		assert.equal(thumb.alt, '');
		const response = await fetch(new URL(thumb.src, BASE), { headers: { Cookie: `auth_session=${cookie}` } });
		assert.equal(response.status, 200);
		assert.match(response.headers.get('content-type') ?? '', /image\/svg\+xml/);
		// Components without one have no image.
		assert.equal(await page.eval((sel) => document.querySelector(`${sel} img`), item('Heading')), null);
	});

	await step('hovering a component shows a live preview with the site’s CSS (no scripts)', async () => {
		await page.waitFor(() => document.querySelector('.tp-canvas__status')?.dataset.state === 'ready', [], {
			message: 'canvas ready',
		});
		const { x, y } = await page.center(item('Heading'));
		await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
		await page.waitFor(
			() => {
				const doc = document.querySelector('[data-tapestry-preview="heading"] iframe')?.contentDocument;
				return Boolean(doc?.querySelector('h2'));
			},
			[],
			{ message: 'preview rendered' },
		);
		const state = await previewState(page, 'heading');
		assert.equal(state.sandbox, 'allow-same-origin');
		assert.equal(state.hidden, 'true');
		assert.equal(state.text, 'Text', 'rendered with the starting values');
		assert.ok(state.sheets > 0, 'site stylesheets copied');
		assert.equal(state.scripts, 0);
		assert.ok(state.height > 0);
	});

	await step('moving away hides it; keyboard focus shows it too', async () => {
		await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
		await page.waitFor(() => !document.querySelector('[data-tapestry-preview]'), [], { message: 'preview hidden' });
		await page.eval((sel) => document.querySelector(sel).focus(), item('FAQ'));
		await page.waitFor(
			() =>
				(
					document.querySelector('[data-tapestry-preview="faq"] iframe')?.contentDocument?.body?.textContent ?? ''
				).includes('Question'),
			[],
			{ message: 'FAQ preview rendered' },
		);
		await page.eval(() => document.activeElement.blur());
		await page.waitFor(() => !document.querySelector('[data-tapestry-preview]'), [], {
			message: 'preview hidden on blur',
		});
	});

	await step('no uncaught errors in the browser', async () => {
		assert.deepEqual(page.errors, []);
	});

	summary('Library suite');
} catch (error) {
	if (page?.errors.length) console.error('Browser errors:', page.errors);
	console.error(error);
	process.exitCode = 1;
} finally {
	cdp.close();
	await chrome.close();
}
