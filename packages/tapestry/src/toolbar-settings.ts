/**
 * Admin toolbar settings: site admins can narrow each rich text field's
 * toolbar from the dashboard (Plugins → Tapestry → Text formatting). The
 * developer's `toolbar` in `defineComponent()` stays the ceiling: admins can
 * turn buttons off, never add ones the developer didn't allow. See ADR 0014.
 *
 * Settings record the buttons admins turned **off**, so a button the developer
 * adds later shows up by default.
 *
 * Settings affect editing (buttons, shortcuts, paste, the JSON view); stored
 * content isn't rewritten, and the public renderer keeps the developer's list.
 *
 * Pure functions only.
 */
import { DEFAULT_TOOLBAR, RICH_TEXT_BUTTONS, type RichTextButton } from './richtext.js';
import type { ComponentManifest } from './types.js';

export interface ToolbarSettings {
	version: 2;
	/** Buttons turned off per field, keyed `componentType.propName`. Fields not listed use the developer's toolbar. */
	disabled: Record<string, RichTextButton[]>;
}

export interface RichTextField {
	key: string;
	componentType: string;
	componentLabel: string;
	prop: string;
	propLabel: string;
	/** The developer's toolbar (the most that can be enabled). */
	toolbar: readonly RichTextButton[];
}

export function emptyToolbarSettings(): ToolbarSettings {
	return { version: 2, disabled: {} };
}

/** Every rich text field in the manifest, in registration order. */
export function richTextFields(manifest: ComponentManifest): RichTextField[] {
	const fields: RichTextField[] = [];
	for (const entry of Object.values(manifest)) {
		for (const [prop, def] of Object.entries(entry.props ?? {})) {
			if (def.type !== 'richtext') continue;
			fields.push({
				key: `${entry.type}.${prop}`,
				componentType: entry.type,
				componentLabel: entry.label,
				prop,
				propLabel: def.label,
				toolbar: def.toolbar ?? DEFAULT_TOOLBAR,
			});
		}
	}
	return fields;
}

const isButton = (value: unknown): value is RichTextButton =>
	typeof value === 'string' && (RICH_TEXT_BUTTONS as readonly string[]).includes(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Clean stored or submitted settings: known fields only, buttons limited to
 * the developer's toolbar (in its order), no duplicates. Reads format 1 (which
 * listed the *enabled* buttons) too. Never throws.
 */
export function parseToolbarSettings(raw: unknown, manifest: ComponentManifest): ToolbarSettings {
	const settings = emptyToolbarSettings();
	if (!isPlainObject(raw)) return settings;
	const v1 = raw.version !== 2 && isPlainObject(raw.fields);
	const input = v1 ? (raw.fields as Record<string, unknown>) : isPlainObject(raw.disabled) ? raw.disabled : {};
	for (const field of richTextFields(manifest)) {
		if (!Object.hasOwn(input, field.key)) continue;
		const listed = input[field.key];
		if (!Array.isArray(listed)) continue;
		const chosen = new Set(listed.filter(isButton));
		const off = field.toolbar.filter((b) => (v1 ? !chosen.has(b) : chosen.has(b)));
		if (off.length > 0) settings.disabled[field.key] = off;
	}
	return settings;
}

/** Form field names used by the settings page. */
export const FORM = {
	/** Hidden marker: this field was on the form (unchecked boxes aren't submitted). */
	field: (key: string) => `field:${key}`,
	/** Checkbox per enabled button; value is the button name. */
	button: (key: string) => `toolbar:${key}`,
};

/** Settings from the settings page form (`FormData` or `URLSearchParams`): unchecked buttons are turned off. */
export function settingsFromForm(
	form: { getAll(name: string): unknown[]; has(name: string): boolean },
	manifest: ComponentManifest,
): ToolbarSettings {
	const disabled: Record<string, RichTextButton[]> = {};
	for (const field of richTextFields(manifest)) {
		if (!form.has(FORM.field(field.key))) continue;
		const checked = new Set(form.getAll(FORM.button(field.key)));
		disabled[field.key] = field.toolbar.filter((b) => !checked.has(b));
	}
	return parseToolbarSettings({ version: 2, disabled }, manifest);
}

/** The buttons editors get for a field: the developer's toolbar minus what admins turned off. */
export function enabledButtons(field: RichTextField, settings: ToolbarSettings): RichTextButton[] {
	const off = new Set(settings.disabled[field.key] ?? []);
	return field.toolbar.filter((b) => !off.has(b));
}

/**
 * The manifest editors work with: each rich text prop's toolbar narrowed by
 * the admin settings (never widened). Returns a copy; the input is unchanged.
 */
export function applyToolbarSettings(manifest: ComponentManifest, settings: ToolbarSettings): ComponentManifest {
	const out: ComponentManifest = {};
	for (const [type, entry] of Object.entries(manifest)) {
		const props = entry.props ? { ...entry.props } : undefined;
		for (const [prop, def] of Object.entries(props ?? {})) {
			const off = settings.disabled[`${type}.${prop}`];
			if (def.type !== 'richtext' || !off || !props) continue;
			const disabled = new Set(off);
			props[prop] = { ...def, toolbar: (def.toolbar ?? DEFAULT_TOOLBAR).filter((b) => !disabled.has(b)) };
		}
		out[type] = props ? { ...entry, props } : { ...entry };
	}
	return out;
}
