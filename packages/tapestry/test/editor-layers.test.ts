import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../src/editor/store.js';
import {
	allIds,
	CLIPBOARD_KIND,
	copyPayload,
	duplicateNode,
	findNode,
	nodesFromClipboard,
	setNodeLabel,
	visibleIds,
} from '../src/editor/tree.js';
import type { TapestryDocument, TapestryNode } from '../src/types.js';
import { cleanNodeLabel, LIMITS, validateDocument } from '../src/validate.js';
import { manifest } from './fixtures.js';

const hero = (id: string, heading = id, label?: string): TapestryNode =>
	label ? { id, type: 'hero', label, props: { heading } } : { id, type: 'hero', props: { heading } };
const section = (id: string, children: TapestryNode[] = []): TapestryNode => ({
	id,
	type: 'section',
	props: {},
	children,
});

/** root: [h1, s1[h2, s2[h3]], h4] */
const sample = (): TapestryDocument => ({
	version: 1,
	root: [hero('h1'), section('s1', [hero('h2'), section('s2', [hero('h3')])]), hero('h4')],
});

describe('node labels', () => {
	it('cleans labels: control characters, whitespace, length', () => {
		expect(cleanNodeLabel('  Pricing\n  table ')).toBe('Pricing table');
		expect(cleanNodeLabel('a\u0000b c')).toBe('a b c');
		expect(cleanNodeLabel('x'.repeat(200))).toHaveLength(LIMITS.labelMaxLength);
		expect(cleanNodeLabel(42)).toBe('');
		expect(cleanNodeLabel('<script>alert(1)</script>')).toBe('<script>alert(1)</script>'); // plain text, never rendered
	});

	it('validates labels and keeps the canonical key order', () => {
		const { document, issues } = validateDocument(
			{ version: 1, root: [{ props: { heading: 'Hi' }, label: '  Top  ', type: 'hero', id: 'h1' }] },
			manifest,
		);
		expect(JSON.stringify(document.root[0])).toBe(
			'{"id":"h1","type":"hero","label":"Top","props":{"heading":"Hi","dark":false}}',
		);
		expect(issues).toEqual([]);
	});

	it('drops empty or non-text labels (with a warning for non-text)', () => {
		const { document, issues } = validateDocument(
			{
				version: 1,
				root: [
					{ id: 'a', type: 'hero', label: '   ', props: { heading: 'x' } },
					{ id: 'b', type: 'hero', label: { evil: true }, props: { heading: 'x' } },
				],
			},
			manifest,
		);
		expect(document.root.map((n) => 'label' in n)).toEqual([false, false]);
		expect(issues).toMatchObject([{ severity: 'warning', path: 'root[1].label' }]);
	});

	it('setNodeLabel sets, cleans and clears, in canonical order', () => {
		const labelled = setNodeLabel(sample(), 's2', '  Inner  box ');
		expect(JSON.stringify(findNode(labelled as TapestryDocument, 's2')?.node)).toBe(
			'{"id":"s2","type":"section","label":"Inner box","props":{},"children":[{"id":"h3","type":"hero","props":{"heading":"h3"}}]}',
		);
		expect(setNodeLabel(labelled as TapestryDocument, 's2', 'Inner box')).toBeNull(); // unchanged
		const cleared = setNodeLabel(labelled as TapestryDocument, 's2', '');
		expect(findNode(cleared as TapestryDocument, 's2')?.node).not.toHaveProperty('label');
		expect(setNodeLabel(sample(), 'missing', 'x')).toBeNull();
	});

	it('duplicates keep the label; a validated round trip is byte-identical', () => {
		const doc = validateDocument({ version: 1, root: [hero('h1', 'Hi', 'Pricing')] }, manifest).document;
		const copy = duplicateNode(doc, manifest, 'h1');
		expect(copy?.doc.root[1]?.label).toBe('Pricing');
		const json = JSON.stringify(copy?.doc);
		expect(JSON.stringify(validateDocument(JSON.parse(json), manifest).document)).toBe(json);
	});
});

describe('collapsing in the layer tree', () => {
	it('visibleIds leaves out the contents of collapsed containers', () => {
		expect(visibleIds(sample(), new Set())).toEqual(allIds(sample()));
		expect(visibleIds(sample(), new Set(['s2']))).toEqual(['h1', 's1', 'h2', 's2', 'h4']);
		expect(visibleIds(sample(), new Set(['s1']))).toEqual(['h1', 's1', 'h4']);
	});

	it('the store collapses, expands, and hands a hidden selection to the container', () => {
		const store = createEditorStore(sample(), manifest);
		store.select('h3');
		store.setCollapsed('s1');
		expect(store.collapsed.value.has('s1')).toBe(true);
		expect(store.selectedId.value).toBe('s1');
		expect(store.visible.value).toEqual(['h1', 's1', 'h4']);
		store.setCollapsed('s1');
		expect(store.visible.value).toEqual(allIds(sample()));
	});

	it('selecting a hidden node (e.g. from the canvas) reveals it', () => {
		const store = createEditorStore(sample(), manifest);
		store.setAllCollapsed(true);
		expect([...store.collapsed.value].sort()).toEqual(['s1', 's2']);
		store.select('h3');
		expect(store.collapsed.value.size).toBe(0);
		expect(store.visible.value).toContain('h3');
	});

	it('collapse all moves the selection to its top-level container; expand all clears', () => {
		const store = createEditorStore(sample(), manifest);
		store.select('h3');
		store.setAllCollapsed(true);
		expect(store.selectedId.value).toBe('s1');
		store.setAllCollapsed(false);
		expect(store.collapsed.value.size).toBe(0);
	});
});

describe('copy and paste', () => {
	const taken = new Set(allIds(sample()));

	it('round-trips a subtree with fresh ids', () => {
		const s1 = findNode(sample(), 's1')?.node as TapestryNode;
		const nodes = nodesFromClipboard(copyPayload(s1), manifest, taken);
		expect(nodes).toHaveLength(1);
		const pasted = nodes?.[0] as TapestryNode;
		expect(pasted.type).toBe('section');
		const ids = allIds({ version: 1, root: [pasted] });
		expect(ids).toHaveLength(4);
		expect(ids.some((id) => taken.has(id))).toBe(false);
		expect(new Set(ids).size).toBe(4);
	});

	it('validates pasted content like stored content', () => {
		const payload = JSON.stringify({
			kind: CLIPBOARD_KIND,
			version: 1,
			nodes: [
				{ id: 'x1', type: 'hero', props: { heading: 'ok', onclick: 'alert(1)' } },
				{ id: 'x2', type: 'not-a-component', props: {} },
				{ id: 'x3', type: 'hero', props: { heading: 7 } },
				{ id: '__proto__', type: 'hero', props: { heading: 'proto' } },
			],
		});
		const nodes = nodesFromClipboard(payload, manifest, taken) ?? [];
		// Unknown props and components and invalid values are dropped; every id is fresh
		// (`__proto__` is a legal id: ids are never used as object keys).
		expect(nodes.map((n) => n.props.heading)).toEqual(['ok', 'proto']);
		expect(nodes[0]?.props).not.toHaveProperty('onclick');
		expect(nodes.map((n) => n.id).some((id) => ['x1', '__proto__'].includes(id))).toBe(false);
	});

	it.each([
		['plain text', 'Hello'],
		['other JSON', '{"version":1,"root":[]}'],
		['wrong kind', JSON.stringify({ kind: 'other', nodes: [] })],
		['no valid nodes', JSON.stringify({ kind: CLIPBOARD_KIND, nodes: [{ type: 'nope' }] })],
		['not an array', JSON.stringify({ kind: CLIPBOARD_KIND, nodes: 'x' })],
		['huge', `{"kind":"${CLIPBOARD_KIND}","nodes":[${'0,'.repeat(600_000)}0]}`],
	])('ignores %s', (_, text) => {
		expect(nodesFromClipboard(text, manifest, taken)).toBeNull();
	});
});

describe('structure keys (canvas mode)', async () => {
	const { handleStructureKey } = await import('../src/editor/structure-keys.js');
	const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
		({
			key: k,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			preventDefault() {},
			...extra,
		}) as KeyboardEvent;
	const setup = () => {
		const store = createEditorStore(sample(), manifest);
		const messages: string[] = [];
		const press = (k: string, extra?: Partial<KeyboardEvent>) =>
			handleStructureKey(store, key(k, extra), { announce: (m) => messages.push(m), mode: 'canvas' });
		return { store, messages, press };
	};

	it('↑/↓ go through every component in page order, ignoring collapsed containers', () => {
		const { store, press } = setup();
		store.setCollapsed('s1', true);
		expect(press('ArrowDown')).toBe(true);
		expect(store.selectedId.value).toBe('h1');
		press('ArrowDown');
		press('ArrowDown');
		expect(store.selectedId.value).toBe('h2'); // inside the collapsed s1 (revealed on select)
		press('ArrowUp');
		expect(store.selectedId.value).toBe('s1');
	});

	it('→ enters a container, ← goes to the parent (no collapsing on the canvas)', () => {
		const { store, press, messages } = setup();
		store.select('s1');
		press('ArrowRight');
		expect(store.selectedId.value).toBe('h2');
		press('ArrowLeft');
		expect(store.selectedId.value).toBe('s1');
		press('ArrowLeft'); // top level: nothing to go to
		expect(store.selectedId.value).toBe('s1');
		expect(store.collapsed.value.size).toBe(0);
		expect(messages.at(-1)).toMatch(/selected/);
	});

	it('Alt+arrows move, Delete removes and selects the next component, Escape deselects', () => {
		const { store, press } = setup();
		store.select('h4');
		press('ArrowUp', { altKey: true });
		expect(store.doc.value.root.map((n) => n.id)).toEqual(['h1', 'h4', 's1']);
		press('Delete');
		expect(store.doc.value.root.map((n) => n.id)).toEqual(['h1', 's1']);
		expect(store.selectedId.value).toBe('s1');
		press('Escape');
		expect(store.selectedId.value).toBeNull();
		expect(press('x')).toBe(false);
	});
});
