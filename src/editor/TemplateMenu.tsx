/**
 * The page editor's template menu (ADR 0041): which template this page uses (its header and footer),
 * and the others to choose from. Choosing is a document edit (undo, draft): the page's `template`
 * id changes and the canvas reloads with the new header and footer. "Site default" removes the
 * page's own choice. Shown only when the site has templates.
 */
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { TEMPLATES_ROUTE } from '../routes.js';
import type { TapestryDocument } from '../types.js';
import { Popover } from './InfoPopover.js';
import { UI_ICONS } from './icons.js';
import type { EditorStore } from './store.js';

export interface TemplateSummary {
	id: string;
	name: string;
	header: string | null;
	footer: string | null;
}

interface TemplateList {
	templates: TemplateSummary[];
	parts: Array<{ id: string; name: string }>;
	defaultTemplate: string | null;
}

/** The document with another template choice (`null`: the site default), in key order (documents are compared as strings). */
export function chooseTemplate(doc: TapestryDocument, template: string | null): TapestryDocument {
	const { version, root } = doc;
	return template ? { version, template, root } : { version, root };
}

export function TemplateMenu({ store, announce }: { store: EditorStore; announce: (message: string) => void }) {
	const list = useSignal<TemplateList | null>(null);
	const error = useSignal('');

	useEffect(() => {
		let cancelled = false;
		fetch(TEMPLATES_ROUTE, { credentials: 'same-origin' })
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as TemplateList;
			})
			.then((loaded) => {
				if (!cancelled) list.value = loaded;
			})
			.catch(() => {
				if (!cancelled) error.value = "Couldn't load the templates.";
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const templates = list.value?.templates ?? [];
	if (list.value && templates.length === 0) return null; // no templates yet: nothing to choose
	const chosen = store.doc.value.template ?? null;
	const fallback = templates.find((t) => t.id === list.value?.defaultTemplate) ?? null;
	const current = templates.find((t) => t.id === chosen) ?? null;
	const partName = (id: string | null) =>
		id ? (list.value?.parts.find((p) => p.id === id)?.name ?? 'Missing part') : 'None';
	const label = current?.name ?? (fallback ? fallback.name : 'Template');

	const choose = (template: string | null, close: () => void) => {
		close();
		if (template === chosen) return;
		store.commit(chooseTemplate(store.doc.peek(), template));
		const name = template
			? templates.find((t) => t.id === template)?.name
			: `the site default (${fallback?.name ?? 'none'})`;
		announce(`Template: ${name}. Save to keep it.`);
	};

	return (
		<Popover
			id="tp-template"
			label="This page’s template (header and footer)"
			title="Template"
			icon={UI_ICONS.template}
			text={<span data-tapestry-current-template>{label}</span>}
		>
			{(close) => (
				<>
					{error.value && (
						<p class="tp-field__error" role="alert">
							{error.value}
						</p>
					)}
					{!list.value && !error.value && <p class="tp-muted">Loading…</p>}
					{list.value && (
						<ul class="tp-templates" data-tapestry-templates>
							<li>
								<button
									type="button"
									class="tp-templates__item"
									aria-pressed={chosen === null}
									onClick={() => choose(null, close)}
									data-tapestry-template=""
								>
									<span class="tp-templates__name">Site default</span>
									<span class="tp-muted">{fallback ? fallback.name : 'No default template'}</span>
								</button>
							</li>
							{templates.map((template) => (
								<li key={template.id}>
									<button
										type="button"
										class="tp-templates__item"
										aria-pressed={chosen === template.id}
										onClick={() => choose(template.id, close)}
										data-tapestry-template={template.id}
									>
										<span class="tp-templates__name">{template.name}</span>
										<span class="tp-muted">
											Header: {partName(template.header)} · Footer: {partName(template.footer)}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
					<p class="tp-field__help">
						The header and footer come from the template and are edited in Dashboard → Plugins → Tapestry → Templates.
						Changing the template is part of this page’s draft.
					</p>
				</>
			)}
		</Popover>
	);
}
