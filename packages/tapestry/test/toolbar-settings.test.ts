import { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { defineComponent, toManifest } from '../src/define.js';
import { clearFormatting } from '../src/editor/richtext-editor.js';
import { schemaFor } from '../src/editor/richtext-schema.js';
import { DEFAULT_TOOLBAR, RICH_TEXT_BUTTONS } from '../src/richtext.js';
import { isCanvasMode, propOwner, registerPropOwner } from '../src/runtime/canvas-mode.js';
import {
	applyToolbarSettings,
	parseToolbarSettings,
	richTextFields,
	settingsFromForm,
} from '../src/toolbar-settings.js';

const manifest = toManifest([
	defineComponent({
		type: 'text',
		label: 'Text',
		component: './Text.astro',
		props: {
			body: { type: 'richtext', label: 'Body', toolbar: ['bold', 'italic', 'link', 'heading3'] },
			title: { type: 'text', label: 'Title' },
		},
	}),
	defineComponent({
		type: 'card',
		label: 'Card',
		component: './Card.astro',
		props: { blurb: { type: 'richtext', label: 'Blurb' } },
	}),
]);

describe('richTextFields', () => {
	it('lists rich text props with their developer toolbars', () => {
		expect(richTextFields(manifest).map((f) => [f.key, f.componentLabel, f.propLabel, f.toolbar])).toEqual([
			['text.body', 'Text', 'Body', ['bold', 'italic', 'link', 'heading3']],
			['card.blurb', 'Card', 'Blurb', DEFAULT_TOOLBAR],
		]);
	});
});

describe('parseToolbarSettings', () => {
	it('keeps only known fields and buttons the developer allowed, in toolbar order', () => {
		const settings = parseToolbarSettings(
			{
				version: 2,
				disabled: {
					'text.body': ['heading3', 'underline', 'bold', 'bold', 'sparkles', 42],
					'text.title': ['bold'],
					'nope.prop': ['bold'],
					'card.blurb': 'bold',
				},
			},
			manifest,
		);
		expect(settings).toEqual({ version: 2, disabled: { 'text.body': ['bold', 'heading3'] } });
	});

	it('reads format 1 (enabled buttons) as the buttons not listed being off', () => {
		const settings = parseToolbarSettings({ version: 1, fields: { 'text.body': ['bold', 'link'] } }, manifest);
		expect(settings.disabled).toEqual({ 'text.body': ['italic', 'heading3'] });
	});

	it.each([
		null,
		'x',
		[],
		{ disabled: null },
		{ version: 2, disabled: ['bold'] },
		JSON.parse('{"__proto__":{"disabled":1}}'),
	])('treats %j as no settings', (raw) => {
		expect(parseToolbarSettings(raw, manifest)).toEqual({ version: 2, disabled: {} });
	});

	it('ignores prototype keys in the fields map', () => {
		const raw = JSON.parse('{"version":2,"disabled":{"__proto__":["bold"],"constructor":["bold"]}}');
		expect(parseToolbarSettings(raw, manifest).disabled).toEqual({});
	});
});

describe('settingsFromForm', () => {
	it('turns off unchecked buttons per submitted field; an all-unchecked field turns everything off', () => {
		const form = new URLSearchParams();
		form.append('field:text.body', '1');
		form.append('toolbar:text.body', 'italic');
		form.append('toolbar:text.body', 'bogus');
		form.append('field:card.blurb', '1');
		expect(settingsFromForm(form, manifest)).toEqual({
			version: 2,
			disabled: { 'text.body': ['bold', 'link', 'heading3'], 'card.blurb': [...DEFAULT_TOOLBAR] },
		});
	});

	it('leaves fields that were not on the form alone', () => {
		expect(settingsFromForm(new URLSearchParams('toolbar:text.body=bold'), manifest).disabled).toEqual({});
	});
});

describe('applyToolbarSettings', () => {
	it('narrows toolbars without changing the input manifest, and never widens them', () => {
		const applied = applyToolbarSettings(manifest, {
			version: 2,
			disabled: { 'text.body': ['bold', 'link', 'underline'] },
		});
		expect(applied.text?.props?.body).toMatchObject({ type: 'richtext', toolbar: ['italic', 'heading3'] });
		expect(applied.card?.props?.blurb).toEqual(manifest.card?.props?.blurb);
		expect(manifest.text?.props?.body).toMatchObject({ toolbar: ['bold', 'italic', 'link', 'heading3'] });
	});

	it('buttons a developer adds later are on by default', () => {
		const settings = { version: 2 as const, disabled: { 'text.body': ['italic' as const] } };
		const later = toManifest([
			defineComponent({
				type: 'text',
				label: 'Text',
				component: './Text.astro',
				props: { body: { type: 'richtext', label: 'Body', toolbar: ['bold', 'italic', 'strike'] } },
			}),
		]);
		expect(applyToolbarSettings(later, settings).text?.props?.body).toMatchObject({ toolbar: ['bold', 'strike'] });
	});
});

describe('clearFormatting', () => {
	const schema = schemaFor(RICH_TEXT_BUTTONS);
	const doc = PMNode.fromJSON(schema, {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', marks: [{ type: 'link', attrs: { href: '/a' } }, { type: 'bold' }], text: 'ab' },
					{ type: 'text', marks: [{ type: 'italic' }], text: 'cd' },
				],
			},
		],
	});

	it('removes every mark in the selection', () => {
		let state = EditorState.create({ doc });
		state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
		clearFormatting(state, (tr) => {
			state = state.apply(tr);
		});
		expect(state.doc.toJSON().content[0].content).toEqual([{ type: 'text', text: 'abcd' }]);
	});

	it('with no selection, stops typing with the active marks', () => {
		let state = EditorState.create({ doc });
		state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
		clearFormatting(state, (tr) => {
			state = state.apply(tr);
		});
		expect(state.storedMarks).toEqual([]);
	});
});

describe('canvas prop owners', () => {
	it('maps rich text values to their node and prop, per request', () => {
		const locals = {};
		const value = { type: 'doc', content: [] };
		registerPropOwner(locals, value, 'text-1', 'body');
		registerPropOwner(locals, 'plain string', 'text-1', 'title');
		expect(propOwner(locals, value)).toEqual({ nodeId: 'text-1', prop: 'body' });
		expect(propOwner(locals, { ...value })).toBeUndefined();
		expect(propOwner({}, value)).toBeUndefined();
		expect(propOwner(undefined, value)).toBeUndefined();
		expect(isCanvasMode(locals)).toBe(false);
	});
});
