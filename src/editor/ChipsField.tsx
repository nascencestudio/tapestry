/**
 * Several choices as removable chips, added through a text box that autocompletes from the options (a
 * native `<datalist>`): `select` props with `multiple` and a template component's "Shown in" (ADR 0046).
 * No `name` attributes (StudioCMS would save them as plugin data); Enter adds instead of submitting.
 */
import { useState } from 'preact/hooks';
import { UI_ICONS } from './icons.js';

export interface Choice {
	value: string;
	label: string;
}

interface Props {
	id: string;
	options: readonly Choice[];
	value: readonly string[];
	onChange: (next: string[]) => void;
	/** The field's label element, for the text box's name. */
	labelledBy?: string;
	describedBy?: string;
	/** Chips that can't go below this many (the last one can't be removed). */
	minimum?: number;
	placeholder?: string;
	disabled?: boolean;
}

export function ChipsField({
	id,
	options,
	value,
	onChange,
	labelledBy,
	describedBy,
	minimum = 0,
	placeholder = 'Type to add…',
	disabled = false,
}: Props) {
	const [text, setText] = useState('');
	const chosen = value.map((v) => options.find((o) => o.value === v) ?? { value: v, label: `Missing: ${v}` });
	const available = options.filter((o) => !value.includes(o.value));
	const listId = `${id}-options`;
	const add = (choice: Choice | undefined) => {
		if (!choice || value.includes(choice.value)) return false;
		onChange([...value, choice.value]);
		setText('');
		return true;
	};
	const exact = (typed: string) => available.find((o) => o.label.toLowerCase() === typed.trim().toLowerCase());
	const startingWith = (typed: string) =>
		available.find((o) => o.label.toLowerCase().startsWith(typed.trim().toLowerCase()));
	const canRemove = value.length > minimum && !disabled;
	return (
		<div class="tp-chips" data-tapestry-chips={id}>
			{chosen.length > 0 && (
				<ul class="tp-chips__list">
					{chosen.map((choice) => (
						<li key={choice.value} class="tp-chips__chip" data-tapestry-chip-value={choice.value}>
							<span>{choice.label}</span>
							<button
								type="button"
								class="tp-chips__remove"
								aria-label={`Remove ${choice.label}`}
								title={canRemove ? `Remove ${choice.label}` : 'At least one is needed'}
								disabled={!canRemove}
								onClick={() => onChange(value.filter((v) => v !== choice.value))}
							>
								{UI_ICONS.close}
							</button>
						</li>
					))}
				</ul>
			)}
			{/* Always there (the field's label points at it), disabled when there's nothing to add. */}
			<input
				id={id}
				class="tp-input tp-chips__input"
				type="text"
				list={available.length > 0 ? listId : undefined}
				value={text}
				disabled={disabled || available.length === 0}
				placeholder={
					disabled
						? placeholder
						: options.length === 0
							? 'Nothing to choose yet'
							: available.length === 0
								? 'All chosen'
								: placeholder
				}
				autocomplete="off"
				aria-labelledby={labelledBy}
				aria-describedby={describedBy}
				onInput={(e) => {
					const typed = e.currentTarget.value;
					// Picking a suggestion puts its label in the box: add it at once.
					if (!add(exact(typed))) setText(typed);
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						// Never submit StudioCMS's page form.
						e.preventDefault();
						add(exact(text) ?? (text.trim() ? startingWith(text) : undefined));
					} else if (e.key === 'Escape' && text) {
						e.stopPropagation();
						setText('');
					}
				}}
			/>
			{available.length > 0 && (
				<datalist id={listId}>
					{available.map((o) => (
						<option key={o.value} value={o.label} />
					))}
				</datalist>
			)}
		</div>
	);
}
