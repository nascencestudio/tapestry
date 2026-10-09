/**
 * Finds the `media` and `link` values in a node's props, top level or inside
 * `object` props and `list` items, so the renderer can resolve them in one batch
 * and put the results back. Containers are copied, never mutated. Pure.
 */
import type { PropDefinition } from './types.js';

export interface PropRef {
	kind: 'media' | 'link';
	/** The stored value (a media id, a link value, or undefined). */
	value: unknown;
	/** Put the resolved value (item, link or null) in its place. */
	set: (resolved: unknown) => void;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function collectRefs(
	defs: Record<string, PropDefinition>,
	input: Record<string, unknown>,
): { props: Record<string, unknown>; refs: PropRef[] } {
	const refs: PropRef[] = [];
	const visit = (fields: Record<string, PropDefinition>, target: Record<string, unknown>) => {
		for (const [name, def] of Object.entries(fields)) {
			const value = target[name];
			if (def.type === 'media' || def.type === 'link') {
				refs.push({
					kind: def.type,
					value,
					set: (resolved) => {
						target[name] = resolved;
					},
				});
			} else if (def.type === 'object' && isPlainObject(value)) {
				const copy = { ...value };
				target[name] = copy;
				visit(def.fields, copy);
			} else if (def.type === 'list' && Array.isArray(value)) {
				target[name] = value.map((item) => {
					if (!isPlainObject(item)) return item;
					const copy = { ...item };
					visit(def.fields, copy);
					return copy;
				});
			}
		}
	};
	const props = { ...input };
	visit(defs, props);
	return { props, refs };
}
