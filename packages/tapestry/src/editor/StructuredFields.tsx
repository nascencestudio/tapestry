/**
 * Settings fields for `object` props (a group of fields) and `list` props (a
 * repeater: items with the same fields, added, removed and reordered here).
 * Item fields are the ordinary settings fields (`Row`, passed in by the panel).
 * Nested element ids use `__` (`…-items__2__question`), which can't collide with
 * the `-label`/`-help`/`-error` suffixes of the field holding them.
 */
import type { ComponentType } from 'preact';
import { useState } from 'preact/hooks';
import { richTextToPlain } from '../richtext.js';
import type {
	FieldDefinition,
	FieldValue,
	ListProp,
	ObjectProp,
	ObjectValue,
	PropDefinition,
	PropValue,
	RichTextDoc,
} from '../types.js';
import { listMaxItems } from '../validate.js';
import type { FieldChange } from './PropsPanel.js';
import { initialObject } from './tree.js';

type RowComponent = ComponentType<{
	id: string;
	fieldKey: string;
	def: PropDefinition;
	value: PropValue | undefined;
	onChange: FieldChange;
}>;

const asObject = (value: PropValue | undefined): ObjectValue =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : {};

/** A copy of `item` with one field set (or removed, for undefined). */
function withField(item: ObjectValue, name: string, value: PropValue | undefined): ObjectValue {
	const next = { ...item };
	if (value === undefined) delete next[name];
	else next[name] = value as FieldValue;
	return next;
}

/** The fields of one object (or list item). */
function Fields({
	id,
	fieldKey,
	fields,
	value,
	onChange,
	Row,
}: {
	id: string;
	fieldKey: string;
	fields: Record<string, FieldDefinition>;
	value: ObjectValue;
	onChange: (name: string, value: PropValue | undefined, coalesce?: string | false) => void;
	Row: RowComponent;
}) {
	return (
		<>
			{Object.entries(fields).map(([name, field]) => (
				<Row
					key={name}
					id={`${id}__${name}`}
					fieldKey={`${fieldKey}.${name}`}
					def={field}
					value={value[name]}
					onChange={(next, coalesce) => onChange(name, next, coalesce)}
				/>
			))}
		</>
	);
}

const subKey = (prefix: string, coalesce: string | false | undefined) =>
	coalesce === false ? false : `${prefix}${coalesce ? `.${coalesce}` : ''}`;

export function ObjectField({
	id,
	fieldKey,
	def,
	value,
	onChange,
	Row,
}: {
	id: string;
	fieldKey: string;
	def: ObjectProp;
	value: PropValue | undefined;
	onChange: FieldChange;
	Row: RowComponent;
}) {
	const object = asObject(value);
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would join StudioCMS's form semantics; a labelled group is enough
		<div id={id} class="tp-object-field" role="group" aria-labelledby={`${id}-label`} data-tapestry-object-field>
			<Fields
				id={id}
				fieldKey={fieldKey}
				fields={def.fields}
				value={object}
				Row={Row}
				onChange={(name, next, coalesce) => {
					const updated = withField(object, name, next);
					onChange(Object.keys(updated).length > 0 ? updated : undefined, subKey(name, coalesce));
				}}
			/>
		</div>
	);
}

/** A list item's title in the editor: its first text, or "Question 2". */
export function itemTitle(def: ListProp, item: ObjectValue, index: number): string {
	for (const [name, field] of Object.entries(def.fields)) {
		const value = item[name];
		const text =
			typeof value === 'string' && (field.type === 'text' || field.type === 'textarea')
				? value
				: field.type === 'richtext' && value && typeof value === 'object' && 'content' in value
					? richTextToPlain(value as RichTextDoc)
					: '';
		const flat = text.replace(/\s+/g, ' ').trim();
		if (flat) return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
	}
	const noun = def.itemLabel ?? 'item';
	return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${index + 1}`;
}

export function ListField({
	id,
	fieldKey,
	def,
	value,
	onChange,
	Row,
}: {
	id: string;
	fieldKey: string;
	def: ListProp;
	value: PropValue | undefined;
	onChange: FieldChange;
	Row: RowComponent;
}) {
	const items: ObjectValue[] = Array.isArray(value) ? value : [];
	const noun = def.itemLabel ?? 'item';
	const max = listMaxItems(def);
	// Open items, by position (a single item starts open).
	const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(items.length === 1 ? [0] : []));
	const [status, setStatus] = useState('');

	const update = (next: ObjectValue[], coalesce: string | false) =>
		onChange(next.length > 0 ? next : undefined, coalesce);
	const focusLater = (selector: string) =>
		requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${CSS.escape(id)} ${selector}`)?.focus());

	const move = (from: number, to: number) => {
		const next = items.slice();
		const [item] = next.splice(from, 1);
		if (!item) return;
		next.splice(to, 0, item);
		update(next, false);
		// Open state follows the moved item.
		setOpen(
			new Set(
				[...open].map((i) => {
					if (i === from) return to;
					if (from < to && i > from && i <= to) return i - 1;
					if (from > to && i >= to && i < from) return i + 1;
					return i;
				}),
			),
		);
		setStatus(`Moved ${itemTitle(def, item, to)} to position ${to + 1} of ${next.length}.`);
		const button = to < from ? (to === 0 ? 'down' : 'up') : to === next.length - 1 ? 'up' : 'down';
		focusLater(`[data-tapestry-list-item="${to}"] [data-tapestry-list-${button}]`);
	};

	const remove = (index: number) => {
		const item = items[index];
		if (!item) return;
		update(
			items.filter((_, i) => i !== index),
			false,
		);
		setOpen(new Set([...open].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))));
		setStatus(`Removed ${itemTitle(def, item, index)}. Undo brings it back.`);
		focusLater(
			items.length > 1
				? `[data-tapestry-list-item="${Math.min(index, items.length - 2)}"] [data-tapestry-list-toggle]`
				: '[data-tapestry-list-add]',
		);
	};

	const add = () => {
		update([...items, initialObject(def.fields)], false);
		setOpen(new Set([...open, items.length]));
		setStatus(`Added ${noun} ${items.length + 1}.`);
		focusLater(
			`[data-tapestry-list-item="${items.length}"] .tp-list-item__body input, [data-tapestry-list-item="${items.length}"] .tp-list-item__body button`,
		);
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would join StudioCMS's form semantics; a labelled group is enough
		<div id={id} class="tp-list-field" role="group" aria-labelledby={`${id}-label`} data-tapestry-list-field={fieldKey}>
			{items.length === 0 ? (
				<p class="tp-muted">Nothing added yet.</p>
			) : (
				<ol class="tp-list-field__items">
					{items.map((item, index) => {
						const expanded = open.has(index);
						const title = itemTitle(def, item, index);
						const bodyId = `${id}__${index}__body`;
						return (
							<li key={index} class="tp-list-item" data-tapestry-list-item={index}>
								<div class="tp-list-item__header">
									<button
										type="button"
										class="tp-list-item__toggle"
										aria-expanded={expanded}
										aria-controls={bodyId}
										data-tapestry-list-toggle
										onClick={() => {
											const next = new Set(open);
											if (expanded) next.delete(index);
											else next.add(index);
											setOpen(next);
										}}
									>
										<span class="tp-list-item__chevron" aria-hidden="true">
											{expanded ? '▾' : '▸'}
										</span>
										<span class="tp-list-item__title">{title}</span>
									</button>
									<button
										type="button"
										class="tp-icon-button"
										aria-label={`Move ${title} up`}
										title="Move up"
										disabled={index === 0}
										data-tapestry-list-up
										onClick={() => move(index, index - 1)}
									>
										↑
									</button>
									<button
										type="button"
										class="tp-icon-button"
										aria-label={`Move ${title} down`}
										title="Move down"
										disabled={index === items.length - 1}
										data-tapestry-list-down
										onClick={() => move(index, index + 1)}
									>
										↓
									</button>
									<button
										type="button"
										class="tp-icon-button"
										aria-label={`Remove ${title}`}
										title="Remove"
										data-tapestry-list-remove
										onClick={() => remove(index)}
									>
										✕
									</button>
								</div>
								{expanded && (
									<div class="tp-list-item__body" id={bodyId}>
										<Fields
											id={`${id}__${index}`}
											fieldKey={`${fieldKey}.${index}`}
											fields={def.fields}
											value={item}
											Row={Row}
											onChange={(name, next, coalesce) => {
												const updated = items.slice();
												updated[index] = withField(item, name, next);
												update(updated, subKey(`${index}.${name}`, coalesce));
											}}
										/>
									</div>
								)}
							</li>
						);
					})}
				</ol>
			)}
			<button
				type="button"
				class="tp-button tp-list-field__add"
				disabled={items.length >= max}
				data-tapestry-list-add
				onClick={add}
			>
				Add {noun}
			</button>
			{items.length >= max && <p class="tp-field__help">That's the most this list can have ({max}).</p>}
			<p class="tp-sr-only" aria-live="polite">
				{status}
			</p>
		</div>
	);
}
