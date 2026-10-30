/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * A page's layout (ADR 0041): its template (or, without one, its own header and footer), the
 * header/footer documents for `<Region>`, and the body to render: the page merged into its template.
 * Visitors get published versions; editors previewing (and the canvas) get drafts. Server only.
 */
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import {
	type ContentArea,
	mergeTemplate,
	PART_ID,
	type Region,
	TEMPLATE_ID,
	type TemplateRecord,
	templateAreas,
	versionFor,
} from '../templates.js';
import type { TapestryDocument } from '../types.js';
import { emptyDocument } from '../validate.js';
import { getPart, getTemplate } from './templates-store.js';

export { EDIT_TEMPLATE_PARAM, FOOTER_PARAM, HEADER_PARAM, PART_PARAM, TEMPLATE_PARAM } from './canvas-mode.js';

export interface RegionContent {
	/** The part shown in this region, or null. */
	part: string | null;
	/** Its document for this viewer, or null (no part, or never published and not previewing). */
	document: TapestryDocument | null;
}

export interface PageRegions {
	/** The template the page uses, or null (a one-off page). */
	template: { id: string; name: string; areas: ContentArea[] } | null;
	header: RegionContent;
	footer: RegionContent;
	/** Set in the part editor's canvas: the part being edited (its region is the editable one). */
	editingPart: string | null;
	/** Set in the template editor's canvas: the template whose body is edited. */
	editingTemplate: string | null;
}

const EMPTY: RegionContent = { part: null, document: null };

/** Editors' canvas overrides: an unsaved layout choice, or the part/template being edited. */
export interface LayoutOverrides {
	/** `tt_…`, or `none`. */
	template?: string | null;
	/** For pages without a template: part ids, or empty for none. */
	header?: string | null;
	footer?: string | null;
	editingPart?: string | null;
	editingTemplate?: string | null;
}

export interface PageLayout {
	regions: PageRegions;
	/**
	 * The document to render as the page body for `doc`: in a display mode (ADR 0046; default Full), and in
	 * the editor's canvas with each area showing its tab.
	 */
	body: (
		doc: TapestryDocument | null,
		options?: { mode?: string; tabs?: Readonly<Record<string, string>> },
	) => TapestryDocument | null;
}

const NONE: PageLayout = {
	regions: { template: null, header: EMPTY, footer: EMPTY, editingPart: null, editingTemplate: null },
	body: (doc) => doc,
};

const valid = (id: string | null | undefined, pattern: RegExp) => (id && pattern.test(id) ? id : null);

export async function loadLayout(options: {
	/** The page document being shown (its layout choice), or null (non-Tapestry pages). */
	doc: Pick<TapestryDocument, 'template' | 'header' | 'footer'> | null;
	/** Editors previewing or in the canvas: drafts of parts and templates. */
	preview: boolean;
	overrides?: LayoutOverrides;
}): Promise<PageLayout> {
	const { doc, preview } = options;
	const o = options.overrides ?? {};
	try {
		// The template editor's canvas: that template, whatever the page uses.
		const editingTemplateId = valid(o.editingTemplate, TEMPLATE_ID);
		const chosenTemplateId =
			editingTemplateId ?? (o.template === 'none' ? null : (valid(o.template, TEMPLATE_ID) ?? doc?.template ?? null));
		const template: TemplateRecord | null = chosenTemplateId
			? await getTemplate(chosenTemplateId, manifest, config.historyLimit)
			: null;
		const editingPartId = valid(o.editingPart, PART_ID);
		const editing = editingPartId ? await getPart(editingPartId, manifest, config.historyLimit) : null;
		// Which part each region shows: the template's, else the page's own choice (or its override).
		const own = (name: Region) => {
			const override = o[name];
			if (override !== undefined && override !== null) return override === '' ? null : override;
			return doc?.[name] ?? null;
		};
		const region = async (name: Region): Promise<RegionContent> => {
			// The part being edited always gets a document (an empty one when new), so the canvas has a root.
			if (editing?.region === name) {
				return { part: editing.id, document: versionFor(editing, true) ?? emptyDocument() };
			}
			const id = valid(template ? template[name] : own(name), PART_ID);
			if (!id) return EMPTY;
			const part = await getPart(id, manifest, config.historyLimit);
			return part ? { part: part.id, document: versionFor(part, preview) } : EMPTY;
		};
		const [header, footer] = await Promise.all([region('header'), region('footer')]);
		const templateBody = template
			? (versionFor(template, preview || Boolean(editingTemplateId)) ?? emptyDocument())
			: null;
		const regions: PageRegions = {
			template: template ? { id: template.id, name: template.name, areas: templateAreas(templateBody) } : null,
			header,
			footer,
			editingPart: editing?.id ?? null,
			editingTemplate: editingTemplateId && template ? template.id : null,
		};
		const body = (
			page: TapestryDocument | null,
			options: { mode?: string; tabs?: Readonly<Record<string, string>> } = {},
		): TapestryDocument | null => {
			// The part editor: an empty body (the placeholder goes there).
			if (regions.editingPart) return emptyDocument();
			// The template editor: the template body itself is what's edited.
			if (regions.editingTemplate) return templateBody;
			if (templateBody && page) return mergeTemplate(templateBody, page, options);
			return page;
		};
		return { regions, body };
	} catch (error) {
		console.error('[tapestry] loading the page layout failed', error);
		return NONE;
	}
}
