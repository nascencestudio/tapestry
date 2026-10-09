/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * Turns stored `link` prop values into what components receive
 * (`ResolvedLink`): page links get the page's current path (by id, so slug
 * changes don't break them; missing pages, and draft pages for visitors, give
 * null), web addresses pass through. Server only.
 */

import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:tapestry/config';
import type { AstroGlobal } from 'astro';
import { isEditor, isExternal, pagePath, resolvedLink } from '../access.js';
import type { LinkValue, ResolvedLink } from '../types.js';
import { getViewer } from './viewer.js';

/**
 * Resolve links (deduplicating page lookups). Values that aren't links resolve to null.
 * `canSeeDrafts` is only asked when a linked page is a draft: a draft's path and title
 * must not reach visitors. `localize` (translated sites) swaps a linked page for its version
 * in the current page's language, when there's one the viewer may see.
 */
export async function resolveLinks(
	values: unknown[],
	siteHost: string,
	canSeeDrafts: () => Promise<boolean>,
	localize: ((pageId: string) => Promise<string>) | null = null,
): Promise<Array<ResolvedLink | null>> {
	if (localize) {
		values = await Promise.all(
			values.map(async (v) => {
				if (!v || typeof v !== 'object' || (v as LinkValue).type !== 'page') return v;
				const link = v as Extract<LinkValue, { type: 'page' }>;
				const page = await localize(link.page).catch(() => link.page);
				return page === link.page ? link : { ...link, page };
			}),
		);
	}
	const pageIds = [
		...new Set(
			values.flatMap((v) =>
				v && typeof v === 'object' && (v as LinkValue).type === 'page' ? [(v as { page: string }).page] : [],
			),
		),
	];
	const pages = new Map<string, { slug: string; title: string; draft: boolean } | null>();
	await Promise.all(
		pageIds.map(async (id) => {
			try {
				const page = await runSDK(SDKCoreJs.GET.page.byId(id, true));
				pages.set(
					id,
					page ? { slug: String(page.slug), title: String(page.title ?? ''), draft: Boolean(page.draft) } : null,
				);
			} catch {
				pages.set(id, null);
			}
		}),
	);
	if ([...pages.values()].some((page) => page?.draft) && !(await canSeeDrafts())) {
		for (const [id, page] of pages) if (page?.draft) pages.set(id, null);
	}
	return values.map((value) => {
		if (!value || typeof value !== 'object') return null;
		const link = value as LinkValue;
		if (link.type === 'page') {
			const page = pages.get(link.page);
			return page ? resolvedLink(pagePath(config.pageUrlPattern, page.slug), link, false, page.title) : null;
		}
		if (link.type === 'url' && typeof link.url === 'string') {
			return resolvedLink(link.url, link, isExternal(link.url, siteHost), null);
		}
		return null;
	});
}

const draftAccess = new WeakMap<object, Promise<boolean>>();

/** Whether this request's viewer may see draft pages (checked once per request). */
export function draftAccessFor(context: Pick<AstroGlobal, 'cookies' | 'locals'>): () => Promise<boolean> {
	return () => {
		let access = draftAccess.get(context.locals);
		if (!access) {
			access = getViewer(context).then(isEditor, () => false);
			draftAccess.set(context.locals, access);
		}
		return access;
	};
}
