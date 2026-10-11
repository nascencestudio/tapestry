import { describe, expect, it } from 'vitest';
import { isPublicNow, type PageRecord, publicPages } from '../src/public-pages.js';
import { emptyStoredPage, publish, saveDraft, schedulePublish, serializeStoredPage } from '../src/revisions.js';
import type { LanguageRow } from '../src/translations.js';
import type { TapestryDocument } from '../src/types.js';
import { manifest } from './fixtures.js';

const doc: TapestryDocument = {
	version: 1,
	root: [{ id: 'h1', type: 'hero', props: { heading: 'Hello' } }],
};
const NOW = '2026-10-11T12:00:00.000Z';
const base = { manifest, historyLimit: 5, now: NOW };

const published = serializeStoredPage(publish(emptyStoredPage(), { doc, now: '2026-10-01T00:00:00.000Z' }));
const draftOnly = serializeStoredPage(saveDraft(emptyStoredPage(), doc));
const scheduledFor = (at: string) => serializeStoredPage(schedulePublish(saveDraft(emptyStoredPage(), doc), { at }));

const page = (id: string, overrides: Partial<PageRecord> = {}): PageRecord => ({
	id,
	slug: id,
	title: id.toUpperCase(),
	description: '',
	package: 'tapestry/canvas',
	draft: false,
	updatedAt: '2026-10-02T00:00:00.000Z',
	content: published,
	...overrides,
});

describe('isPublicNow', () => {
	it('shows published Tapestry pages and other page types', () => {
		expect(isPublicNow(page('a'), base)).toBe(true);
		expect(isPublicNow(page('md', { package: 'studiocms/markdown', content: '# hi' }), base)).toBe(true);
	});

	it('hides StudioCMS drafts, of any type', () => {
		expect(isPublicNow(page('a', { draft: true }), base)).toBe(false);
		expect(isPublicNow(page('md', { package: 'studiocms/markdown', draft: true }), base)).toBe(false);
	});

	it('hides Tapestry pages that were never published (a draft is not enough)', () => {
		expect(isPublicNow(page('a', { content: draftOnly }), base)).toBe(false);
		expect(isPublicNow(page('a', { content: '' }), base)).toBe(false);
		expect(isPublicNow(page('a', { content: '{not json' }), base)).toBe(false);
	});

	it('counts a scheduled version only once its time has come', () => {
		expect(isPublicNow(page('a', { content: scheduledFor('2026-10-12T00:00:00.000Z') }), base)).toBe(false);
		expect(isPublicNow(page('a', { content: scheduledFor('2026-10-11T11:59:00.000Z') }), base)).toBe(true);
	});
});

describe('publicPages', () => {
	const single = { ...base, pageUrlPattern: '/{slug}', languages: [{ code: 'en', label: 'English' }], rows: new Map() };

	it('lists visible pages with their paths, sorted', () => {
		const list = publicPages(
			[page('index'), page('b'), page('hidden', { draft: true }), page('soon', { content: draftOnly })],
			single,
		);
		expect(list.map((p) => p.path)).toEqual(['/', '/b']);
		expect(list[1]).toMatchObject({
			id: 'b',
			title: 'B',
			lang: null,
			translations: [],
			updatedAt: '2026-10-02T00:00:00.000Z',
		});
	});

	it('uses the page URL pattern', () => {
		expect(publicPages([page('about')], { ...single, pageUrlPattern: '/pages/{slug}' })[0]?.path).toBe('/pages/about');
	});

	describe('translations', () => {
		const languages = [
			{ code: 'en', label: 'English' },
			{ code: 'fr', label: 'Français' },
			{ code: 'de', label: 'Deutsch' },
		];
		const rows = new Map<string, LanguageRow>([
			['about-fr', { lang: 'fr', source: 'about' }],
			['about-de', { lang: 'de', source: 'about' }],
		]);
		const options = { ...base, pageUrlPattern: '/{slug}', languages, rows };

		it('lists every visible language version on each member', () => {
			const list = publicPages([page('about'), page('about-fr'), page('about-de')], options);
			const about = list.find((p) => p.id === 'about');
			expect(about?.lang).toBe('en');
			expect(about?.translations).toEqual([
				{ lang: 'en', path: '/about' },
				{ lang: 'fr', path: '/about-fr' },
				{ lang: 'de', path: '/about-de' },
			]);
			expect(list.find((p) => p.id === 'about-fr')?.lang).toBe('fr');
		});

		it('leaves out translations visitors cannot see (drafts, unpublished)', () => {
			const list = publicPages(
				[page('about'), page('about-fr', { draft: true }), page('about-de', { content: draftOnly })],
				options,
			);
			expect(list.map((p) => p.id)).toEqual(['about']);
			expect(list[0]?.translations).toEqual([]); // only itself visible: no alternates
		});
	});
});
