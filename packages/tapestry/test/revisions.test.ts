import { describe, expect, it } from 'vitest';
import {
	discardDraft,
	documentFor,
	emptyStoredPage,
	pageStatus,
	parseStoredPage,
	publish,
	restoreToDraft,
	type StoredPage,
	saveDraft,
	serializeStoredPage,
	workingDocument,
} from '../src/revisions.js';
import type { TapestryDocument } from '../src/types.js';
import { manifest } from './fixtures.js';

const doc = (heading: string): TapestryDocument => ({
	version: 1,
	root: [{ id: 'h1', type: 'hero', props: { heading, dark: false } }],
});
const t = (n: number) => `2026-10-0${n}T12:00:00.000Z`;

describe('parseStoredPage', () => {
	it('treats empty content as a never-published page', () => {
		const { page, unreadable } = parseStoredPage('', manifest);
		expect(unreadable).toBe(false);
		expect(page).toEqual(emptyStoredPage());
		expect(pageStatus(page)).toBe('unpublished');
	});

	it('reads format-1 documents (saved before drafts) as published', () => {
		const { page } = parseStoredPage(JSON.stringify(doc('Old')), manifest);
		expect(page.published).toEqual(doc('Old'));
		expect(page.draft).toBeNull();
		expect(pageStatus(page)).toBe('published');
	});

	it('round-trips format-2 pages', () => {
		const stored = publish(saveDraft(emptyStoredPage(), doc('A')), { now: t(1), by: 'Ann' });
		const { page } = parseStoredPage(serializeStoredPage(stored), manifest);
		expect(page).toEqual(stored);
	});

	it('validates every document inside and drops invalid history entries', () => {
		const raw = {
			version: 2,
			published: { version: 1, root: [{ id: 'x', type: 'script', props: {} }] },
			publishedAt: t(1),
			draft: null,
			history: [
				{ document: doc('ok'), publishedAt: t(1) },
				{ document: doc('bad date'), publishedAt: 'yesterday' },
				'nonsense',
			],
		};
		const { page, issues } = parseStoredPage(JSON.stringify(raw), manifest);
		expect(page.published?.root).toEqual([]);
		expect(issues[0]?.path).toMatch(/^published\./);
		expect(page.history).toHaveLength(1);
	});

	it('caps history at the limit when reading', () => {
		const raw = {
			version: 2,
			published: doc('p'),
			publishedAt: t(1),
			draft: null,
			history: Array.from({ length: 9 }, (_, i) => ({ document: doc(`h${i}`), publishedAt: t(1) })),
		};
		expect(parseStoredPage(JSON.stringify(raw), manifest, 5).page.history).toHaveLength(5);
	});

	it('reports unreadable content without throwing', () => {
		expect(parseStoredPage('{nope', manifest).unreadable).toBe(true);
		expect(parseStoredPage('{"version":3}', manifest).unreadable).toBe(true);
		expect(parseStoredPage('[]', manifest).unreadable).toBe(true);
	});

	it('sanitizes publisher names', () => {
		const raw = {
			version: 2,
			published: doc('p'),
			publishedAt: t(1),
			publishedBy: `  ${'x'.repeat(200)} `,
			draft: null,
			history: [],
		};
		expect(parseStoredPage(JSON.stringify(raw), manifest).page.publishedBy).toHaveLength(100);
	});
});

describe('drafts', () => {
	const live: StoredPage = publish(emptyStoredPage(), { doc: doc('Live'), now: t(1) });

	it('saving a change creates a draft; saving the published content clears it', () => {
		const changed = saveDraft(live, doc('Edited'));
		expect(pageStatus(changed)).toBe('changed');
		expect(changed.published).toEqual(doc('Live'));
		expect(workingDocument(changed)).toEqual(doc('Edited'));
		expect(saveDraft(changed, doc('Live')).draft).toBeNull();
	});

	it('discarding returns to the published version', () => {
		const discarded = discardDraft(saveDraft(live, doc('Edited')));
		expect(workingDocument(discarded)).toEqual(doc('Live'));
		expect(pageStatus(discarded)).toBe('published');
	});

	it('visitors get the published version; editors previewing get the draft', () => {
		const changed = saveDraft(live, doc('Edited'));
		expect(documentFor(changed, { editor: false, preview: true })).toEqual(doc('Live'));
		expect(documentFor(changed, { editor: true, preview: false })).toEqual(doc('Live'));
		expect(documentFor(changed, { editor: true, preview: true })).toEqual(doc('Edited'));
		expect(documentFor(saveDraft(emptyStoredPage(), doc('New')), { editor: false, preview: false })).toBeNull();
	});
});

describe('publish and history', () => {
	it('moves the previous version into history, newest first, capped', () => {
		let page = emptyStoredPage();
		for (let i = 1; i <= 8; i++) {
			page = publish(saveDraft(page, doc(`v${i}`)), { now: t(Math.min(i, 9)), by: `user${i}`, historyLimit: 5 });
		}
		expect(page.published).toEqual(doc('v8'));
		expect(page.publishedBy).toBe('user8');
		expect(page.draft).toBeNull();
		expect(page.history.map((h) => h.document.root[0]?.props.heading)).toEqual(['v7', 'v6', 'v5', 'v4', 'v3']);
		expect(page.history[0]?.publishedBy).toBe('user7');
	});

	it('publishing unchanged content adds no history entry', () => {
		const page = publish(emptyStoredPage(), { doc: doc('A'), now: t(1) });
		expect(publish(page, { now: t(2) })).toEqual({ ...page, draft: null });
	});

	it('restoring a history entry puts it in the draft without going live', () => {
		let page = publish(emptyStoredPage(), { doc: doc('v1'), now: t(1) });
		page = publish(saveDraft(page, doc('v2')), { now: t(2) });
		const restored = restoreToDraft(page, 0);
		expect(restored.published).toEqual(doc('v2'));
		expect(restored.draft).toEqual(doc('v1'));
		expect(pageStatus(restored)).toBe('changed');
		expect(restoreToDraft(page, 9)).toBe(page);
	});
});
