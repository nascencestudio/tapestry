import { describe, expect, it } from 'vitest';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import { createEditorStore } from '../src/editor/store.js';
import { insertNode, moveNode, removeNode, updateProps } from '../src/editor/tree.js';
import { canUseComponent, lockedChanges, lockedMessage, lockedTypes, matchesSomeVersion } from '../src/permissions.js';
import type { TapestryDocument } from '../src/types.js';

const manifest = toManifest([
	defineComponent({
		type: 'section',
		label: 'Section',
		component: './S.astro',
		acceptsChildren: true,
	}),
	defineComponent({
		type: 'pricing',
		label: 'Pricing table',
		component: './P.astro',
		permission: 'admin',
		props: { price: { type: 'number', label: 'Price', default: 10 } },
	}),
	defineComponent({ type: 'legal', label: 'Legal', component: './L.astro', permission: 'owner' }),
	defineComponent({
		type: 'text',
		label: 'Text',
		component: './T.astro',
		props: { body: { type: 'text', label: 'Body' } },
	}),
]);

const doc: TapestryDocument = {
	version: 1,
	root: [
		{ id: 's', type: 'section', props: {}, children: [{ id: 'p', type: 'pricing', props: { price: 10 } }] },
		{ id: 't', type: 'text', props: { body: 'Hi' } },
	],
};

describe('who may use what', () => {
	it('roles', () => {
		expect([...lockedTypes(manifest, 'editor')].sort()).toEqual(['legal', 'pricing']);
		expect([...lockedTypes(manifest, 'admin')]).toEqual(['legal']);
		expect([...lockedTypes(manifest, 'owner')]).toEqual([]);
		expect(canUseComponent(manifest.text, 'editor')).toBe(true);
		expect(canUseComponent(manifest.pricing, 'visitor')).toBe(false);
	});

	it('definitions accept only known roles', () => {
		expect(() =>
			defineComponent({ type: 'x', label: 'X', component: './X.astro', permission: 'superuser' as never }),
		).toThrow(TapestryDefinitionError);
	});
});

describe('lockedChanges', () => {
	const locked = lockedTypes(manifest, 'editor');

	it('allows editing everything else, including around and inside locked components', () => {
		const edited = updateProps(doc, 't', { body: 'Changed' }) as TapestryDocument;
		const added = insertNode(edited, manifest, { id: 't2', type: 'text', props: {} }, { parentId: 's', index: 0 });
		const reordered = moveNode(added as TapestryDocument, manifest, 't', { parentId: null, index: 0 });
		expect(lockedChanges(doc, reordered as TapestryDocument, locked)).toEqual([]);
	});

	it.each([
		['changed', () => updateProps(doc, 'p', { price: 0 })],
		['removed', () => removeNode(doc, 'p')],
		['removed (with its container)', () => removeNode(doc, 's')],
		['moved', () => moveNode(doc, manifest, 'p', { parentId: null, index: 0 })],
		[
			'added',
			() => insertNode(doc, manifest, { id: 'p2', type: 'pricing', props: { price: 1 } }, { parentId: null, index: 0 }),
		],
		[
			're-typed',
			() => ({ ...doc, root: [{ ...doc.root[0], children: [{ id: 'p', type: 'text', props: {} }] }, doc.root[1]] }),
		],
	])('catches a locked component %s', (_, change) => {
		expect(lockedChanges(doc, change() as TapestryDocument, locked)).not.toEqual([]);
	});

	it('nothing is locked for someone with the role', () => {
		expect(lockedChanges(doc, removeNode(doc, 'p') as TapestryDocument, lockedTypes(manifest, 'owner'))).toEqual([]);
	});

	it('a document may bring back a version the page already has', () => {
		const adminDraft = updateProps(doc, 'p', { price: 99 }) as TapestryDocument;
		expect(matchesSomeVersion(adminDraft, [doc], locked)).toBe(false);
		expect(matchesSomeVersion(adminDraft, [doc, adminDraft], locked)).toBe(true);
	});

	it('messages name the role and the component', () => {
		expect(lockedMessage({ id: 'p', type: 'pricing', change: 'removed' }, manifest)).toBe(
			'Only admins can remove “Pricing table”.',
		);
		expect(lockedMessage({ id: 'l', type: 'legal', change: 'added' }, manifest)).toBe(
			'Only the owner can add “Legal”.',
		);
	});
});

describe('the editor store refuses changes to locked components', () => {
	const published = updateProps(doc, 'p', { price: 5 }) as TapestryDocument;
	const store = createEditorStore(doc, manifest, Date.now, {
		locked: lockedTypes(manifest, 'editor'),
		knownVersions: () => [published],
	});

	it('refuses, and says why', () => {
		expect(store.commit(updateProps(doc, 'p', { price: 1 }))).toBe(false);
		expect(store.blocked.value?.message).toBe('Only admins can change “Pricing table”.');
		expect(store.doc.value).toBe(doc);
		expect(store.isLocked('p')).toBe(true);
		expect(store.isLocked('t')).toBe(false);
	});

	it('allows other edits and restoring a stored version', () => {
		expect(store.commit(updateProps(doc, 't', { body: 'ok' }))).toBe(true);
		expect(store.commit(published)).toBe(true);
	});
});
