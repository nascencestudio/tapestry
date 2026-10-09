import { createContext } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MediaItem, MediaProp, PropDefinition, PropValue, TapestryNode } from '../types.js';
import { LIMITS, validatePropValue } from '../validate.js';
import { canvasTextTargets } from './canvas/inline.js';
import { UI_ICONS } from './icons.js';
import { LinkField } from './LinkField.js';
import { chooseMedia, mediaAvailable, mediaItem } from './media.js';
import { savePattern } from './patterns-client.js';
import { preloadRichText, type RichTextModule, richTextModule } from './richtext-loader.js';
import { ListField, ObjectField } from './StructuredFields.js';
import type { EditorStore } from './store.js';
import { findNode, nodeSummary, setNodeLabel, updateProps } from './tree.js';

/**
 * `coalesce`: a key that merges quick successive changes into one undo step
 * (typing); `false` for a change that is always its own step (adding,
 * removing or moving list items).
 */
export type FieldChange = (value: PropValue | undefined, coalesce?: string | false) => void;

interface FieldProps {
	id: string;
	/** `nodeId.prop`, to match canvas editing targets (nested fields add `.index.field`). */
	fieldKey: string;
	def: PropDefinition;
	value: PropValue | undefined;
	onChange: FieldChange;
	describedBy: string | undefined;
	invalid: boolean;
}

const MEDIA_KIND_LABEL: Record<MediaItem['kind'], string> = {
	image: 'Image',
	video: 'Video',
	audio: 'Audio',
	document: 'Document',
	remoteVideo: 'Remote video',
};

/** A `media` prop: the chosen item's preview, and buttons to choose, replace or remove it. */
function MediaField({
	id,
	def,
	value,
	onChange,
	describedBy,
}: {
	id: string;
	def: MediaProp;
	value: PropValue | undefined;
	onChange: (value: PropValue | undefined) => void;
	describedBy: string | undefined;
}) {
	const chosen = typeof value === 'string' ? value : null;
	const [item, setItem] = useState<MediaItem | null | undefined>(undefined);
	useEffect(() => {
		if (!chosen) {
			setItem(null);
			return;
		}
		let alive = true;
		setItem(undefined);
		mediaItem(chosen).then((found) => alive && setItem(found));
		return () => {
			alive = false;
		};
	}, [chosen]);

	if (!mediaAvailable()) {
		return (
			<p id={id} class="tp-muted">
				Install and register @nascencestudio/medialibrary to choose media.
			</p>
		);
	}
	return (
		<div id={id} class="tp-media-field" aria-describedby={describedBy} data-tapestry-media-field={chosen ?? ''}>
			{chosen ? (
				item === undefined ? (
					<div class="tp-media-field__preview tp-muted">Loading…</div>
				) : item ? (
					<div class="tp-media-field__preview">
						{item.thumbnailUrl ? (
							<img src={item.thumbnailUrl} alt="" referrerpolicy="no-referrer" />
						) : (
							<span class="tp-media-field__kind">{MEDIA_KIND_LABEL[item.kind]}</span>
						)}
						<span class="tp-media-field__name">{item.name}</span>
					</div>
				) : (
					<p class="tp-field__error">The chosen media item no longer exists.</p>
				)
			) : (
				<p class="tp-muted">Nothing chosen.</p>
			)}
			<div class="tp-media-field__actions">
				<button
					type="button"
					class="tp-button"
					data-tapestry-media-choose
					onClick={async () => {
						const picked = await chooseMedia(def.accept ?? ['image'], `Choose: ${def.label}`);
						if (picked) onChange(picked.id);
					}}
				>
					{chosen ? 'Replace…' : 'Choose…'}
				</button>
				{chosen && (
					<button type="button" class="tp-button" data-tapestry-media-remove onClick={() => onChange(undefined)}>
						Remove
					</button>
				)}
			</div>
		</div>
	);
}

/**
 * Rich text the canvas can edit in place is edited there; the panel shows a
 * pointer, with the field one click away (keyboard users, narrow screens).
 */
/** Set while the selected component is locked for the user (ADR 0033): its fields are read-only. */
const ReadOnly = createContext(false);

function RichTextSetting(props: Parameters<RichTextModule['RichTextField']>[0] & { onCanvas: boolean }) {
	const [here, setHere] = useState(false);
	const readOnly = useContext(ReadOnly);
	const { onCanvas, ...fieldProps } = props;
	if (readOnly) return <LazyRichTextField {...fieldProps} readOnly />;
	if (onCanvas && !here) {
		return (
			<div class="tp-canvas-note" id={props.id} data-tapestry-canvas-note tabIndex={-1}>
				<p>Edit this text directly on the canvas: it's editable while the component is selected.</p>
				<button type="button" class="tp-link-button" data-tapestry-edit-here onClick={() => setHere(true)}>
					Edit here instead
				</button>
			</div>
		);
	}
	return <LazyRichTextField {...fieldProps} />;
}

function LazyRichTextField(props: Parameters<RichTextModule['RichTextField']>[0]) {
	const [mod, setMod] = useState(richTextModule);
	useEffect(() => {
		if (!mod)
			preloadRichText().then(setMod, (error) => console.error('[tapestry] rich text editor failed to load', error));
	}, [mod]);
	if (!mod) return <div class="tp-richtext tp-richtext--loading tp-muted">Loading editor…</div>;
	return <mod.RichTextField {...props} />;
}

/** One form control for one prop, chosen by prop type. */
function Field({ id, fieldKey, def, value, onChange, describedBy, invalid }: FieldProps) {
	const a11y = { 'aria-describedby': describedBy, 'aria-invalid': invalid || undefined };
	switch (def.type) {
		case 'text':
			return (
				<input
					id={id}
					{...a11y}
					class="tp-input"
					type="text"
					maxLength={def.maxLength ?? LIMITS.textMaxLength}
					value={typeof value === 'string' ? value : ''}
					onInput={(e) => onChange(e.currentTarget.value || undefined)}
				/>
			);
		case 'textarea':
			return (
				<textarea
					id={id}
					{...a11y}
					class="tp-input tp-input--multiline"
					rows={4}
					maxLength={def.maxLength ?? LIMITS.textareaMaxLength}
					value={typeof value === 'string' ? value : ''}
					onInput={(e) => onChange(e.currentTarget.value || undefined)}
				/>
			);
		case 'link':
			return <LinkField id={id} value={value} onChange={onChange} describedBy={describedBy} invalid={invalid} />;
		case 'url':
			// type="text" rather than "url": the browser's URL check rejects relative URLs.
			return (
				<input
					id={id}
					{...a11y}
					class="tp-input"
					type="text"
					inputMode="url"
					spellcheck={false}
					maxLength={LIMITS.urlMaxLength}
					placeholder="/page, https://…, mailto:…"
					value={typeof value === 'string' ? value : ''}
					onInput={(e) => onChange(e.currentTarget.value || undefined)}
				/>
			);
		case 'number':
			return (
				// Detached from StudioCMS's page form (form= an id that doesn't exist): an out-of-range value
				// would otherwise make the browser silently block Save. The panel shows the problem instead.
				<input
					id={id}
					form="tapestry-detached"
					{...a11y}
					class="tp-input"
					type="number"
					min={def.min}
					max={def.max}
					step="any"
					value={typeof value === 'number' ? String(value) : ''}
					onInput={(e) => {
						const raw = e.currentTarget.value;
						onChange(raw === '' ? undefined : Number(raw));
					}}
				/>
			);
		case 'boolean':
			return (
				<input
					id={id}
					{...a11y}
					class="tp-checkbox"
					type="checkbox"
					checked={value === true}
					onChange={(e) => onChange(e.currentTarget.checked)}
				/>
			);
		case 'richtext':
			return (
				<RichTextSetting
					onCanvas={canvasTextTargets.value.has(fieldKey)}
					id={id}
					def={def}
					value={value}
					onChange={onChange}
					labelledBy={`${id}-label`}
					describedBy={describedBy}
					invalid={invalid}
				/>
			);
		case 'media':
			return <MediaField id={id} def={def} value={value} onChange={onChange} describedBy={describedBy} />;
		case 'object':
			return <ObjectField id={id} fieldKey={fieldKey} def={def} value={value} onChange={onChange} Row={FieldRow} />;
		case 'list':
			return <ListField id={id} fieldKey={fieldKey} def={def} value={value} onChange={onChange} Row={FieldRow} />;
		case 'select':
			return (
				<select
					id={id}
					{...a11y}
					class="tp-input"
					value={typeof value === 'string' ? value : ''}
					onChange={(e) => onChange(e.currentTarget.value || undefined)}
				>
					{!def.required && def.default === undefined && <option value="">—</option>}
					{def.options.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			);
	}
}

function problemFor(def: PropDefinition, value: PropValue | undefined): string | null {
	if (value === undefined) {
		if (def.type === 'list' && (def.minItems ?? 0) > 0) return `Add at least ${def.minItems}.`;
		return def.required && def.default === undefined ? 'This field is required.' : null;
	}
	// Objects and lists show problems on their fields; here only the item count.
	if (def.type === 'object') return null;
	if (def.type === 'list') {
		const count = Array.isArray(value) ? value.length : 0;
		const min = def.minItems ?? 0;
		return count < min ? `Add at least ${min} (${count} now).` : null;
	}
	const problem = validatePropValue(def, value);
	return problem ? `Value ${problem}.` : null;
}

/** One setting: label, control, help and problem. Also used for the fields of objects and list items. */
export function FieldRow({
	id,
	fieldKey,
	def,
	value,
	onChange,
}: {
	id: string;
	fieldKey: string;
	def: PropDefinition;
	value: PropValue | undefined;
	onChange: FieldChange;
}) {
	const problem = problemFor(def, value);
	const describedBy = [def.description && `${id}-help`, problem && `${id}-error`].filter(Boolean).join(' ');
	const grouped = def.type === 'richtext' || def.type === 'object' || def.type === 'list';
	return (
		<div class={`tp-field tp-field--${def.type}`} data-tp-field={fieldKey}>
			<label id={`${id}-label`} for={grouped ? undefined : id} class="tp-field__label">
				{def.label}
				{def.required && (
					<span class="tp-field__required" aria-hidden="true">
						{' '}
						*
					</span>
				)}
			</label>
			<Field
				id={id}
				fieldKey={fieldKey}
				def={def}
				value={value}
				describedBy={describedBy || undefined}
				invalid={problem !== null}
				onChange={onChange}
			/>
			{def.description && (
				<p id={`${id}-help`} class="tp-field__help">
					{def.description}
				</p>
			)}
			{problem && (
				<p id={`${id}-error`} class="tp-field__error" role="alert">
					{problem}
				</p>
			)}
		</div>
	);
}

/** Settings form for the selected node, generated from its prop schema. */
/**
 * The node's editor-only name for the page structure. The input keeps its own
 * text while focused (saved labels are trimmed, which would eat the space being
 * typed between words) and follows the document otherwise (undo, other edits).
 */
function NodeLabelField({ store, node }: { store: EditorStore; node: TapestryNode }) {
	const ref = useRef<HTMLInputElement>(null);
	useLayoutEffect(() => {
		const input = ref.current;
		if (input && document.activeElement !== input) input.value = node.label ?? '';
	}, [node.label]);
	const id = `tp-node-label-${node.id}`;
	return (
		<div class="tp-field tp-field--label">
			<label for={id} class="tp-field__label">
				Name in page structure
			</label>
			<input
				ref={ref}
				id={id}
				class="tp-input"
				type="text"
				maxLength={LIMITS.labelMaxLength}
				defaultValue={node.label ?? ''}
				placeholder={nodeSummary(store.manifest, node) || 'Optional, e.g. "Pricing"'}
				aria-describedby={`${id}-help`}
				data-tp-node-label
				onInput={(e) => {
					store.commit(setNodeLabel(store.doc.peek(), node.id, e.currentTarget.value), {
						coalesceKey: `${node.id}.label`,
					});
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter') e.preventDefault();
				}}
				onBlur={(e) => {
					e.currentTarget.value = store.selectedNode.peek()?.label ?? '';
				}}
			/>
			<p id={`${id}-help`} class="tp-field__help">
				Only editors see this. It helps tell similar components apart.
			</p>
		</div>
	);
}

/**
 * "Save as pattern…": saves the selected component (with everything inside it)
 * to the library's Patterns, under a name. The page itself doesn't change.
 */
function SavePattern({ store, node }: { store: EditorStore; node: TapestryNode }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const [status, setStatus] = useState<{ kind: 'error' | 'done'; text: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const id = `tp-pattern-name-${node.id}`;
	const save = async () => {
		const clean = name.trim();
		if (!clean || busy) return;
		setBusy(true);
		const problem = await savePattern(clean, [node]);
		setBusy(false);
		if (problem) {
			setStatus({ kind: 'error', text: problem });
		} else {
			setStatus({ kind: 'done', text: `Saved “${clean}” to Patterns.` });
			setOpen(false);
		}
	};
	if (!open) {
		return (
			<div class="tp-save-pattern">
				<button
					type="button"
					class="tp-link-button"
					data-tapestry-save-pattern
					onClick={() => {
						setName(node.label || store.manifest[node.type]?.label || node.type);
						setStatus(null);
						setOpen(true);
						requestAnimationFrame(() => (document.getElementById(id) as HTMLInputElement | null)?.select());
					}}
				>
					Save as pattern…
				</button>
				{status && (
					<p class={status.kind === 'error' ? 'tp-field__error' : 'tp-field__help'} role="status">
						{status.text}
					</p>
				)}
			</div>
		);
	}
	return (
		<div class="tp-save-pattern tp-field">
			<label for={id} class="tp-field__label">
				Pattern name
			</label>
			<input
				id={id}
				class="tp-input"
				type="text"
				maxLength={LIMITS.labelMaxLength}
				value={name}
				data-tapestry-pattern-name
				onInput={(e) => setName(e.currentTarget.value)}
				onKeyDown={(e) => {
					// Enter would submit StudioCMS's form (a save); Escape cancels.
					if (e.key === 'Enter') {
						e.preventDefault();
						void save();
					} else if (e.key === 'Escape') {
						setOpen(false);
					}
				}}
			/>
			<p class="tp-field__help">A copy of this component and everything inside it, to insert on any page.</p>
			{status?.kind === 'error' && (
				<p class="tp-field__error" role="alert">
					{status.text}
				</p>
			)}
			<div class="tp-save-pattern__actions">
				<button
					type="button"
					class="tp-button tp-button--primary"
					disabled={!name.trim() || busy}
					data-tapestry-pattern-save
					onClick={() => void save()}
				>
					{busy ? 'Saving…' : 'Save pattern'}
				</button>
				<button type="button" class="tp-button" onClick={() => setOpen(false)}>
					Cancel
				</button>
			</div>
		</div>
	);
}

export function PropsPanel({ store }: { store: EditorStore }) {
	const node: TapestryNode | null = store.selectedNode.value;

	if (!node) {
		return (
			<section class="tp-panel tp-props" aria-labelledby="tp-props-heading">
				<h3 id="tp-props-heading" class="tp-panel__title">
					Settings
				</h3>
				<p class="tp-muted">Select a component in the page structure to edit its settings.</p>
			</section>
		);
	}

	const entry = store.manifest[node.type];
	const props = Object.entries(entry?.props ?? {});
	const locked = store.locked.has(node.type);
	const path = findNode(store.doc.value, node.id)
		?.ancestors.map((id) => store.manifest[findNode(store.doc.value, id)?.node.type ?? '']?.label ?? id)
		.join(' › ');

	return (
		<section class="tp-panel tp-props" aria-labelledby="tp-props-heading">
			<h3 id="tp-props-heading" class="tp-panel__title">
				{entry?.label ?? node.type}
			</h3>
			{path && <p class="tp-muted tp-props__path">In {path}</p>}
			{entry?.description && <p class="tp-muted">{entry.description}</p>}
			<NodeLabelField key={node.id} store={store} node={node} />
			<SavePattern key={`pattern-${node.id}`} store={store} node={node} />
			{props.length === 0 && <p class="tp-muted">This component has no settings.</p>}
			{locked && (
				<p class="tp-locked-note" data-tapestry-locked-note>
					{UI_ICONS.lock} Only {entry?.permission === 'owner' ? 'the owner' : `${entry?.permission}s`} can change this
					component. You can still name it and save it as a pattern.
				</p>
			)}
			{/* Locked for this user (ADR 0033): every control is disabled, rich text read-only. */}
			<ReadOnly.Provider value={locked}>
				<fieldset class="tp-props__fields" disabled={locked}>
					{props.map(([name, def]) => (
						<FieldRow
							key={`${node.id}-${name}`}
							id={`tp-field-${node.id}-${name}`}
							fieldKey={`${node.id}.${name}`}
							def={def}
							value={node.props[name]}
							onChange={(next, coalesce) =>
								store.commit(updateProps(store.doc.peek(), node.id, { [name]: next }), {
									coalesceKey: coalesce === false ? undefined : `${node.id}.${name}${coalesce ? `.${coalesce}` : ''}`,
								})
							}
						/>
					))}
				</fieldset>
			</ReadOnly.Provider>
		</section>
	);
}
