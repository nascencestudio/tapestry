import { describe, expect, it } from 'vitest';
import { parseStoredPage } from '../src/revisions.js';
import {
	type LanguageRow,
	parseLanguageRow,
	parseLanguages,
	translationContent,
	translationGroup,
	translationSlug,
	translationTitle,
} from '../src/translations.js';

const languages = parseLanguages(['en', { code: 'fr', label: 'French' }, 'pt-BR']);

describe('languages option', () => {
	it('accepts codes or objects; labels default to the language’s own name', () => {
		expect(languages).toEqual([
			{ code: 'en', label: 'English' },
			{ code: 'fr', label: 'French' },
			{ code: 'pt-BR', label: 'Português (Brasil)' },
		]);
		expect(parseLanguages(undefined)).toEqual([]);
	});

	it.each([
		['not a list', 'en'],
		['a bad code', ['en', 'French']],
		['a code with markup', ['en', '<b>']],
		['a duplicate', ['en', 'EN']],
		['an empty label', ['en', { code: 'fr', label: ' ' }]],
		['"default"', ['default']],
	])('rejects %s', (_, input) => {
		expect(() => parseLanguages(input)).toThrow();
	});
});

describe('translation groups', () => {
	const rows = new Map<string, LanguageRow>([
		['page-fr', { lang: 'fr', source: 'page-en' }],
		['page-pt', { lang: 'pt-BR', source: 'page-en' }],
		['page-fr-dup', { lang: 'fr', source: 'page-en' }],
		['other-fr', { lang: 'fr', source: 'other-en' }],
		['old-de', { lang: 'de', source: 'page-en' }],
	]);

	it('the same group from any member, in language order (duplicates and unknown languages left out)', () => {
		const expected = [
			{ lang: 'en', pageId: 'page-en' },
			{ lang: 'fr', pageId: 'page-fr' },
			{ lang: 'pt-BR', pageId: 'page-pt' },
		];
		expect(translationGroup('page-en', rows, languages)).toEqual({ source: 'page-en', lang: 'en', members: expected });
		expect(translationGroup('page-pt', rows, languages)).toEqual({
			source: 'page-en',
			lang: 'pt-BR',
			members: expected,
		});
	});

	it('a page without translations is a group of one', () => {
		expect(translationGroup('lonely', rows, languages).members).toEqual([{ lang: 'en', pageId: 'lonely' }]);
	});

	it('rows are validated', () => {
		expect(parseLanguageRow({ lang: 'fr', source: 'abc-123' })).toEqual({ lang: 'fr', source: 'abc-123' });
		for (const bad of [null, { lang: 'fr' }, { lang: '<x>', source: 'a' }, { lang: 'fr', source: '../x' }]) {
			expect(parseLanguageRow(bad)).toBeNull();
		}
	});
});

describe('new translations', () => {
	it('slug, title and content: an unpublished copy of the working version', () => {
		expect(translationSlug('about', 'fr')).toBe('fr/about');
		expect(translationSlug('index', 'pt-BR')).toBe('pt-br');
		expect(translationTitle('About', { code: 'fr', label: 'Français' })).toBe('About (Français)');
		const doc = { version: 1 as const, root: [{ id: 'h', type: 'heading', props: { text: 'Hi' } }] };
		const source = parseStoredPage(
			JSON.stringify({ version: 2, published: doc, publishedAt: '2026-10-07T00:00:00.000Z', draft: null, history: [] }),
			{ heading: { type: 'heading', label: 'H', props: { text: { type: 'text', label: 'T' } } } },
		).page;
		expect(JSON.parse(translationContent(source))).toEqual({
			version: 2,
			published: null,
			publishedAt: null,
			draft: doc,
			history: [],
		});
		expect(JSON.parse(translationContent(null)).draft).toBeNull();
	});
});
