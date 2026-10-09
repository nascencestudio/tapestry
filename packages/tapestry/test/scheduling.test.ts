import { describe, expect, it } from 'vitest';
import { publicContent, redactDrafts } from '../src/public-content.js';
import {
	applyDueSchedule,
	cancelSchedule,
	documentFor,
	pageStatus,
	parseStoredPage,
	publish,
	type StoredPage,
	saveDraft,
	schedulePublish,
	serializeStoredPage,
} from '../src/revisions.js';
import type { TapestryDocument } from '../src/types.js';
import { manifest } from './fixtures.js';

const doc = (heading: string): TapestryDocument => ({
	version: 1,
	root: [{ id: 'h1', type: 'hero', props: { heading, dark: false } }],
});
const t = (n: number) => `2026-10-0${n}T12:00:00.000Z`;
const live = (): StoredPage =>
	publish(saveDraft(parseStoredPage('', manifest).page, doc('v1')), { now: t(1), by: 'Ana' });

describe('scheduled publishing (stored page)', () => {
	it('schedules a copy of the working version; the draft and live page are unchanged', () => {
		const page = schedulePublish(saveDraft(live(), doc('v2')), { at: t(5), by: 'Ben' });
		expect(page.scheduled).toEqual({ document: doc('v2'), at: t(5), by: 'Ben' });
		expect(page.published).toEqual(doc('v1'));
		expect(page.draft).toEqual(doc('v2'));
		expect(documentFor(page, { editor: false, preview: false })).toEqual(doc('v1'));
	});

	it('is not applied before its time', () => {
		const page = schedulePublish(saveDraft(live(), doc('v2')), { at: t(5) });
		expect(applyDueSchedule(page, t(4))).toBe(page);
	});

	it('when due: goes live at the scheduled time, by the scheduler; the old version moves to history', () => {
		const page = schedulePublish(saveDraft(live(), doc('v2')), { at: t(5), by: 'Ben' });
		const after = applyDueSchedule(page, t(6));
		expect(after.published).toEqual(doc('v2'));
		expect(after.publishedAt).toBe(t(5));
		expect(after.publishedBy).toBe('Ben');
		expect(after.history[0]).toEqual({ document: doc('v1'), publishedAt: t(1), publishedBy: 'Ana' });
		expect(after.draft).toBeNull(); // the draft was the scheduled version
		expect(after).not.toHaveProperty('scheduled');
		expect(pageStatus(after)).toBe('published');
	});

	it('keeps a draft made after scheduling', () => {
		const page = saveDraft(schedulePublish(saveDraft(live(), doc('v2')), { at: t(5) }), doc('v3'));
		const after = applyDueSchedule(page, t(5)); // exactly at the time counts as due
		expect(after.published).toEqual(doc('v2'));
		expect(after.draft).toEqual(doc('v3'));
		expect(pageStatus(after)).toBe('changed');
	});

	it('compares instants, not strings', () => {
		const page = schedulePublish(live(), { doc: doc('v2'), at: '2026-10-05T12:00:00Z' });
		expect(applyDueSchedule(page, '2026-10-05T12:00:00.000Z').published).toEqual(doc('v2'));
	});

	it('can be cancelled', () => {
		const page = cancelSchedule(schedulePublish(live(), { doc: doc('v2'), at: t(5) }));
		expect(page).not.toHaveProperty('scheduled');
		expect(applyDueSchedule(page, t(9)).published).toEqual(doc('v1'));
	});

	it('a never-published page goes live on schedule', () => {
		const page = schedulePublish(parseStoredPage('', manifest).page, { doc: doc('first'), at: t(5) });
		expect(pageStatus(page)).toBe('unpublished');
		const after = applyDueSchedule(page, t(5));
		expect(after.published).toEqual(doc('first'));
		expect(after.history).toEqual([]);
	});

	it('round-trips through storage and validates the scheduled document', () => {
		const page = schedulePublish(live(), { doc: doc('v2'), at: t(5), by: 'Ben' });
		expect(parseStoredPage(serializeStoredPage(page), manifest).page.scheduled).toEqual(page.scheduled);
		const raw = JSON.parse(serializeStoredPage(page));
		raw.scheduled.document.root[0].props.onclick = 'alert(1)';
		raw.scheduled.document.root.push({ id: 'x', type: 'nope', props: {} });
		const parsed = parseStoredPage(JSON.stringify(raw), manifest);
		expect(parsed.page.scheduled?.document).toEqual(doc('v2'));
		expect(parsed.issues.some((i) => i.path.startsWith('scheduled.document'))).toBe(true);
	});

	it.each([
		['no date', { document: doc('x') }],
		['bad date', { document: doc('x'), at: 'tomorrow' }],
		['no document', { at: t(5) }],
		['not an object', 'soon'],
	])('ignores a malformed schedule: %s', (_, scheduled) => {
		const raw = { ...JSON.parse(serializeStoredPage(live())), scheduled };
		expect(parseStoredPage(JSON.stringify(raw), manifest).page.scheduled).toBeUndefined();
	});
});

describe('scheduled publishing (public JSON)', () => {
	const now = Date.parse(t(4));
	const content = (at: string) =>
		JSON.stringify({ ...JSON.parse(serializeStoredPage(live())), scheduled: { document: doc('future'), at } });

	it('never exposes a version before its time', () => {
		expect(publicContent(content(t(5)), () => now)).toBe(JSON.stringify(doc('v1')));
		expect(publicContent(content(t(5)), () => now)).not.toMatch(/future/);
	});

	it('serves the scheduled version once due', () => {
		expect(publicContent(content(t(3)), () => now)).toBe(JSON.stringify(doc('future')));
	});

	it('a never-published page stays hidden until its schedule is due', () => {
		const unpublished = (at: string) =>
			JSON.stringify({
				version: 2,
				published: null,
				publishedAt: null,
				draft: null,
				history: [],
				scheduled: { document: doc('future'), at },
			});
		const pageOf = (content: string) => ({ id: 'p', package: 'tapestry/canvas', defaultContent: { content } });
		expect(redactDrafts(pageOf(unpublished('2999-01-01T00:00:00.000Z'))).hidden).toBe(true);
		const due = redactDrafts(pageOf(unpublished('2000-01-01T00:00:00.000Z')));
		expect(due.hidden).toBe(false);
		expect(JSON.stringify(due.value)).toContain('future');
	});
});

describe('page versions (comparison)', async () => {
	const { documentForVersion, parseVersion } = await import('../src/revisions.js');

	it('parses only known version names', () => {
		expect(parseVersion('published')).toBe('published');
		expect(parseVersion('draft')).toBe('draft');
		expect(parseVersion('history-0')).toBe('history-0');
		expect(parseVersion('history-12')).toBe('history-12');
		for (const bad of ['history-', 'history--1', 'history-01', 'history-123', 'scheduled', '', null, 'history-0;x']) {
			expect(parseVersion(bad as string | null)).toBeNull();
		}
	});

	it('returns the document of each version, or null', () => {
		const page = saveDraft(publish(live(), { doc: doc('v2'), now: t(2) }), doc('draft'));
		expect(documentForVersion(page, 'published')).toEqual(doc('v2'));
		expect(documentForVersion(page, 'draft')).toEqual(doc('draft'));
		expect(documentForVersion(page, 'history-0')).toEqual(doc('v1'));
		expect(documentForVersion(page, 'history-5')).toBeNull();
	});
});

describe('publish permission: keepPublishingState', async () => {
	const { keepPublishingState, looksLikeTapestryContent } = await import('../src/revisions.js');
	const current = serializeStoredPage(
		schedulePublish(publish(live(), { doc: doc('v2'), now: t(2), by: 'Ana' }), { doc: doc('next'), at: t(8) }),
	);
	const parsed = (s: string | null) => JSON.parse(s as string);

	it('keeps the live version, history and schedule; the working copy becomes the draft', () => {
		const incoming = serializeStoredPage(saveDraft(parseStoredPage(current, manifest).page, doc('my edit')));
		const out = parsed(keepPublishingState(incoming, current));
		expect(out.published).toEqual(doc('v2'));
		expect(out.publishedBy).toBe('Ana');
		expect(out.history).toEqual(parsed(current).history);
		expect(out.scheduled).toEqual(parsed(current).scheduled);
		expect(out.draft).toEqual(doc('my edit'));
	});

	it('turns an attempted publish into a draft', () => {
		const tampered = serializeStoredPage(
			publish(parseStoredPage(current, manifest).page, { doc: doc('sneaky'), now: t(9), by: 'Eve' }),
		);
		const out = parsed(keepPublishingState(tampered, current));
		expect(out.published).toEqual(doc('v2'));
		expect(out.publishedAt).toBe(t(2));
		expect(out.draft).toEqual(doc('sneaky'));
		expect(out.history).toEqual(parsed(current).history);
	});

	it('ignores forged history and schedules, and a format-1 document only becomes a draft', () => {
		const forged = JSON.stringify({ ...parsed(current), history: [], scheduled: { document: doc('evil'), at: t(1) } });
		expect(parsed(keepPublishingState(forged, current)).scheduled).toEqual(parsed(current).scheduled);
		expect(parsed(keepPublishingState(forged, current)).history).toEqual(parsed(current).history);
		const v1 = parsed(keepPublishingState(JSON.stringify(doc('format 1')), current));
		expect(v1.published).toEqual(doc('v2'));
		expect(v1.draft).toEqual(doc('format 1'));
	});

	it('empty content cannot unpublish; a draft equal to the live version is cleared', () => {
		const out = parsed(keepPublishingState('', current));
		expect(out.published).toEqual(doc('v2'));
		expect(out.draft).toBeNull();
		const same = serializeStoredPage(saveDraft(parseStoredPage(current, manifest).page, doc('v2')));
		expect(parsed(keepPublishingState(same, current)).draft).toBeNull();
	});

	it('a new page keeps nothing live', () => {
		const out = parsed(keepPublishingState(serializeStoredPage(publish(live(), { doc: doc('x'), now: t(3) })), ''));
		expect(out.published).toBeNull();
		expect(out.draft).toEqual(doc('x'));
	});

	it('refuses content in an unknown format', () => {
		expect(keepPublishingState('not json', current)).toBeNull();
		expect(keepPublishingState('{"version":3}', current)).toBeNull();
		expect(keepPublishingState('[1]', current)).toBeNull();
	});

	it('recognizes Tapestry content of both formats', () => {
		expect(looksLikeTapestryContent(current)).toBe(true);
		expect(looksLikeTapestryContent(JSON.stringify(doc('x')))).toBe(true);
		expect(looksLikeTapestryContent('# Markdown')).toBe(false);
		expect(looksLikeTapestryContent('{"version":1}')).toBe(false);
		expect(looksLikeTapestryContent(42)).toBe(false);
	});
});
