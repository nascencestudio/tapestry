/**
 * Pure rules for who may see what on the public site. No StudioCMS imports, so
 * they can be unit-tested; `runtime/page.ts` applies them to real requests.
 */

import type { ResolvedLink } from './types.js';

/** StudioCMS permission levels, lowest to highest. */
export type PermissionLevel = 'unknown' | 'visitor' | 'editor' | 'admin' | 'owner';

const RANK: Record<PermissionLevel, number> = { unknown: 0, visitor: 1, editor: 2, admin: 3, owner: 4 };

/** Who is looking at a page. `null` user means an anonymous visitor. */
export interface Viewer {
	isLoggedIn: boolean;
	permissionLevel: PermissionLevel;
	user: { id: string; name: string; username: string } | null;
}

export const ANONYMOUS: Viewer = { isLoggedIn: false, permissionLevel: 'unknown', user: null };

/** True if `level` is at least `required`. Unknown levels never pass. */
export function hasPermission(level: string, required: PermissionLevel): boolean {
	const rank = Object.hasOwn(RANK, level) ? RANK[level as PermissionLevel] : 0;
	return rank > 0 && rank >= RANK[required];
}

/** Editors and above can see drafts and the admin bar. */
export function isEditor(viewer: Viewer | null | undefined): boolean {
	return Boolean(viewer?.isLoggedIn && hasPermission(viewer.permissionLevel, 'editor'));
}

export interface PageAccess {
	/** Whether to render the page at all (false → respond 404). */
	visible: boolean;
	/** Response headers to set when the page is rendered. */
	headers: Record<string, string>;
}

/**
 * Decide whether a page may be shown to a viewer, and with which headers.
 *
 * - Drafts are visible only to editors (anyone else gets a 404, so a draft's
 *   existence isn't revealed).
 * - Any response rendered for an editor is `private, no-store`: it contains the
 *   admin bar (and possibly draft content) and must never land in a shared cache.
 * - Drafts are always `noindex`.
 */
export function pageAccess(page: { draft?: boolean | null }, viewer: Viewer | null | undefined): PageAccess {
	const editor = isEditor(viewer);
	const draft = page.draft === true;
	if (draft && !editor) return { visible: false, headers: {} };
	const headers: Record<string, string> = {};
	if (editor) headers['Cache-Control'] = 'private, no-store';
	if (draft) headers['X-Robots-Tag'] = 'noindex, nofollow';
	return { visible: true, headers };
}

/**
 * Public URL path of a page from a pattern such as `/{slug}` or `/blog/{slug}`.
 * The `index` slug maps to the pattern's base (`/` or `/blog/`).
 */
export function pagePath(pattern: string, slug: string): string {
	if (slug === 'index') return pattern.replace(/\{slug\}\/?$/, '') || '/';
	return pattern.replace('{slug}', slug.split('/').map(encodeURIComponent).join('/'));
}

/** True for addresses that leave the site: another host, mailto: or tel:. */
export function isExternal(url: string, siteHost: string): boolean {
	if (/^(mailto|tel):/i.test(url)) return true;
	const absolute = /^(?:https?:)?\/\/([^/?#]+)/i.exec(url);
	return Boolean(absolute && absolute[1]?.toLowerCase() !== siteHost.toLowerCase());
}

/** What a component receives for a link prop (`rel` protects new-tab links). */
export function resolvedLink(
	href: string,
	value: { newTab?: true },
	external: boolean,
	title: string | null,
): ResolvedLink {
	const newTab = value.newTab === true;
	return { href, external, newTab, rel: newTab ? 'noopener noreferrer' : undefined, title };
}
