import { describe, expect, it } from 'vitest';
import { mayContainDrafts, publicContent, redactDrafts } from '../src/public-content.js';

const published = { version: 1, root: [{ id: 'a', type: 'hero', props: { heading: 'Live' } }] };
const draft = { version: 1, root: [{ id: 'a', type: 'hero', props: { heading: 'Secret draft' } }] };
const stored = (p: unknown, d: unknown = draft) =>
	JSON.stringify({
		version: 2,
		published: p,
		publishedAt: '2026-10-05T00:00:00.000Z',
		draft: d,
		history: [{ document: { version: 1, root: [] }, publishedAt: '2026-10-04T00:00:00.000Z' }],
	});
const page = (content: string, extra: Record<string, unknown> = {}) => ({
	id: 'p1',
	package: 'tapestry/canvas',
	slug: 'home',
	defaultContent: { id: 'c1', content },
	multiLangContent: [{ id: 'c1', content }],
	...extra,
});

describe('publicContent', () => {
	it('returns only the published document', () => {
		expect(publicContent(stored(published))).toBe(JSON.stringify(published));
	});
	it('returns an empty string for a never-published page', () => {
		expect(publicContent(stored(null))).toBe('');
	});
	it('leaves other content alone', () => {
		expect(publicContent('# Markdown')).toBeUndefined();
		expect(publicContent(JSON.stringify(published))).toBeUndefined();
		expect(publicContent('{"version":2,"title":"not ours"}')).toBeUndefined();
	});
});

describe('mayContainDrafts', () => {
	it('spots Tapestry pages and stored content', () => {
		expect(mayContainDrafts(JSON.stringify(page('')))).toBe(true);
		expect(mayContainDrafts(JSON.stringify({ content: stored(published) }))).toBe(true);
		expect(mayContainDrafts(JSON.stringify({ content: '{ "version" : 2 }' }))).toBe(true);
	});
	it('skips unrelated JSON', () => {
		expect(mayContainDrafts('{"ok":true,"version":2}')).toBe(false);
	});
});

describe('redactDrafts', () => {
	it('strips drafts and history from a single page', () => {
		const { value, hidden } = redactDrafts(page(stored(published)));
		expect(hidden).toBe(false);
		const text = JSON.stringify(value);
		expect(text).not.toContain('Secret draft');
		expect(text).not.toContain('history');
		expect((value as ReturnType<typeof page>).defaultContent.content).toBe(JSON.stringify(published));
		expect((value as ReturnType<typeof page>).multiLangContent[0]?.content).toBe(JSON.stringify(published));
	});

	it('hides never-published pages: 404 alone, dropped from lists', () => {
		expect(redactDrafts(page(stored(null))).hidden).toBe(true);
		expect(redactDrafts(page('')).hidden).toBe(true);
		const list = redactDrafts([page(stored(published)), page(''), page(stored(null), { id: 'p3' })]);
		expect(list.hidden).toBe(false);
		expect((list.value as unknown[]).length).toBe(1);
	});

	it('redacts nested and bare content records', () => {
		const { value } = redactDrafts({ data: { pages: [page(stored(published))] }, row: { content: stored(published) } });
		expect(JSON.stringify(value)).not.toContain('Secret draft');
	});

	it('keeps old single-document content and other page types as they are', () => {
		const old = page(JSON.stringify(published));
		expect(redactDrafts(old).value).toEqual(old);
		const md = { package: 'studiocms/markdown', defaultContent: { content: '# Hi' } };
		expect(redactDrafts(md).value).toEqual(md);
	});
});
