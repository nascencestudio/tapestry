/**
 * The page editor's template menu (ADR 0041): "No template" (the page's own header and footer, chosen
 * from the existing parts) or one of the templates (its header, footer and body layout; the page fills
 * its content areas). Choosing is a document edit (undo, draft): with a template, the page's
 * components move to the area with the same name, else the first area.
 */
import { assignAreas, type ContentArea } from '../templates.js';
import type { TapestryDocument } from '../types.js';
import { Popover } from './InfoPopover.js';
import { UI_ICONS } from './icons.js';
import type { EditorStore } from './store.js';

export interface TemplateCatalog {
	templates: Array<{ id: string; name: string; header: string | null; footer: string | null; areas: ContentArea[] }>;
	parts: Array<{ id: string; region: 'header' | 'footer'; name: string }>;
}

/** The document with the page's own header and footer (and no template), in key order. */
export function withOwnParts(doc: TapestryDocument, header: string | null, footer: string | null): TapestryDocument {
	return assignAreas(doc, { header, footer });
}

export function TemplateMenu({
	store,
	catalog,
	announce,
}: {
	store: EditorStore;
	catalog: TemplateCatalog;
	announce: (message: string) => void;
}) {
	const { templates, parts } = catalog;
	const doc = store.doc.value;
	// Nothing to choose yet (no templates, headers or footers): the button stays, disabled, so editors
	// know templates exist as a feature. A page still pointing at a deleted template keeps the menu.
	if (templates.length === 0 && parts.length === 0 && !doc.template) {
		return (
			<span class="tp-info">
				<button
					type="button"
					class="tp-button tp-info__button tp-info__button--text"
					disabled
					title="No templates yet. Admins create them in Template Management."
					data-tp-info="tp-template"
					data-tapestry-no-templates
				>
					{UI_ICONS.template}
					<span data-tapestry-current-template>No available templates</span>
				</button>
			</span>
		);
	}
	const current = templates.find((t) => t.id === doc.template) ?? null;
	const partName = (id: string | null) => (id ? (parts.find((p) => p.id === id)?.name ?? 'Missing part') : 'None');
	const label = current?.name ?? (doc.template ? 'Missing template' : 'No template');

	const chooseTemplate = (id: string, close: () => void) => {
		close();
		const template = templates.find((t) => t.id === id);
		if (!template || id === doc.template) return;
		store.commit(assignAreas(store.doc.peek(), { template: id, areas: template.areas }));
		announce(`Template: ${template.name}. Your content is in its areas. Save to keep it.`);
	};
	const chooseNone = (close: () => void) => {
		close();
		if (!doc.template) return;
		store.commit(withOwnParts(store.doc.peek(), null, null));
		announce('No template: the page has its own header and footer (none yet). Save to keep it.');
	};
	const setPart = (region: 'header' | 'footer', id: string) => {
		const now = store.doc.peek();
		const header = region === 'header' ? id || null : (now.header ?? null);
		const footer = region === 'footer' ? id || null : (now.footer ?? null);
		store.commit(withOwnParts(now, header, footer));
	};

	return (
		<Popover
			id="tp-template"
			label="This page’s template (layout, header and footer)"
			title="Template"
			icon={UI_ICONS.template}
			text={<span data-tapestry-current-template>{label}</span>}
		>
			{(close) => (
				<>
					<ul class="tp-templates" data-tapestry-templates>
						<li>
							<button
								type="button"
								class="tp-templates__item"
								aria-pressed={!doc.template}
								onClick={() => chooseNone(close)}
								data-tapestry-template=""
							>
								<span class="tp-templates__name">No template</span>
								<span class="tp-muted">A one-off page: its own layout, header and footer</span>
							</button>
							{!doc.template && (
								<div class="tp-templates__parts" data-tapestry-own-parts>
									{(['header', 'footer'] as const).map((region) => (
										<label class="tp-field" key={region}>
											<span class="tp-field__label">{region === 'header' ? 'Header' : 'Footer'}</span>
											<select
												class="tp-input"
												form="tapestry-detached"
												value={doc[region] ?? ''}
												onChange={(event) => setPart(region, event.currentTarget.value)}
												data-tapestry-own-part={region}
											>
												<option value="">None</option>
												{parts
													.filter((p) => p.region === region)
													.map((p) => (
														<option key={p.id} value={p.id}>
															{p.name}
														</option>
													))}
											</select>
										</label>
									))}
								</div>
							)}
						</li>
						{templates.map((template) => (
							<li key={template.id}>
								<button
									type="button"
									class="tp-templates__item"
									aria-pressed={doc.template === template.id}
									onClick={() => chooseTemplate(template.id, close)}
									data-tapestry-template={template.id}
								>
									<span class="tp-templates__name">{template.name}</span>
									<span class="tp-muted">
										Header: {partName(template.header)} · Footer: {partName(template.footer)} · Areas:{' '}
										{template.areas.map((a) => a.name).join(', ') || 'none'}
									</span>
								</button>
							</li>
						))}
					</ul>
					<p class="tp-field__help">
						Templates, headers and footers are built in Template Management. Changing them here is part of this page’s
						draft.
					</p>
				</>
			)}
		</Popover>
	);
}
