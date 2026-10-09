/**
 * Editor state: the document, the selection, and undo/redo history, held in
 * Preact signals. All edits go through `commit()`, which records history.
 *
 * Kept free of DOM and component code so it can be unit-tested directly.
 */
import { batch, computed, signal } from '@preact/signals';
import { lockedChanges, lockedMessage, matchesSomeVersion } from '../permissions.js';
import type { ComponentManifest, TapestryDocument } from '../types.js';
import { parseDocument } from '../validate.js';
import { allIds, findNode, visibleIds } from './tree.js';

/** Maximum undo steps kept in memory. */
export const HISTORY_LIMIT = 100;

/** Consecutive edits with the same key within this window merge into one undo step. */
export const COALESCE_MS = 1_000;

export interface CommitOptions {
	/**
	 * Merge with the previous commit if it had the same key and happened within
	 * `COALESCE_MS`. Used for typing, so each keystroke isn't its own undo step.
	 */
	coalesceKey?: string;
	/** Node to select after the change. `null` clears the selection. Omit to keep it. */
	select?: string | null;
}

export interface StoreOptions {
	/**
	 * Component types the current user may not change (ADR 0033). A commit that
	 * changes them is refused unless they then match a version the page already has.
	 */
	locked?: ReadonlySet<string>;
	/** The page's stored versions (live, scheduled, history), for the rule above. */
	knownVersions?: () => readonly TapestryDocument[];
}

export function createEditorStore(
	initial: TapestryDocument,
	manifest: ComponentManifest,
	now: () => number = Date.now,
	storeOptions: StoreOptions = {},
) {
	const locked: ReadonlySet<string> = storeOptions.locked ?? new Set();
	/** Why the last refused commit was refused (for an announcement), with a counter so repeats re-announce. */
	const blocked = signal<{ message: string; count: number } | null>(null);
	const doc = signal(initial);
	const selectedId = signal<string | null>(null);
	/** Containers collapsed in the layer tree (editor-only state, not saved). */
	const collapsed = signal<ReadonlySet<string>>(new Set());
	const past = signal<TapestryDocument[]>([]);
	const future = signal<TapestryDocument[]>([]);
	let lastCommit: { key: string; at: number } | null = null;

	const selectedNode = computed(() =>
		selectedId.value ? (findNode(doc.value, selectedId.value)?.node ?? null) : null,
	);
	const validation = computed(() => parseDocument(JSON.stringify(doc.value), manifest));
	const canUndo = computed(() => past.value.length > 0);
	const canRedo = computed(() => future.value.length > 0);
	/** Node ids the layer tree shows, in order (descendants of collapsed containers left out). */
	const visible = computed(() => visibleIds(doc.value, collapsed.value));

	/** Apply a new document. A `null` document (a rejected operation) is ignored. Returns whether it applied. */
	function commit(next: TapestryDocument | null, options: CommitOptions = {}): boolean {
		if (!next || next === doc.value) return false;
		if (locked.size > 0) {
			const [change] = lockedChanges(doc.value, next, locked);
			if (change && !matchesSomeVersion(next, [initial, ...(storeOptions.knownVersions?.() ?? [])], locked)) {
				blocked.value = { message: lockedMessage(change, manifest), count: (blocked.peek()?.count ?? 0) + 1 };
				return false;
			}
		}
		const at = now();
		const coalesce =
			options.coalesceKey !== undefined &&
			lastCommit?.key === options.coalesceKey &&
			at - lastCommit.at < COALESCE_MS &&
			past.value.length > 0;
		batch(() => {
			if (!coalesce) past.value = [...past.value, doc.value].slice(-HISTORY_LIMIT);
			future.value = [];
			doc.value = next;
			if (options.select !== undefined) selectedId.value = options.select;
		});
		lastCommit = options.coalesceKey !== undefined ? { key: options.coalesceKey, at } : null;
		return true;
	}

	/** Keep the selection only if the node still exists. */
	function reconcileSelection() {
		if (selectedId.value && !findNode(doc.value, selectedId.value)) selectedId.value = null;
	}

	function undo(): boolean {
		const previous = past.value.at(-1);
		if (!previous) return false;
		batch(() => {
			past.value = past.value.slice(0, -1);
			future.value = [doc.value, ...future.value];
			doc.value = previous;
			reconcileSelection();
		});
		lastCommit = null;
		return true;
	}

	function redo(): boolean {
		const next = future.value[0];
		if (!next) return false;
		batch(() => {
			future.value = future.value.slice(1);
			past.value = [...past.value, doc.value].slice(-HISTORY_LIMIT);
			doc.value = next;
			reconcileSelection();
		});
		lastCommit = null;
		return true;
	}

	/** Expand every collapsed ancestor of `id`, so the node is visible in the layer tree. */
	function reveal(id: string) {
		const ancestors = findNode(doc.value, id)?.ancestors ?? [];
		if (!ancestors.some((a) => collapsed.value.has(a))) return;
		const next = new Set(collapsed.value);
		for (const ancestor of ancestors) next.delete(ancestor);
		collapsed.value = next;
	}

	function select(id: string | null) {
		batch(() => {
			selectedId.value = id;
			if (id) reveal(id);
		});
		lastCommit = null;
	}

	/** Collapse or expand a container (`force` sets the state). */
	function setCollapsed(id: string, force?: boolean) {
		const isCollapsed = collapsed.value.has(id);
		const want = force ?? !isCollapsed;
		if (want === isCollapsed) return;
		const next = new Set(collapsed.value);
		if (want) next.add(id);
		else next.delete(id);
		batch(() => {
			collapsed.value = next;
			// A selected node hidden by the collapse hands the selection to the container.
			const selected = selectedId.value;
			if (want && selected && findNode(doc.value, selected)?.ancestors.includes(id)) selectedId.value = id;
		});
	}

	/** Collapse every container that has children, or expand everything. */
	function setAllCollapsed(want: boolean) {
		if (!want) {
			collapsed.value = new Set();
			return;
		}
		const containers = allIds(doc.value).filter((id) => (findNode(doc.value, id)?.node.children?.length ?? 0) > 0);
		batch(() => {
			collapsed.value = new Set(containers);
			const selected = selectedId.value;
			const top = selected ? findNode(doc.value, selected)?.ancestors[0] : undefined;
			if (top) selectedId.value = top;
		});
	}

	return {
		doc,
		selectedId,
		selectedNode,
		validation,
		canUndo,
		canRedo,
		collapsed,
		visible,
		commit,
		undo,
		redo,
		select,
		setCollapsed,
		setAllCollapsed,
		manifest,
		/** Component types the current user may not change. */
		locked,
		/** Whether a node is a locked component for the current user. */
		isLocked: (id: string | null | undefined) => {
			if (!id || locked.size === 0) return false;
			const node = findNode(doc.peek(), id)?.node;
			return Boolean(node && locked.has(node.type));
		},
		blocked,
	};
}

export type EditorStore = ReturnType<typeof createEditorStore>;
