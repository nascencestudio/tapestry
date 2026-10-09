import { describe, expect, it } from 'vitest';
import { COALESCE_MS, createEditorStore, HISTORY_LIMIT } from '../src/editor/store.js';
import { insertNode, removeNode, updateProps } from '../src/editor/tree.js';
import type { TapestryDocument } from '../src/types.js';
import { manifest } from './fixtures.js';

const start = (): TapestryDocument => ({ version: 1, root: [{ id: 'h1', type: 'hero', props: { heading: 'A' } }] });

function setup() {
	let clock = 0;
	const store = createEditorStore(start(), manifest, () => clock);
	return { store, tick: (ms: number) => (clock += ms) };
}

const heading = (doc: TapestryDocument) => doc.root[0]?.props.heading;

describe('editor store', () => {
	it('commits, undoes and redoes', () => {
		const { store } = setup();
		store.commit(updateProps(store.doc.value, 'h1', { heading: 'B' }));
		expect(heading(store.doc.value)).toBe('B');
		expect(store.canUndo.value).toBe(true);
		store.undo();
		expect(heading(store.doc.value)).toBe('A');
		expect(store.canRedo.value).toBe(true);
		store.redo();
		expect(heading(store.doc.value)).toBe('B');
	});

	it('ignores rejected (null) operations', () => {
		const { store } = setup();
		expect(store.commit(null)).toBe(false);
		expect(store.canUndo.value).toBe(false);
	});

	it('clears redo history on a new commit', () => {
		const { store } = setup();
		store.commit(updateProps(store.doc.value, 'h1', { heading: 'B' }));
		store.undo();
		store.commit(updateProps(store.doc.value, 'h1', { heading: 'C' }));
		expect(store.canRedo.value).toBe(false);
	});

	it('coalesces rapid edits with the same key into one undo step', () => {
		const { store, tick } = setup();
		for (const value of ['Ab', 'Abc', 'Abcd']) {
			store.commit(updateProps(store.doc.value, 'h1', { heading: value }), { coalesceKey: 'h1.heading' });
			tick(100);
		}
		tick(COALESCE_MS);
		store.commit(updateProps(store.doc.value, 'h1', { heading: 'Later' }), { coalesceKey: 'h1.heading' });
		store.undo();
		expect(heading(store.doc.value)).toBe('Abcd');
		store.undo();
		expect(heading(store.doc.value)).toBe('A');
		expect(store.canUndo.value).toBe(false);
	});

	it('caps history', () => {
		const { store } = setup();
		for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
			store.commit(updateProps(store.doc.value, 'h1', { heading: `v${i}` }));
		}
		let steps = 0;
		while (store.undo()) steps++;
		expect(steps).toBe(HISTORY_LIMIT);
	});

	it('selects on commit and drops selection of nodes removed by undo', () => {
		const { store } = setup();
		const node = { id: 'h2', type: 'hero', props: { heading: 'New' } };
		store.commit(insertNode(store.doc.value, manifest, node, { parentId: null, index: 1 }), { select: 'h2' });
		expect(store.selectedNode.value?.id).toBe('h2');
		store.undo();
		expect(store.selectedId.value).toBeNull();
	});

	it('exposes live validation', () => {
		const { store } = setup();
		expect(store.validation.value.valid).toBe(true);
		store.commit(removeNode(store.doc.value, 'h1'));
		expect(store.validation.value.document.root).toEqual([]);
	});
});
