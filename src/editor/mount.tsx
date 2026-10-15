/**
 * Entry point for the dashboard editor. `Editor.astro` calls `mountEditor()`
 * with a host element and StudioCMS's `page-content` textarea.
 *
 * Contract with StudioCMS: the page edit form saves whatever is in
 * `textarea[name="page-content"]`. The editor writes the stored page there
 * (published version, draft, history; see publishing.ts) whenever it changes,
 * and never before the user's first edit, so merely opening a page can't
 * rewrite (or clean) its stored content.
 */

import { signal } from '@preact/signals';
import { render } from 'preact';
import { pagePath } from '../access.js';
import { lockedTypes } from '../permissions.js';
import { applyDueSchedule, DEFAULT_HISTORY_LIMIT, parseStoredPage, workingDocument } from '../revisions.js';
import { PARTS_ROUTE } from '../routes.js';
import type { Language } from '../translations.js';
import type { ComponentManifest, TapestryDocument } from '../types.js';
import { App } from './App.js';
import { configurePreviews } from './library-previews.js';
import { type PickerModule, setMediaPickerLoader } from './media.js';
import { createPublishing } from './publishing.js';
import { preloadRichText } from './richtext-loader.js';
import { type SeoEditorModule, setSeoEditorLoader } from './seo.js';
import { createEditorStore } from './store.js';

const MOUNTED = 'tapestryMounted';

export interface MountOptions {
	/** Public URL pattern (`/{slug}`) for the "View page" button and the canvas. */
	pageUrlPattern?: string;
	/** Render endpoint for the canvas. */
	renderRoute?: string;
	/** Earlier published versions kept per page. */
	historyLimit?: number;
	/** Display name of the current user, recorded on publish. */
	userName?: string;
	/** Whether the current user may publish and schedule (UI only; the server enforces it). */
	canPublish?: boolean;
	/** The lowest role that may publish, for the explanation shown to others. */
	publishRole?: string;
	/** Loads @nascencestudio/medialibrary's picker (absent when it isn't installed). */
	mediaPicker?: (() => Promise<PickerModule>) | null;
	/** The user's StudioCMS role (`editor`, `admin`, `owner`), for component permissions (UI only). */
	userLevel?: string;
	/** Translation languages (the first is the default). */
	languages?: readonly Language[];
	/** The StudioCMS page being edited. */
	pageId?: string;
	/** Library thumbnail URLs by component type (`virtual:tapestry/thumbnails`). */
	thumbnails?: Record<string, string>;
	/** Loads @nascencestudio/tapestry-seo's SEO dialog (absent when it isn't installed; ADR 0040). */
	seoEditor?: (() => Promise<SeoEditorModule>) | null;
	/**
	 * Edit a template's header or footer part instead of a page (ADR 0041): saved through the parts
	 * endpoint, shown on the canvas inside `canvasPage` (a real page's path).
	 */
	part?: { id: string; region: 'header' | 'footer'; name: string };
	/** The part editor's canvas page (e.g. `/`). */
	canvasPage?: string | null;
}

/** Mount the editor. Safe to call repeatedly; returns a cleanup function (or undefined if already mounted). */
export function mountEditor(
	host: HTMLElement,
	field: HTMLTextAreaElement,
	manifest: ComponentManifest,
	options: MountOptions = {},
) {
	if (host.dataset[MOUNTED]) return undefined;
	host.dataset[MOUNTED] = 'true';

	setMediaPickerLoader(options.mediaPicker ?? null);
	setSeoEditorLoader(options.seoEditor ?? null);
	configurePreviews({
		...(options.thumbnails ? { thumbnails: options.thumbnails } : {}),
		...(options.renderRoute ? { renderRoute: options.renderRoute } : {}),
	});
	const raw = field.value;
	const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
	const parsed = parseStoredPage(raw, manifest, historyLimit);
	// If a scheduled publish is due, the editor starts from the page as it is now live.
	const stored = applyDueSchedule(parsed.page, new Date().toISOString(), historyLimit);
	// Components the user may not change (ADR 0033); the server enforces the same rule.
	const locked = lockedTypes(manifest, options.userLevel ?? 'editor');
	let knownVersions: () => readonly TapestryDocument[] = () => [];
	const store = createEditorStore(workingDocument(stored), manifest, Date.now, {
		locked,
		knownVersions: () => knownVersions(),
	});
	const publishing = createPublishing({
		store,
		stored,
		field,
		historyLimit,
		...(options.userName ? { userName: options.userName } : {}),
	});
	knownVersions = () => {
		const page = publishing.stored.peek();
		return [
			...(page.published ? [page.published] : []),
			...(page.draft ? [page.draft] : []),
			...(page.scheduled ? [page.scheduled.document] : []),
			...page.history.map((entry) => entry.document),
		];
	};

	// The page's public URL follows StudioCMS's slug field (on the Basic Information tab).
	// The part editor shows the part inside a real page instead.
	const slugField = options.part
		? null
		: (field.form?.querySelector<HTMLInputElement>('input[name="page-slug"]') ?? null);
	const pattern = options.pageUrlPattern ?? '/{slug}';
	const pageUrl = signal<string | null>(options.part ? (options.canvasPage ?? null) : null);
	const updatePageUrl = () => {
		const slug = slugField?.value.trim();
		pageUrl.value = slug ? pagePath(pattern, slug) : null;
	};
	if (!options.part) updatePageUrl();
	slugField?.addEventListener('input', updatePageUrl);

	/** The part editor's save: the content field to the parts endpoint; adopt what was stored. */
	const savePart = async (): Promise<string | null> => {
		const part = options.part;
		if (!part) return null;
		const response = await fetch(PARTS_ROUTE, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: part.id, content: field.value }),
		});
		const body = (await response.json().catch(() => ({}))) as { content?: string; error?: string };
		if (!response.ok || typeof body.content !== 'string')
			return body.error ?? `Saving failed (HTTP ${response.status}).`;
		field.value = body.content;
		publishing.replaceStored(parseStoredPage(body.content, manifest, historyLimit).page);
		return null;
	};

	render(
		<App
			store={store}
			initialIssues={parsed.issues}
			unreadableContent={parsed.unreadable ? raw : undefined}
			publishing={publishing}
			pageUrl={pageUrl}
			renderUrl={options.renderRoute ?? '/_tapestry/render'}
			form={field.form}
			canPublish={options.canPublish ?? true}
			publishRole={options.publishRole}
			languages={options.languages}
			pageId={options.pageId}
			{...(options.part ? { part: { ...options.part, save: savePart } } : {})}
		/>,
		host,
	);

	const usesRichText = Object.values(manifest).some((entry) =>
		Object.values(entry.props ?? {}).some((def) => def.type === 'richtext'),
	);
	if (usesRichText) {
		const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 200));
		idle(() => void preloadRichText().catch(() => {}));
	}

	return () => {
		slugField?.removeEventListener('input', updatePageUrl);
		publishing.dispose();
		render(null, host);
		delete host.dataset[MOUNTED];
	};
}
