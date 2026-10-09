/**
 * Deciding whether a canvas update can re-render just one component instead of
 * the whole page. Pure functions only; the controller does the swapping.
 *
 * A partial render is safe when the tree's shape is unchanged (same ids, types
 * and order everywhere) and exactly one node's props differ: that node's
 * subtree is rendered on its own and replaces its old markup. Components render
 * from their own props and children only, so the result is the same as in a
 * full render. Anything else (added, moved or removed components, or several
 * changed at once, e.g. after undo) renders the whole page.
 */
import type { TapestryDocument, TapestryNode } from '../../types.js';

/** The id of the only node whose props changed, if the tree's shape is otherwise identical; else null. */
export function singleChangedNode(previous: TapestryDocument, next: TapestryDocument): string | null {
	let changed: string | null = null;
	let ok = true;
	const walk = (a: TapestryNode[], b: TapestryNode[]) => {
		if (a.length !== b.length) {
			ok = false;
			return;
		}
		for (let i = 0; i < a.length && ok; i++) {
			const x = a[i] as TapestryNode;
			const y = b[i] as TapestryNode;
			if (x.id !== y.id || x.type !== y.type || x.slot !== y.slot || Boolean(x.children) !== Boolean(y.children)) {
				ok = false;
				return;
			}
			if (x.props !== y.props && JSON.stringify(x.props) !== JSON.stringify(y.props)) {
				if (changed !== null) {
					ok = false;
					return;
				}
				changed = x.id;
			}
			if (x.children && y.children && x.children !== y.children) walk(x.children, y.children);
		}
	};
	walk(previous.root, next.root);
	return ok ? changed : null;
}

/** A one-node document holding `id`'s subtree (for the render endpoint), or null if it's missing. */
export function subtreeDocument(doc: TapestryDocument, id: string): TapestryDocument | null {
	const find = (nodes: TapestryNode[]): TapestryNode | null => {
		for (const node of nodes) {
			if (node.id === id) return node;
			const inner = node.children ? find(node.children) : null;
			if (inner) return inner;
		}
		return null;
	};
	const node = find(doc.root);
	if (!node) return null;
	// On its own it's top-level: the slot in its parent doesn't apply.
	const { slot: _slot, ...topLevel } = node;
	return { version: doc.version, root: [topLevel] };
}
