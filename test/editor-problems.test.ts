import { describe, expect, it } from 'vitest';
import { defineComponent, toManifest } from '../src/define.js';
import { describeIssue, describeProblems } from '../src/editor/problems.js';
import type { TapestryDocument } from '../src/types.js';
import { validateDocument } from '../src/validate.js';
import { manifest } from './fixtures.js';

const faq = defineComponent({
	type: 'faq',
	label: 'FAQ',
	component: './Faq.astro',
	props: {
		items: {
			type: 'list',
			label: 'Questions',
			fields: { question: { type: 'text', label: 'Question', required: true } },
		},
		cta: { type: 'object', label: 'Call to action', fields: { label: { type: 'text', label: 'Label', maxLength: 5 } } },
	},
});
const all = { ...manifest, ...toManifest([faq]) };

/** The problems the editor shows for a document, from the real validator. */
const problemsFor = (doc: TapestryDocument) => describeProblems(doc, all, validateDocument(doc, all).issues);

describe('content problems', () => {
	it('name the component and the setting, nested at any depth', () => {
		const doc = {
			version: 1,
			root: [
				{ id: 'h1', type: 'hero', props: { heading: 'ok' } },
				{ id: 's1', type: 'section', props: {}, children: [{ id: 'h2', type: 'hero', props: {} }] },
			],
		} as TapestryDocument;
		expect(problemsFor(doc)).toEqual([{ nodeId: 'h2', component: 'Hero', text: 'Heading is required' }]);
	});

	it('prefer the editor label of the node', () => {
		const doc = { version: 1, root: [{ id: 'h1', type: 'hero', label: 'Top banner', props: {} }] } as TapestryDocument;
		expect(problemsFor(doc)[0]?.component).toBe('Top banner');
	});

	it('point into list items and object fields', () => {
		const doc = {
			version: 1,
			root: [
				{ id: 'f1', type: 'faq', props: { items: [{ question: 'a' }, { question: 7 }], cta: { label: 'too long' } } },
			],
		} as TapestryDocument;
		expect(problemsFor(doc).map((p) => p.text)).toEqual([
			'Questions › item 2 › Question must be a string',
			'Call to action › Label must be at most 5 characters',
		]);
	});

	it('cover unknown components and page-level problems', () => {
		const doc = { version: 1, root: [{ id: 'x1', type: 'gone', props: {} }] } as TapestryDocument;
		const [problem] = problemsFor(doc);
		expect(problem).toMatchObject({ nodeId: 'x1', component: 'gone' });
		expect(
			describeIssue(doc, all, { severity: 'error', path: '$', message: 'document must be a JSON object' }),
		).toEqual({ nodeId: null, component: 'Page', text: 'document must be a JSON object' });
	});

	it('leave out warnings and repeats; survive paths that point nowhere', () => {
		const doc = { version: 1, root: [] } as TapestryDocument;
		const issue = { severity: 'error' as const, path: 'root[4].children[9].props.x', message: 'is required' };
		expect(describeProblems(doc, all, [issue, issue, { ...issue, severity: 'warning' }])).toEqual([
			{ nodeId: null, component: 'Page', text: 'is required' },
		]);
	});
});
