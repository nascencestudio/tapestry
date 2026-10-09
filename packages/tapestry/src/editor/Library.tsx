import { draggable } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PatternSummary } from '../patterns.js';
import type { ComponentManifestEntry } from '../types.js';
import type { DragData } from './dnd.js';
import { UI_ICONS } from './icons.js';
import { LibraryPreview } from './LibraryPreview.js';
import { thumbnails } from './library-previews.js';
import { deletePattern, insertPattern, loadPatterns, patterns } from './patterns-client.js';
import type { EditorStore } from './store.js';
import { allIds, createNode, insertionTargetFor, insertNode } from './tree.js';

interface Props {
	store: EditorStore;
	announce: (message: string) => void;
}

/** Hovering or focusing a library item this long shows its preview. */
const PREVIEW_DELAY_MS = 350;

function LibraryItem({
	entry,
	onAdd,
	onPreview,
	locked,
}: {
	entry: ComponentManifestEntry;
	onAdd: () => void;
	/** Show (with the item's element) or hide (null) the preview. */
	onPreview: (element: HTMLElement | null) => void;
	/** The user may not add this component (ADR 0033). */
	locked: boolean;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const element = ref.current;
		if (!element || locked) return;
		const data: DragData = { tapestry: 'new', componentType: entry.type };
		return draggable({ element, getInitialData: () => data, onDragStart: () => onPreview(null) });
	}, [entry.type, onPreview, locked]);
	const role = entry.permission === 'owner' ? 'the owner' : `${entry.permission}s`;
	const thumbnail = thumbnails.value[entry.type];

	return (
		<li>
			<button
				ref={ref}
				type="button"
				class="tp-library__item"
				aria-disabled={locked || undefined}
				data-tapestry-locked={locked ? '' : undefined}
				onClick={() => {
					onPreview(null);
					onAdd();
				}}
				onMouseEnter={(e) => onPreview(e.currentTarget)}
				onMouseLeave={() => onPreview(null)}
				onFocus={(e) => onPreview(e.currentTarget)}
				onBlur={() => onPreview(null)}
				title={
					locked ? `Only ${role} can add ${entry.label}` : `Add ${entry.label} (or drag it into the page structure)`
				}
			>
				{locked && <span class="tp-library__lock">{UI_ICONS.lock}</span>}
				{thumbnail && <img class="tp-library__thumb" src={thumbnail} alt="" loading="lazy" draggable={false} />}
				<span class="tp-library__label">{entry.label}</span>
				{entry.description && <span class="tp-library__description">{entry.description}</span>}
			</button>
		</li>
	);
}

/** A saved pattern: click to insert a copy, drag it into the page, or delete it (author or admin). */
function PatternItem({
	pattern,
	onInsert,
	announce,
}: {
	pattern: PatternSummary;
	onInsert: () => void;
	announce: (message: string) => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	const [confirming, setConfirming] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const data: DragData = { tapestry: 'pattern', id: pattern.id, name: pattern.name };
		return draggable({ element, getInitialData: () => data });
	}, [pattern.id, pattern.name]);

	return (
		<li class="tp-library__pattern" data-tapestry-pattern={pattern.id}>
			<button
				ref={ref}
				type="button"
				class="tp-library__item"
				onClick={onInsert}
				title={`Insert a copy of “${pattern.name}” (or drag it into the page)`}
			>
				<span class="tp-library__label">{pattern.name}</span>
				<span class="tp-library__description">{pattern.description}</span>
			</button>
			{pattern.canDelete &&
				(confirming ? (
					<span class="tp-library__confirm">
						<button
							type="button"
							class="tp-link-button tp-link-button--danger"
							data-tapestry-pattern-delete-confirm
							onClick={async () => {
								const problem = await deletePattern(pattern.id);
								announce(
									problem ? `Couldn't delete “${pattern.name}”: ${problem}` : `Deleted the pattern “${pattern.name}”.`,
								);
								setConfirming(false);
							}}
						>
							Delete
						</button>
						<button type="button" class="tp-link-button" onClick={() => setConfirming(false)}>
							Keep
						</button>
					</span>
				) : (
					<button
						type="button"
						class="tp-icon-button tp-icon-button--danger tp-library__delete"
						aria-label={`Delete the pattern “${pattern.name}”`}
						title="Delete pattern (pages that used it keep their copy)"
						data-tapestry-pattern-delete
						onClick={() => setConfirming(true)}
					>
						✕
					</button>
				))}
		</li>
	);
}

/** Component library: grouped by category, searchable. Click to add, or drag into the layer tree. */
export function Library({ store, announce }: Props) {
	const query = useSignal('');
	const q = query.value.trim().toLowerCase();
	const entries = Object.values(store.manifest).filter(
		(e) =>
			!q || e.label.toLowerCase().includes(q) || e.type.includes(q) || (e.description ?? '').toLowerCase().includes(q),
	);

	const groups = new Map<string, ComponentManifestEntry[]>();
	for (const entry of entries) {
		const category = entry.category ?? 'Other';
		groups.set(category, [...(groups.get(category) ?? []), entry]);
	}

	useEffect(() => {
		if (patterns.peek() === null) void loadPatterns();
	}, []);

	// The live preview of the hovered/focused item, shown after a short delay.
	const [preview, setPreview] = useState<{ type: string; anchor: DOMRect } | null>(null);
	const previewTimer = useRef<ReturnType<typeof setTimeout>>();
	const previewFor = useMemo(() => {
		const handlers = new Map<string, (element: HTMLElement | null) => void>();
		return (type: string) => {
			let handler = handlers.get(type);
			if (!handler) {
				handler = (element) => {
					clearTimeout(previewTimer.current);
					if (!element) {
						setPreview(null);
						return;
					}
					previewTimer.current = setTimeout(
						() => setPreview({ type, anchor: element.getBoundingClientRect() }),
						PREVIEW_DELAY_MS,
					);
				};
				handlers.set(type, handler);
			}
			return handler;
		};
	}, []);
	useEffect(() => () => clearTimeout(previewTimer.current), []);
	const shownPatterns = (patterns.value ?? []).filter(
		(p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
	);

	function add(type: string) {
		const doc = store.doc.peek();
		const node = createNode(store.manifest, type, new Set(allIds(doc)));
		if (!node) return;
		const target = insertionTargetFor(doc, store.manifest, store.selectedId.peek());
		if (store.commit(insertNode(doc, store.manifest, node, target), { select: node.id })) {
			announce(`Added ${store.manifest[type]?.label ?? type}.`);
		}
	}

	return (
		<section class="tp-panel tp-library" aria-labelledby="tp-library-heading">
			<h3 id="tp-library-heading" class="tp-panel__title">
				Components
			</h3>
			<input
				type="search"
				class="tp-input"
				placeholder="Search components"
				aria-label="Search components"
				value={query.value}
				onInput={(e) => {
					query.value = e.currentTarget.value;
				}}
			/>
			{entries.length === 0 && shownPatterns.length === 0 && <p class="tp-muted">No components match.</p>}
			{[...groups].map(([category, items]) => (
				<div class="tp-library__group" key={category}>
					<h4 class="tp-library__category">{category}</h4>
					<ul class="tp-library__list">
						{items.map((entry) => (
							<LibraryItem
								key={entry.type}
								entry={entry}
								onAdd={() => add(entry.type)}
								onPreview={previewFor(entry.type)}
								locked={store.locked.has(entry.type)}
							/>
						))}
					</ul>
				</div>
			))}
			{shownPatterns.length > 0 && (
				<div class="tp-library__group" data-tapestry-patterns>
					<h4 class="tp-library__category">Patterns</h4>
					<ul class="tp-library__list">
						{shownPatterns.map((pattern) => (
							<PatternItem
								key={pattern.id}
								pattern={pattern}
								announce={announce}
								onInsert={() => {
									const target = insertionTargetFor(store.doc.peek(), store.manifest, store.selectedId.peek());
									void insertPattern(store, pattern, target, announce);
								}}
							/>
						))}
					</ul>
				</div>
			)}
			{preview && <LibraryPreview manifest={store.manifest} type={preview.type} anchor={preview.anchor} />}
		</section>
	);
}
