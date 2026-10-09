// Shared helpers for the e2e suites: credentials, login, database access and
// step reporting.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { demoDocument } from '../scripts/demo-document.mjs';

process.loadEnvFile?.('.env');

export const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
export const SHOTS = process.env.E2E_SCREENSHOTS; // optional directory for screenshots

export const db = createClient({ url: process.env.CMS_LIBSQL_URL });

function credentials() {
	if (process.env.TAPESTRY_E2E_USER && process.env.TAPESTRY_E2E_PASSWORD) {
		return { username: process.env.TAPESTRY_E2E_USER, password: process.env.TAPESTRY_E2E_PASSWORD };
	}
	const text = readFileSync(process.env.CREDENTIALS_FILE || '.dev-credentials', 'utf8');
	return {
		username: /^username: (.+)$/m.exec(text)?.[1],
		password: /^password: (.+)$/m.exec(text)?.[1],
	};
}

/** Log in through StudioCMS's auth API and return the session cookie value. */
export async function login() {
	const { username, password } = credentials();
	const response = await fetch(`${BASE}/studiocms_api/auth/login`, {
		method: 'POST',
		headers: { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ username, password }),
		redirect: 'manual',
	});
	const cookie = /auth_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
	assert.ok(cookie, `login failed (HTTP ${response.status})`);
	return cookie;
}

/** Fetch a site page, optionally as a logged-in user. */
export function get(path, cookie) {
	return fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: `auth_session=${cookie}` } : {}, redirect: 'manual' });
}

export async function storedContent(pageId) {
	// The dev server writes to the same SQLite file; retry while it holds the lock.
	for (let attempt = 0; ; attempt++) {
		try {
			const result = await db.execute({
				sql: 'select content from StudioCMSPageContent where contentId = ?',
				args: [pageId],
			});
			return String(result.rows[0]?.content ?? '');
		} catch (error) {
			if (error?.code !== 'SQLITE_BUSY' || attempt >= 20) throw error;
			await new Promise((r) => setTimeout(r, 100));
		}
	}
}

const passed = [];
/** Run one named step, printing ✓/✗ and timing. */
export async function step(name, fn) {
	const started = Date.now();
	try {
		await fn();
		passed.push(name);
		console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
	} catch (error) {
		console.log(`  ✗ ${name}`);
		throw error;
	}
}

export function summary(suite) {
	console.log(`\n${suite}: all ${passed.length} steps passed.\n`);
}

// ---------------------------------------------------------------- editor pages

/** Id of the demo home page ("index"), creating it on a fresh database. */
export async function homePageId() {
	let row = (await db.execute("select id from StudioCMSPageData where slug = 'index'")).rows[0];
	if (!row) {
		// Fresh database: create the page once (nothing is cached yet).
		execFileSync('node', ['scripts/seed-demo-page.mjs'], { stdio: 'ignore' });
		row = (await db.execute("select id from StudioCMSPageData where slug = 'index'")).rows[0];
	}
	return String(row?.id);
}

export const editUrl = (pageId) => `${BASE}/dashboard/content-management/edit?edit=${pageId}`;

/** The JSON the editor will save (the hidden page-content textarea). */
export const field = (page) => page.eval(() => document.querySelector('textarea[data-tapestry-field]').value);

/**
 * Parse stored Tapestry page content (format 2: published / draft / history;
 * a format-1 document counts as published) and add `working` = draft ?? published.
 */
export function parseStored(json) {
	const raw = JSON.parse(json || '{"version":2,"published":null,"draft":null,"history":[]}');
	const stored = raw.version === 1 ? { version: 2, published: raw, draft: null, history: [] } : raw;
	return { ...stored, working: stored.draft ?? stored.published };
}

/** The editor's working document, from the hidden field. */
export const working = async (page) => parseStored(await field(page)).working;

/** Open the editor on the "Page Content" tab. */
export async function openEditor(page, pageId) {
	await page.goto(editUrl(pageId));
	await page.waitFor(() => document.querySelector('.tp-editor'), [], { message: 'editor mounted' });
	// StudioCMS shows page-type editors on the "Page Content" tab.
	await page.eval(() => {
		const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes('Page Content'));
		tab.dataset.e2e = 'content-tab';
	});
	// StudioCMS's tab script may not be ready yet on a cold page: retry the click until the editor shows.
	for (let attempt = 1; ; attempt++) {
		await page.click('[data-e2e="content-tab"]');
		try {
			await page.waitFor(() => document.querySelector('.tp-editor')?.getBoundingClientRect().width > 0, [], {
				timeout: attempt < 3 ? 3000 : 10_000,
			});
			return;
		} catch (error) {
			if (attempt >= 3) throw error;
		}
	}
}

/**
 * Click a save button (StudioCMS's Save, our Save draft, or Publish), wait for
 * StudioCMS's save request to finish, then check the database holds exactly
 * what the editor has *after* the click (Publish rewrites the content as part
 * of the click).
 *
 * We wait on the HTTP response rather than polling the database: the playground
 * SQLite file uses a rollback journal, so a test read that overlaps the
 * server's write makes StudioCMS's update fail (it answers 400).
 */
export async function saveAndWait(page, pageId, saveSelector = '#edit-button') {
	const saved = page.cdp.waitForEvent(
		'Network.responseReceived',
		(e) => e.response.url.includes('/studiocms_api/dashboard/content/page'),
		15_000,
	);
	await page.click(saveSelector);
	const expected = await field(page);
	const { response } = await saved;
	assert.equal(response.status, 200, `StudioCMS save answered HTTP ${response.status}`);
	const stored = await storedContent(pageId);
	if (stored !== expected) {
		const summary = (json) => {
			try {
				const v = JSON.parse(json);
				return JSON.stringify({
					published: v.published?.root?.[0]?.props?.heading,
					draft: v.draft?.root?.[0]?.props?.heading,
					history: v.history?.length,
				});
			} catch {
				return json.slice(0, 80);
			}
		};
		assert.fail(
			`saved content doesn't match the editor document\n  editor:   ${summary(expected)}\n  database: ${summary(stored)}`,
		);
	}
}

/** Replace the page with the demo document via the JSON view, then publish it (no draft left). */
export async function resetToDemo(page, pageId) {
	try {
		await resetOnce(page, pageId);
	} catch (error) {
		// The playground's SQLite file can be briefly locked right after another suite's last
		// write (StudioCMS then answers its save with 400, known issue #23). Retry once.
		if (!/HTTP 400/.test(String(error?.message))) throw error;
		await new Promise((r) => setTimeout(r, 1000));
		await resetOnce(page, pageId);
	}
}

async function resetOnce(page, pageId) {
	await openEditor(page, pageId);
	await page.click('[data-tapestry-json-toggle]');
	await page.fill('.tp-json textarea', JSON.stringify(demoDocument, null, 2));
	await page.click('.tp-json .tp-button--primary');
	await page.waitFor(() => document.querySelectorAll('.tp-row').length > 0, [], { message: 'back in visual editor' });
	assert.deepEqual(
		(await working(page)).root.map((n) => n.id),
		demoDocument.root.map((n) => n.id),
	);
	// Already exactly the published demo with no draft (e.g. a freshly seeded page): StudioCMS
	// sends nothing for an unchanged form, so there's nothing to save.
	const before = parseStored(await storedContent(pageId));
	if (before.draft === null && JSON.stringify(before.published) === JSON.stringify(demoDocument)) return;
	// Publish if it differs from the live version; otherwise just save (clears any draft).
	const canPublish = await page.eval(() => !document.querySelector('[data-tapestry-publish]').disabled);
	await saveAndWait(page, pageId, canPublish ? '[data-tapestry-publish]' : '#edit-button');
	const stored = parseStored(await storedContent(pageId));
	assert.equal(stored.draft, null, 'reset left a draft behind');
}
