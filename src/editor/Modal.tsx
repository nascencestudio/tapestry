/**
 * A modal dialog for the editor's secondary views (history, version comparison, JSON): a
 * native `<dialog>` opened with `showModal()`, so focus stays inside, the rest of the page is
 * inert and it sits above full screen. Escape, the ✕ button and a click on the backdrop close
 * it, unless `dismissable` is false (unreadable content must be repaired first).
 */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { UI_ICONS } from './icons.js';

interface Props {
	title: string;
	/** Id for the heading (the dialog's accessible name). */
	id: string;
	size?: 'medium' | 'large';
	dismissable?: boolean;
	onClose: () => void;
	children: ComponentChildren;
	/** Extra attributes for tests and styling, e.g. `{ 'data-tapestry-history-modal': '' }`. */
	data?: Record<string, string>;
}

export function Modal({ title, id, size = 'medium', dismissable = true, onClose, children, data }: Props) {
	const dialog = useRef<HTMLDialogElement>(null);
	// Layout effect: open before the next paint, so focus and the backdrop are in place at once.
	useLayoutEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a mouse convenience; Escape and the ✕ button close it from the keyboard
		<dialog
			ref={dialog}
			class={`tp-modal tp-modal--${size}`}
			aria-labelledby={id}
			{...data}
			onCancel={(event) => {
				event.preventDefault(); // the component decides (and unmounts the dialog)
				if (dismissable) onClose();
			}}
			onClick={(event) => {
				// A click on the dialog element itself (not its content) is a click on the backdrop.
				if (dismissable && event.target === event.currentTarget) onClose();
			}}
		>
			<div class="tp-modal__body">
				<div class="tp-modal__header">
					<h3 id={id} class="tp-modal__title">
						{title}
					</h3>
					{dismissable && (
						<button
							type="button"
							class="tp-icon-button"
							aria-label="Close"
							title="Close (Escape)"
							data-tapestry-modal-close
							onClick={onClose}
						>
							{UI_ICONS.close}
						</button>
					)}
				</div>
				{children}
			</div>
		</dialog>
	);
}
