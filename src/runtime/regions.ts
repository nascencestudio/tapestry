/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * A page's template regions (ADR 0041): which template it uses and the header/footer documents to
 * show, for `getPage()` and `<Region>`. Visitors get published part versions; editors previewing
 * (and the canvas) get drafts. Server only.
 */
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import { PART_ID, partDocument, type Region, resolveTemplate, TEMPLATE_ID } from '../templates.js';
import type { TapestryDocument } from '../types.js';
import { getDefaultTemplate, getPart, listTemplates } from './templates-store.js';

/** Query parameter: the page canvas previews a template choice that isn't saved yet. */
export const TEMPLATE_PARAM = 'tapestry-template';
/** Query parameter: the part editor's canvas (this part is edited; the page body is a placeholder). */
export const PART_PARAM = 'tapestry-part';

export interface RegionContent {
	/** The part shown in this region, or null. */
	part: string | null;
	/** Its document for this viewer, or null (no part, or never published and not previewing). */
	document: TapestryDocument | null;
}

export interface PageRegions {
	/** The template in use, or null (no templates yet). */
	template: { id: string; name: string } | null;
	header: RegionContent;
	footer: RegionContent;
	/** Set in the part editor's canvas: the part being edited (its region is the editable one). */
	editingPart: string | null;
}

const EMPTY: RegionContent = { part: null, document: null };

export async function loadRegions(options: {
	/** The page document being shown (its `template` choice), or null (non-Tapestry pages). */
	doc: Pick<TapestryDocument, 'template'> | null;
	/** Editors previewing or in the canvas: drafts of parts. */
	preview: boolean;
	/** Editors only: a template to show instead of the page's own choice. */
	templateOverride?: string | null;
	/** Editors only: the part being edited (shown in its region, whatever the template says). */
	editingPart?: string | null;
}): Promise<PageRegions> {
	try {
		const [templates, defaultId] = await Promise.all([listTemplates(), getDefaultTemplate()]);
		const override = options.templateOverride && TEMPLATE_ID.test(options.templateOverride) ? options.templateOverride : null;
		const template = resolveTemplate(override ? { template: override } : options.doc, templates, defaultId);
		const editing =
			options.editingPart && PART_ID.test(options.editingPart)
				? await getPart(options.editingPart, manifest, config.historyLimit)
				: null;
		const region = async (name: Region): Promise<RegionContent> => {
			if (editing?.region === name) return { part: editing.id, document: partDocument(editing, true) };
			const id = template?.[name] ?? null;
			if (!id) return EMPTY;
			const part = await getPart(id, manifest, config.historyLimit);
			return part ? { part: part.id, document: partDocument(part, options.preview) } : EMPTY;
		};
		const [header, footer] = await Promise.all([region('header'), region('footer')]);
		return {
			template: template ? { id: template.id, name: template.name } : null,
			header,
			footer,
			editingPart: editing?.id ?? null,
		};
	} catch (error) {
		console.error('[tapestry] loading template regions failed', error);
		return { template: null, header: EMPTY, footer: EMPTY, editingPart: null };
	}
}
