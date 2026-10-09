import { describe, expect, it } from 'vitest';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import { createNode } from '../src/editor/tree.js';
import { CURRENT_FORMAT, migrateFormat } from '../src/migrations.js';
import type { ComponentManifest } from '../src/types.js';
import { validateDocument } from '../src/validate.js';

// The manifest as `virtual:tapestry/manifest` builds it: JSON from the definitions, plus `migrate`.
function manifestWith(migrate: Record<number, (p: Record<string, unknown>) => Record<string, unknown>>) {
	const manifest: ComponentManifest = toManifest([
		defineComponent({
			type: 'counter',
			label: 'Counter',
			component: './Counter.tsx',
			version: 3,
			migrations: './counter.migrations.mjs',
			replaces: ['tally'],
			props: {
				label: { type: 'text', label: 'Label', required: true },
				initial: { type: 'number', label: 'Initial', default: 0 },
			},
		}),
	]);
	(manifest.counter as { migrate?: unknown }).migrate = migrate;
	return manifest;
}

const migrations = {
	// v2: `start` was renamed to `initial`.
	2: ({ start, ...rest }: Record<string, unknown>) => (start === undefined ? rest : { ...rest, initial: start }),
	// v3: labels became required; old ones may be missing.
	3: (props: Record<string, unknown>) => ({ label: 'Count', ...props }),
};
const doc = (node: Record<string, unknown>) => ({ version: 1, root: [{ id: 'c', props: {}, ...node }] });

describe('component migrations', () => {
	const manifest = manifestWith(migrations);

	it('upgrade props saved with an older version, step by step, and record the new version', () => {
		const result = validateDocument(doc({ type: 'counter', props: { start: 5 } }), manifest);
		expect(result.valid).toBe(true);
		expect(JSON.stringify(result.document.root[0])).toBe(
			'{"id":"c","type":"counter","version":3,"props":{"label":"Count","initial":5}}',
		);
		const fromV2 = validateDocument(doc({ type: 'counter', version: 2, props: { initial: 1 } }), manifest);
		expect(fromV2.document.root[0]?.props).toEqual({ label: 'Count', initial: 1 });
	});

	it('are idempotent: an upgraded document validates to itself', () => {
		const once = validateDocument(doc({ type: 'counter', props: { start: 5, label: 'Likes' } }), manifest).document;
		const twice = validateDocument(once, manifest);
		expect(JSON.stringify(twice.document)).toBe(JSON.stringify(once));
		expect(twice.issues).toEqual([]);
	});

	it('get a copy: the input document is never changed', () => {
		const input = doc({ type: 'counter', props: { start: 5 } });
		const snapshot = JSON.stringify(input);
		validateDocument(input, manifest);
		expect(JSON.stringify(input)).toBe(snapshot);
	});

	it('a renamed component takes over nodes with its old type (with a warning)', () => {
		const result = validateDocument(doc({ type: 'tally', props: { start: 2 } }), manifest);
		expect(result.document.root[0]).toMatchObject({ type: 'counter', props: { initial: 2 } });
		expect(result.issues).toEqual([{ severity: 'warning', path: 'root[0].type', message: '"tally" is now "counter"' }]);
	});

	it('a failing migration keeps the earlier props, reports an error, and validation cleans the rest', () => {
		const broken = manifestWith({
			...migrations,
			3: () => {
				throw new Error('boom');
			},
		});
		const result = validateDocument(doc({ type: 'counter', props: { start: 5, label: 'Likes' } }), broken);
		expect(result.document.root[0]?.props).toEqual({ label: 'Likes', initial: 5 });
		expect(result.issues[0]).toMatchObject({ severity: 'error', path: 'root[0].props' });
		expect(result.issues[0]?.message).toContain('boom');
		const notObject = manifestWith({ ...migrations, 3: () => null as never });
		expect(validateDocument(doc({ type: 'counter', props: { label: 'x' } }), notObject).issues[0]?.message).toContain(
			'must return the props object',
		);
	});

	it('props saved with a newer version than installed are kept as they are (validated), with a warning', () => {
		const result = validateDocument(doc({ type: 'counter', version: 9, props: { label: 'L' } }), manifest);
		expect(result.document.root[0]).toMatchObject({ version: 3, props: { label: 'L' } });
		expect(result.issues[0]).toMatchObject({ severity: 'warning', path: 'root[0].version' });
	});

	it.each([0, -1, 1.5, '2', null])('a bad stored version (%j) counts as 1', (version) => {
		const result = validateDocument(doc({ type: 'counter', version, props: { start: 4 } }), manifest);
		expect(result.document.root[0]?.props).toEqual({ label: 'Count', initial: 4 });
	});

	it('version 1 is never written; new nodes get the current version', () => {
		expect(createNode(manifest, 'counter', new Set())?.version).toBe(3);
		const plain = toManifest([defineComponent({ type: 'text', label: 'T', component: './T.astro' })]);
		expect(JSON.stringify(validateDocument(doc({ type: 'text', version: 1 }), plain).document.root[0])).toBe(
			'{"id":"c","type":"text","props":{}}',
		);
	});
});

describe('definitions', () => {
	const base = { type: 'x', label: 'X', component: './X.astro' };
	it.each([
		['a non-integer version', { version: 1.5 }],
		['version 0', { version: 0 }],
		['a migrations file that is not a module', { migrations: './m.json' }],
		['replacing itself', { replaces: ['x'] }],
		['a bad old type', { replaces: ['Old Type'] }],
	])('reject %s', (_, extra) => {
		expect(() => defineComponent({ ...base, ...extra } as never)).toThrow(TapestryDefinitionError);
	});

	it('an old type can be replaced by only one component, and must not be registered', () => {
		const a = defineComponent({ ...base, type: 'a', replaces: ['old'] });
		const b = defineComponent({ ...base, type: 'b', replaces: ['old'] });
		expect(() => toManifest([a, b])).toThrow(/both replace "old"/);
		const old = defineComponent({ ...base, type: 'old' });
		expect(() => toManifest([a, old])).toThrow(/still registered/);
	});
});

describe('format migrations', () => {
	it('format 1 is current: nothing to do; newer formats are refused', () => {
		expect(CURRENT_FORMAT).toBe(1);
		expect(migrateFormat({ version: 1, root: [] })).toEqual({ document: { version: 1, root: [] }, migrated: false });
		expect(migrateFormat({ version: 3, root: [] })).toEqual({
			error: 'document version 3 is newer than this version of Tapestry supports (1)',
		});
		expect(validateDocument({ version: 3, root: [] }, {}).issues[0]?.message).toContain('newer');
		// 2 is the stored page wrapper's number, never a document format.
		expect(migrateFormat({ version: 2, root: [] })).toEqual({ error: 'unsupported document version 2' });
		for (const version of [0, '1', null, undefined]) expect('error' in migrateFormat({ version })).toBe(true);
	});

	it('run in order up to the current format, on copies (skipping the reserved 2)', () => {
		const registry = {
			3: (d: Record<string, unknown>) => ({ ...d, root: (d.nodes as unknown[]) ?? [], nodes: undefined }),
			4: (d: Record<string, unknown>) => ({ ...d, upgraded: true }),
		};
		const input = { version: 1, nodes: [1] };
		expect(migrateFormat(input, registry, 4)).toEqual({
			document: { version: 4, root: [1], nodes: undefined, upgraded: true },
			migrated: true,
		});
		expect(input).toEqual({ version: 1, nodes: [1] });
		expect(migrateFormat({ version: 1 }, { 4: registry[4] }, 4)).toEqual({
			error: 'no migration to document version 3',
		});
	});
});
