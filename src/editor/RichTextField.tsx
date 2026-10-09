/**
 * Settings-panel field for `richtext` props: a ProseMirror editor with a
 * toolbar limited to the prop's `toolbar` list (ADR 0012). Loaded on demand
 * (richtext-loader.ts), together with the inline canvas editor's core.
 *
 * ProseMirror owns the editing state (selection, its own undo history while
 * the field has focus). Every document change is reported through `onChange`
 * as the stored value; values that change from outside (Tapestry's undo,
 * Restore, JSON apply, inline editing on the canvas) replace the field's state.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PropValue, RichTextProp } from '../types.js';
import { createRichTextSession, type RichTextSession, RichTextToolbar } from './richtext-editor.js';

export { createRichTextSession, type RichTextSession, RichTextToolbar } from './richtext-editor.js';

interface Props {
	id: string;
	def: RichTextProp;
	value: PropValue | undefined;
	onChange: (value: PropValue | undefined) => void;
	labelledBy: string;
	describedBy: string | undefined;
	invalid: boolean;
	/** Shown but not editable (a locked component, ADR 0033). */
	readOnly?: boolean;
}

function attributesFor(
	id: string,
	labelledBy: string,
	describedBy: string | undefined,
	invalid: boolean,
	readOnly = false,
) {
	return {
		id,
		class: 'tp-richtext__content',
		role: 'textbox',
		'aria-multiline': 'true',
		'aria-labelledby': labelledBy,
		...(describedBy ? { 'aria-describedby': describedBy } : {}),
		...(invalid ? { 'aria-invalid': 'true' } : {}),
		...(readOnly ? { 'aria-readonly': 'true' } : {}),
	};
}

export function RichTextField({ id, def, value, onChange, labelledBy, describedBy, invalid, readOnly = false }: Props) {
	const toolbarKey = (def.toolbar ?? []).join(',');
	const mountRef = useRef<HTMLDivElement>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const [session, setSession] = useState<RichTextSession | null>(null);

	// Created once per field (and again if the toolbar changes); later values sync below.
	useEffect(() => {
		const created = createRichTextSession(mountRef.current as HTMLDivElement, {
			def,
			value,
			attributes: attributesFor(id, labelledBy, describedBy, invalid),
			onChange: (next) => onChangeRef.current(next),
		});
		setSession(created);
		return () => {
			created.destroy();
			setSession(null);
		};
	}, [id, toolbarKey]);

	// Accessibility attributes follow validation state; read-only fields can't be edited.
	useEffect(() => {
		session?.view.setProps({
			attributes: attributesFor(id, labelledBy, describedBy, invalid, readOnly),
			editable: () => !readOnly,
		});
	}, [session, id, labelledBy, describedBy, invalid, readOnly]);

	// Values changed from outside the field replace its content. A layout effect,
	// so it runs before the next input event: a passive effect could run after
	// further typing and "restore" an older value, moving the cursor.
	useLayoutEffect(() => {
		session?.sync(value);
	}, [session, value]);

	return (
		<div class="tp-richtext" data-tapestry-richtext={id}>
			{session && !readOnly && <RichTextToolbar session={session} label={def.label} />}
			<div ref={mountRef} class="tp-richtext__editor" />
		</div>
	);
}
