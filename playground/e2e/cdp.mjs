// Minimal Chrome DevTools Protocol client for end-to-end tests.
//
// Dependency-free on purpose (Node 22's global WebSocket and a locally
// installed Chrome), so browser testing adds nothing to the supply chain.
// See docs/decisions/0008-browser-e2e-via-cdp.md.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
	process.env.CHROME_PATH,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Launch headless Chrome with remote debugging. Returns its browser WebSocket URL and a close function. */
export async function launchChrome({ port = 9333, headless = true } = {}) {
	const executable = CHROME_CANDIDATES.find((path) => existsSync(path));
	if (!executable) throw new Error('Chrome not found. Set CHROME_PATH.');
	const userDataDir = await mkdtemp(join(tmpdir(), 'tapestry-e2e-'));
	const args = [
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${userDataDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--window-size=1440,1000',
		...(headless ? ['--headless=new'] : []),
		'about:blank',
	];
	const child = spawn(executable, args, { stdio: 'ignore' });

	let wsUrl;
	for (let attempt = 0; attempt < 50 && !wsUrl; attempt++) {
		await sleep(100);
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			wsUrl = (await response.json()).webSocketDebuggerUrl;
		} catch {
			// not up yet
		}
	}
	if (!wsUrl) {
		child.kill();
		throw new Error('Chrome did not start remote debugging.');
	}
	return {
		wsUrl,
		async close() {
			child.kill();
			await sleep(200);
			await rm(userDataDir, { recursive: true, force: true });
		},
	};
}

/** A CDP connection. Use `page()` to open a tab with a flattened session. */
export class CDP {
	#ws;
	#nextId = 1;
	#pending = new Map();
	#listeners = new Set();

	static async connect(url) {
		const ws = new WebSocket(url);
		await new Promise((resolve, reject) => {
			ws.addEventListener('open', resolve, { once: true });
			ws.addEventListener('error', reject, { once: true });
		});
		return new CDP(ws);
	}

	constructor(ws) {
		this.#ws = ws;
		ws.addEventListener('message', (event) => {
			const message = JSON.parse(event.data);
			if (message.id && this.#pending.has(message.id)) {
				const { resolve, reject } = this.#pending.get(message.id);
				this.#pending.delete(message.id);
				if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
				else resolve(message.result);
			} else if (message.method) {
				for (const listener of this.#listeners) listener(message);
			}
		});
	}

	send(method, params = {}, sessionId) {
		const id = this.#nextId++;
		this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
	}

	/** Subscribe to events. Returns an unsubscribe function. */
	on(handler) {
		this.#listeners.add(handler);
		return () => this.#listeners.delete(handler);
	}

	/** Resolve with the first event matching `method` (and `predicate`). */
	waitForEvent(method, predicate = () => true, timeout = 10_000) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				off();
				reject(new Error(`Timed out waiting for ${method}`));
			}, timeout);
			const off = this.on((message) => {
				if (message.method === method && predicate(message.params)) {
					clearTimeout(timer);
					off();
					resolve(message.params);
				}
			});
		});
	}

	close() {
		this.#ws.close();
	}

	/**
	 * Open a new tab and return a Page bound to it. `{ isolated: true }` opens it in a
	 * fresh browser context (own cookies), e.g. for a logged-out visitor.
	 */
	async page({ isolated = false } = {}) {
		const context = isolated ? await this.send('Target.createBrowserContext') : null;
		const { targetId } = await this.send('Target.createTarget', {
			url: 'about:blank',
			...(context ? { browserContextId: context.browserContextId } : {}),
		});
		const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
		const page = new Page(this, sessionId);
		await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable'].map((m) => page.send(m)));
		return page;
	}
}

const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const KEY_CODES = {
	ArrowUp: 38,
	ArrowDown: 40,
	ArrowLeft: 37,
	ArrowRight: 39,
	Delete: 46,
	Backspace: 8,
	Enter: 13,
	Escape: 27,
};

/** High-level helpers for one tab. Input is dispatched as real browser input events. */
export class Page {
	constructor(cdp, sessionId) {
		this.cdp = cdp;
		this.sessionId = sessionId;
		this.errors = [];
		cdp.on((message) => {
			if (message.sessionId !== sessionId) return;
			if (message.method === 'Runtime.exceptionThrown') {
				const details = message.params.exceptionDetails;
				this.#record(details.exception?.description ?? details.text, [
					details.url,
					...(details.stackTrace?.callFrames ?? []).map((f) => f.url),
				]);
			}
			if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
				this.#record(
					message.params.args.map((a) => a.value ?? a.description).join(' '),
					(message.params.stackTrace?.callFrames ?? []).map((f) => f.url),
				);
			}
		});
	}

	/** @param {string} text @param {Array<string | undefined>} urls source URLs from the stack, innermost first */
	#record(text, urls) {
		const sources = urls.filter(Boolean);
		this.errors.push(sources.length ? `${text}\n    (from ${sources.join(' ← ')})` : text);
	}

	send(method, params) {
		return this.cdp.send(method, params, this.sessionId);
	}

	async goto(url) {
		const loaded = this.cdp.waitForEvent('Page.loadEventFired', () => true, 30_000);
		await this.send('Page.navigate', { url });
		await loaded;
	}

	/** Evaluate an expression (or a function source with `args`) in the page and return its value. */
	async eval(fnOrExpression, ...args) {
		const expression =
			typeof fnOrExpression === 'function'
				? `(${fnOrExpression.toString()})(...${JSON.stringify(args)})`
				: fnOrExpression;
		const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
		}
		return result.result.value;
	}

	/** Poll until `fn(...args)` returns a truthy value in the page. */
	async waitFor(fn, args = [], { timeout = 10_000, message = fn.toString() } = {}) {
		const start = Date.now();
		for (;;) {
			const value = await this.eval(fn, ...args);
			if (value) return value;
			if (Date.now() - start > timeout) throw new Error(`Timed out waiting for: ${message}`);
			await sleep(50);
		}
	}

	/** Center point of the first element matching `selector` (scrolled into view). */
	async center(selector, { yFraction = 0.5 } = {}) {
		const point = await this.eval(
			(sel, fraction) => {
				const element = document.querySelector(sel);
				if (!element) return null;
				element.scrollIntoView({ block: 'center' });
				const rect = element.getBoundingClientRect();
				return { x: rect.left + rect.width / 2, y: rect.top + rect.height * fraction };
			},
			selector,
			yFraction,
		);
		if (!point) throw new Error(`No element for ${selector}`);
		return point;
	}

	/**
	 * Real mouse click at the element's center. Waits until nothing covers that
	 * point (StudioCMS toasts sit over the toolbar for a few seconds after a save).
	 */
	async click(selector, { timeout = 10_000 } = {}) {
		const start = Date.now();
		let point;
		for (;;) {
			point = await this.center(selector);
			const uncovered = await this.eval(
				(sel, px, py) => {
					const target = document.querySelector(sel);
					const hit = document.elementFromPoint(px, py);
					return Boolean(hit && (hit === target || target.contains(hit)));
				},
				selector,
				point.x,
				point.y,
			);
			if (uncovered) break;
			if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${selector} to be uncovered`);
			await sleep(100);
		}
		const { x, y } = point;
		await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
		await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
		await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
	}

	/** Press a key, e.g. press('ArrowUp', ['Alt']) or press('z', ['Control']). */
	async press(key, modifiers = []) {
		const mask = modifiers.reduce((sum, m) => sum | MODIFIERS[m], 0);
		const code = KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0);
		const base = { key, modifiers: mask, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
		await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
		await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
	}

	/** Replace the value of a focused-able input by selecting all and typing. */
	async fill(selector, text) {
		await this.eval((sel) => {
			const el = document.querySelector(sel);
			el.focus();
			el.select?.();
		}, selector);
		await this.send('Input.insertText', { text });
	}

	/**
	 * Native HTML5 drag and drop from `source` to `target`. Each is a selector (center
	 * of the element) or an async function returning `{ x, y }` in top-level
	 * viewport coordinates (e.g. a point inside the canvas iframe). The target is
	 * resolved after the drag starts, since drop zones may only appear then.
	 * For selector targets, `yFraction` picks the vertical position (0 = top).
	 */
	async drag(source, target, { yFraction = 0.5 } = {}) {
		await this.send('Input.setInterceptDrags', { enabled: true });
		const resolve = (spec, options) => (typeof spec === 'function' ? spec() : this.center(spec, options));
		const from = await resolve(source);
		const intercepted = this.cdp.waitForEvent('Input.dragIntercepted');
		await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
		await this.send('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			x: from.x,
			y: from.y,
			button: 'left',
			clickCount: 1,
		});
		for (let i = 1; i <= 5; i++) {
			await this.send('Input.dispatchMouseEvent', {
				type: 'mouseMoved',
				x: from.x + i * 4,
				y: from.y + i * 4,
				button: 'left',
				buttons: 1,
			});
		}
		const { data } = await intercepted;
		await this.send('Input.dispatchDragEvent', { type: 'dragEnter', x: from.x, y: from.y, data });
		await sleep(50);
		const to = await resolve(target, { yFraction });
		for (const step of [0.5, 0.9, 1]) {
			await this.send('Input.dispatchDragEvent', {
				type: 'dragOver',
				x: from.x + (to.x - from.x) * step,
				y: from.y + (to.y - from.y) * step,
				data,
			});
			await sleep(30);
		}
		await this.send('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
		await this.send('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			x: to.x,
			y: to.y,
			button: 'left',
			clickCount: 1,
		});
		await this.send('Input.setInterceptDrags', { enabled: false });
	}

	/**
	 * A genuine mouse drag (press, move in steps, release) with no CDP drag
	 * interception, so the browser runs its real drag-and-drop machinery. Works
	 * for drags that start inside an iframe, which `drag()`'s interception can't
	 * catch. `source`/`target` are selectors or async functions returning points.
	 */
	async realDrag(source, target, { steps = 20, stepDelay = 20 } = {}) {
		const resolve = (spec) => (typeof spec === 'function' ? spec() : this.center(spec));
		const from = await resolve(source);
		await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
		await this.send('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			x: from.x,
			y: from.y,
			button: 'left',
			clickCount: 1,
		});
		const to = await resolve(target);
		for (let i = 1; i <= steps; i++) {
			await this.send('Input.dispatchMouseEvent', {
				type: 'mouseMoved',
				x: from.x + ((to.x - from.x) * i) / steps,
				y: from.y + ((to.y - from.y) * i) / steps,
				button: 'left',
				buttons: 1,
			});
			await sleep(stepDelay);
		}
		await this.send('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			x: to.x,
			y: to.y,
			button: 'left',
			clickCount: 1,
		});
		await sleep(100);
	}

	async screenshot(path) {
		const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
		const { writeFile } = await import('node:fs/promises');
		await writeFile(path, Buffer.from(data, 'base64'));
	}
}
