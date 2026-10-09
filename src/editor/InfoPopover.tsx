/**
 * A button that opens a small popover dialog with a close button: the "i"
 * keyboard-help buttons (`InfoPopover`) and the translations menu. Closes with
 * the ✕, Escape (focus returns to the button) or a click outside. Help that
 * screen readers need all the time should also be in an `aria-describedby`
 * text (see `shortcutText()`).
 */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { UI_ICONS } from './icons.js';

export interface Shortcut {
	keys: string;
	action: string;
}

/** Shortcuts as one sentence, for a visually hidden description. */
export const shortcutText = (shortcuts: readonly Shortcut[]) =>
	`Keyboard: ${shortcuts.map((s) => `${s.keys} ${s.action}`).join(', ')}.`;

/** Shortcuts as a two-column list. */
export function ShortcutList({ shortcuts }: { shortcuts: readonly Shortcut[] }) {
	return (
		<dl class="tp-shortcuts">
			{shortcuts.map((s) => (
				<div class="tp-shortcuts__row" key={s.keys}>
					<dt>
						<kbd>{s.keys}</kbd>
					</dt>
					<dd>{s.action}</dd>
				</div>
			))}
		</dl>
	);
}

interface PopoverProps {
	/** Id of the popover (also `data-tp-info` on the button). */
	id: string;
	/** The button's tooltip, and its accessible name when it has no `text`. */
	label: string;
	/** Heading of the popover. */
	title: string;
	/**
	 * Below or above the button. It's left-aligned with the button (opening towards
	 * the editor, away from StudioCMS's sidebars) and flips to right-aligned only when
	 * there's no room on the right.
	 */
	placement?: 'below' | 'above';
	icon?: ComponentChildren;
	/** Visible button text (beside the icon); without it, an icon button. */
	text?: ComponentChildren;
	/** Called when the popover opens (e.g. to load its content). */
	onOpen?: () => void;
	children: ComponentChildren;
}

/** An "i" button with a help popover. */
export function InfoPopover(props: Omit<PopoverProps, 'icon' | 'text'>) {
	return <Popover {...props} icon={UI_ICONS.info} />;
}

export function Popover({ id, label, title, placement = 'below', icon, text, onOpen, children }: PopoverProps) {
	const [open, setOpen] = useState(false);
	const [align, setAlign] = useState<'start' | 'end'>('start');
	const button = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);

	// Measure before paint: left-aligned unless that would run off the right edge.
	useLayoutEffect(() => {
		if (!open || !button.current || !panel.current) return;
		const width = panel.current.offsetWidth;
		const left = button.current.getBoundingClientRect().left;
		setAlign(left + width <= document.documentElement.clientWidth - 8 ? 'start' : 'end');
	}, [open]);

	// A layout effect, so the listeners are in place before anything else can happen (a passive
	// effect runs after paint; a quick click outside could slip in before it).
	useLayoutEffect(() => {
		if (!open) return;
		panel.current?.focus();
		const onPointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			button.current?.focus();
		};
		document.addEventListener('pointerdown', onPointer, true);
		document.addEventListener('keydown', onKey, true);
		return () => {
			document.removeEventListener('pointerdown', onPointer, true);
			document.removeEventListener('keydown', onKey, true);
		};
	}, [open]);

	return (
		<span class="tp-info">
			<button
				ref={button}
				type="button"
				class={text ? 'tp-button tp-info__button tp-info__button--text' : 'tp-icon-button tp-info__button'}
				aria-label={text ? undefined : label}
				title={label}
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				data-tp-info={id}
				onClick={() => {
					if (!open) onOpen?.();
					setOpen(!open);
				}}
			>
				{icon}
				{text}
			</button>
			{open && (
				<div
					ref={panel}
					id={id}
					class={`tp-info__panel tp-info__panel--${placement} tp-info__panel--${align}`}
					role="dialog"
					aria-label={title}
					tabIndex={-1}
				>
					<div class="tp-info__header">
						<span class="tp-info__title">{title}</span>
						<button
							type="button"
							class="tp-icon-button tp-info__close"
							aria-label="Close"
							title="Close"
							data-tp-info-close
							onClick={() => {
								setOpen(false);
								button.current?.focus();
							}}
						>
							{UI_ICONS.close}
						</button>
					</div>
					<div class="tp-info__body">{children}</div>
				</div>
			)}
		</span>
	);
}
