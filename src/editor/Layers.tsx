import {
	draggable,
	dropTargetForElements,
	monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/utils/combine';
import { attachInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item/attach-instruction';
import { extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item/extract-instruction';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { areaLabel, childAreas, hasChildAreas } from '../slots.js';
import type { TapestryNode } from '../types.js';
import { activeEndZone, type DragData, dropIndicator, isDragData, isDragging } from './dnd.js';
import { InfoPopover, type Shortcut, ShortcutList, shortcutText } from './InfoPopover.js';
import { UI_ICONS } from './icons.js';
import type { EditorStore } from './store.js';
import { copySelection, handleStructureKey, pasteClipboard } from './structure-keys.js';
import { duplicateNode, isSelfOrDescendant, nodeSummary, removeNode } from './tree.js';

/** Keyboard shortcuts of the page structure (shown in its info popover). */
const TREE_SHORTCUTS: readonly Shortcut[] = [
	{ keys: '↑ / ↓', action: 'select' },
	{ keys: '→ / ←', action: 'expand / collapse' },
	{ keys: 'Alt+↑ / ↓', action: 'move' },
	{ keys: 'Alt+→', action: 'into the container above' },
	{ keys: 'Alt+←', action: 'out of its container' },
	{ keys: 'Delete', action: 'remove' },
	{ keys: 'Ctrl/⌘+D', action: 'duplicate' },
	{ keys: 'Ctrl/⌘+C / X / V', action: 'copy, cut, paste (also between pages)' },
	{ keys: 'Ctrl/⌘+Z', action: 'undo' },
];

/** Hovering a collapsed container this long during a drag expands it. */
const EXPAND_ON_HOVER_MS = 600;
/** Distance from a scroll container's edge (px) where dragging starts scrolling it. */
const AUTO_SCROLL_EDGE = 72;
/** Fastest auto-scroll speed, in px per frame. */
const AUTO_SCROLL_MAX = 18;

/** The nearest scrollable ancestor (or the page) of an element. */
function scrollParent(element: HTMLElement): HTMLElement {
	for (let el = element.parentElement; el; el = el.parentElement) {
		const { overflowY } = getComputedStyle(el);
		if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
	}
	return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/**
 * While a drag is in progress, scroll the layer tree's scroll container when
 * the pointer is near its top or bottom edge (faster closer to the edge), so
 * long pages can be reordered without dropping and re-dragging.
 */
function useAutoScroll(ref: { current: HTMLElement | null }) {
	useEffect(() => {
		let pointerY: number | null = null;
		let frame = 0;
		const tick = () => {
			frame = 0;
			const element = ref.current;
			if (pointerY === null || !element) return;
			const scroller = scrollParent(element);
			const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
			const top = isPage ? 0 : scroller.getBoundingClientRect().top;
			const bottom = isPage ? window.innerHeight : scroller.getBoundingClientRect().bottom;
			let delta = 0;
			if (pointerY < top + AUTO_SCROLL_EDGE) delta = -AUTO_SCROLL_MAX * (1 - (pointerY - top) / AUTO_SCROLL_EDGE);
			else if (pointerY > bottom - AUTO_SCROLL_EDGE)
				delta = AUTO_SCROLL_MAX * (1 - (bottom - pointerY) / AUTO_SCROLL_EDGE);
			if (delta !== 0) {
				scroller.scrollBy(0, Math.round(Math.max(-AUTO_SCROLL_MAX, Math.min(AUTO_SCROLL_MAX, delta))));
				frame = requestAnimationFrame(tick);
			}
		};
		const stop = () => {
			pointerY = null;
			if (frame) cancelAnimationFrame(frame);
			frame = 0;
		};
		const cleanup = monitorForElements({
			canMonitor: ({ source }) => isDragData(source.data),
			onDrag: ({ location }) => {
				pointerY = location.current.input.clientY;
				if (!frame) frame = requestAnimationFrame(tick);
			},
			onDrop: stop,
		});
		return () => {
			stop();
			cleanup();
		};
	}, [ref]);
}

interface Props {
	store: EditorStore;
	announce: (message: string) => void;
}

/** Focus a layer row by node id after the DOM updates. */
function focusRow(id: string) {
	requestAnimationFrame(() => {
		document.querySelector<HTMLElement>(`[data-tp-row="${CSS.escape(id)}"]`)?.focus();
	});
}

/** "Drop here" zone that appends to a container's area (or the page when `parentId` is null). */
function EndZone({
	store,
	parentId,
	slot,
	label,
}: {
	store: EditorStore;
	parentId: string | null;
	slot?: string;
	label: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const key = `${parentId ?? 'root'}${slot === undefined ? '' : `:${slot}`}`;

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		return dropTargetForElements({
			element,
			canDrop: ({ source }) =>
				isDragData(source.data) &&
				!(
					source.data.tapestry === 'node' &&
					parentId !== null &&
					isSelfOrDescendant(store.doc.peek(), source.data.id, parentId)
				),
			getData: () => (slot === undefined ? { tapestry: 'end', parentId } : { tapestry: 'end', parentId, slot }),
			onDragEnter: () => {
				activeEndZone.value = key;
			},
			onDragLeave: () => {
				if (activeEndZone.value === key) activeEndZone.value = null;
			},
		});
	}, [parentId, slot, key, store]);

	return (
		<div
			ref={ref}
			class="tp-endzone"
			data-tp-endzone={key}
			data-active={activeEndZone.value === key ? '' : undefined}
			data-visible={isDragging.value ? '' : undefined}
		>
			{label}
		</div>
	);
}

function Row({
	store,
	node,
	level,
	area,
}: {
	store: EditorStore;
	node: TapestryNode;
	level: number;
	/** The parent's slot this row is in, for screen readers (only under components with named slots). */
	area?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const entry = store.manifest[node.type];
	const container = hasChildAreas(entry);
	const locked = store.locked.has(node.type);
	const childCount = node.children?.length ?? 0;
	const collapsed = container && childCount > 0 && store.collapsed.value.has(node.id);
	const selected = store.selectedId.value === node.id;
	const indicator = dropIndicator.value?.id === node.id ? dropIndicator.value.operation : null;

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const data: DragData = { tapestry: 'node', id: node.id };
		return combine(
			// Locked components (ADR 0033) can't be moved by this user.
			draggable({ element, getInitialData: () => data, canDrag: () => !store.locked.has(node.type) }),
			dropTargetForElements({
				element,
				canDrop: ({ source }) =>
					isDragData(source.data) &&
					!(source.data.tapestry === 'node' && isSelfOrDescendant(store.doc.peek(), source.data.id, node.id)),
				getData: ({ input }) =>
					attachInstruction(
						{ tapestry: 'row', id: node.id },
						{
							element,
							input,
							operations: {
								'reorder-before': 'available',
								'reorder-after': 'available',
								combine: container ? 'available' : 'not-available',
							},
						},
					),
				onDrag: ({ self }) => {
					const instruction = extractInstruction(self.data);
					dropIndicator.value =
						instruction && !instruction.blocked ? { id: node.id, operation: instruction.operation } : null;
					// Hovering a collapsed container for a moment opens it, so items can be dropped among
					// its children. Measured here (onDrag keeps firing while hovering): a drag-enter timer
					// was cancelled by a spurious drag-leave right after entering.
					if (store.collapsed.peek().has(node.id)) {
						hoverStart.current ??= Date.now();
						if (Date.now() - hoverStart.current >= EXPAND_ON_HOVER_MS) {
							hoverStart.current = undefined;
							store.setCollapsed(node.id, false);
						}
					}
				},
				onDragLeave: () => {
					hoverStart.current = undefined;
					if (dropIndicator.value?.id === node.id) dropIndicator.value = null;
				},
				onDrop: () => {
					hoverStart.current = undefined;
				},
			}),
		);
	}, [node.id, container, store]);
	const hoverStart = useRef<number | undefined>(undefined);

	const summary = nodeSummary(store.manifest, node);

	return (
		<li role="none">
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled by the tree's onKeyDown (roving focus) */}
			<div
				ref={ref}
				role="treeitem"
				aria-level={level}
				aria-selected={selected}
				aria-expanded={container && childCount > 0 ? !collapsed : undefined}
				tabIndex={selected ? 0 : -1}
				class="tp-row"
				data-tp-row={node.id}
				data-indicator={indicator ?? undefined}
				style={{ '--tp-level': level - 1 } as JSX.CSSProperties}
				onClick={() => store.select(node.id)}
				onFocus={() => {
					if (!selected) store.select(node.id);
				}}
			>
				<span class="tp-row__grip" aria-hidden="true">
					⋮⋮
				</span>
				{container && childCount > 0 ? (
					<button
						type="button"
						class="tp-row__toggle"
						tabIndex={-1}
						aria-label={collapsed ? `Expand ${entry?.label ?? node.type}` : `Collapse ${entry?.label ?? node.type}`}
						title={collapsed ? 'Expand (→)' : 'Collapse (←)'}
						data-tp-toggle={node.id}
						onClick={(e) => {
							e.stopPropagation();
							store.setCollapsed(node.id);
						}}
					>
						{UI_ICONS.chevron}
					</button>
				) : (
					<span class="tp-row__toggle tp-row__toggle--leaf" aria-hidden="true">
						{UI_ICONS.dot}
					</span>
				)}
				<span class="tp-row__label">{entry?.label ?? node.type}</span>
				{locked && (
					<span
						class="tp-row__lock"
						title={`Only ${entry?.permission === 'owner' ? 'the owner' : `${entry?.permission}s`} can change this`}
						data-tapestry-locked
					>
						{UI_ICONS.lock}
						<span class="tp-sr-only">, locked</span>
					</span>
				)}
				{area && <span class="tp-sr-only">, in {area}</span>}
				{node.label ? (
					<span class="tp-row__name" data-tp-row-name>
						{node.label}
					</span>
				) : (
					summary && <span class="tp-row__summary">{summary}</span>
				)}
				{collapsed && (
					<span class="tp-row__count" title={`${childCount} inside`}>
						{childCount}
					</span>
				)}
				<span class="tp-row__actions" hidden={locked}>
					<button
						type="button"
						class="tp-icon-button"
						aria-label={`Duplicate ${entry?.label ?? node.type}`}
						title="Duplicate (Ctrl/⌘+D)"
						onClick={(e) => {
							e.stopPropagation();
							const result = duplicateNode(store.doc.peek(), store.manifest, node.id);
							if (result) store.commit(result.doc, { select: result.id });
						}}
					>
						⧉
					</button>
					<button
						type="button"
						class="tp-icon-button tp-icon-button--danger"
						aria-label={`Delete ${entry?.label ?? node.type}`}
						title="Delete (Delete key)"
						onClick={(e) => {
							e.stopPropagation();
							store.commit(removeNode(store.doc.peek(), node.id), { select: null });
						}}
					>
						✕
					</button>
				</span>
			</div>
			{container && !collapsed && (
				// biome-ignore lint/a11y/useSemanticElements: ARIA tree pattern; <fieldset> is not appropriate
				<ul role="group" class="tp-tree__group" style={{ '--tp-level': level } as JSX.CSSProperties}>
					{entry?.slots ? (
						// Components with named slots: one labelled group per area.
						childAreas(entry).map((slot) => {
							const label = slot === undefined ? 'Main area' : areaLabel(entry, slot);
							const inArea = (node.children ?? []).filter((child) => child.slot === slot);
							return (
								<li role="none" key={slot ?? ''} class="tp-tree__area" data-tp-area={`${node.id}:${slot ?? ''}`}>
									<div class="tp-tree__area-label" aria-hidden="true">
										{label}
									</div>
									{/* biome-ignore lint/a11y/useSemanticElements: ARIA tree pattern */}
									<ul role="group" class="tp-tree__group" aria-label={label}>
										{inArea.map((child) => (
											<Row key={child.id} store={store} node={child} level={level + 1} area={label} />
										))}
										<li role="none">
											<EndZone
												store={store}
												parentId={node.id}
												slot={slot}
												label={
													inArea.length ? `Drop to add at the end of ${label}` : `Empty — drop components into ${label}`
												}
											/>
										</li>
									</ul>
								</li>
							);
						})
					) : (
						<>
							{node.children?.map((child) => (
								<Row key={child.id} store={store} node={child} level={level + 1} />
							))}
							<li role="none">
								<EndZone
									store={store}
									parentId={node.id}
									label={
										node.children?.length
											? `Drop to add at the end of ${entry?.label ?? node.type}`
											: `Empty — drop components into ${entry?.label ?? node.type}`
									}
								/>
							</li>
						</>
					)}
				</ul>
			)}
		</li>
	);
}

/** The page structure: a nested, drag-and-drop, keyboard-accessible tree of nodes. */
export function Layers({ store, announce }: Props) {
	const doc = store.doc.value;
	const treeRef = useRef<HTMLUListElement>(null);
	useAutoScroll(treeRef);
	// Any container with children (a nested one implies its top-level ancestor has children).
	const hasContainers = doc.root.some((node) => (node.children?.length ?? 0) > 0);

	const keyOptions = { announce, mode: 'tree' as const, focus: focusRow };
	const onKeyDown = (event: KeyboardEvent) => handleStructureKey(store, event, keyOptions);

	const hasFocusTarget = doc.root.length > 0 && !store.selectedId.value;

	return (
		<section class="tp-panel tp-layers" aria-labelledby="tp-layers-heading">
			<div class="tp-panel__header">
				<h3 id="tp-layers-heading" class="tp-panel__title">
					Page structure
				</h3>
				<span class="tp-layers__actions">
					{hasContainers && (
						<>
							<button
								type="button"
								class="tp-icon-button"
								aria-label="Collapse all"
								title="Collapse all"
								data-tp-collapse-all
								onClick={() => store.setAllCollapsed(true)}
							>
								{UI_ICONS.collapseAll}
							</button>
							<button
								type="button"
								class="tp-icon-button"
								aria-label="Expand all"
								title="Expand all"
								data-tp-expand-all
								onClick={() => store.setAllCollapsed(false)}
							>
								{UI_ICONS.expandAll}
							</button>
						</>
					)}
					<InfoPopover
						id="tp-layers-help"
						label="Keyboard shortcuts for the page structure"
						title="Page structure keys"
					>
						<ShortcutList shortcuts={TREE_SHORTCUTS} />
					</InfoPopover>
				</span>
			</div>
			{doc.root.length === 0 && (
				<p class="tp-muted">This page is empty. Drag a component here, or click one in the list.</p>
			)}
			<ul
				// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA tree pattern; there is no native tree element
				role="tree"
				aria-label="Page structure"
				aria-describedby="tp-layers-keys"
				class="tp-tree"
				ref={treeRef}
				tabIndex={hasFocusTarget ? 0 : -1}
				onKeyDown={onKeyDown}
				onCopy={(e) => copySelection(store, e, keyOptions)}
				onCut={(e) => copySelection(store, e, { ...keyOptions, cut: true })}
				onPaste={(e) => pasteClipboard(store, e, keyOptions)}
				onFocus={(e) => {
					if (e.target === e.currentTarget && !store.selectedId.peek() && doc.root[0]) {
						store.select(doc.root[0].id);
						focusRow(doc.root[0].id);
					}
				}}
			>
				{doc.root.map((node) => (
					<Row key={node.id} store={store} node={node} level={1} />
				))}
			</ul>
			<EndZone store={store} parentId={null} label="Drop to add at the end of the page" />
			<p id="tp-layers-keys" class="tp-sr-only">
				{shortcutText(TREE_SHORTCUTS)}
			</p>
		</section>
	);
}
