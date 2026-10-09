import { describe, expect, it } from 'vitest';
import { ANONYMOUS, hasPermission, isEditor, pageAccess, pagePath, type Viewer } from '../src/access.js';

const viewer = (permissionLevel: Viewer['permissionLevel'], isLoggedIn = true): Viewer => ({
	isLoggedIn,
	permissionLevel,
	user: { id: 'u1', name: 'U', username: 'u' },
});

describe('hasPermission / isEditor', () => {
	it('ranks levels', () => {
		expect(hasPermission('owner', 'editor')).toBe(true);
		expect(hasPermission('editor', 'editor')).toBe(true);
		expect(hasPermission('visitor', 'editor')).toBe(false);
		expect(hasPermission('unknown', 'visitor')).toBe(false);
	});

	it('rejects made-up and inherited level names', () => {
		expect(hasPermission('superuser', 'visitor')).toBe(false);
		expect(hasPermission('constructor', 'visitor')).toBe(false);
	});

	it('requires a logged-in editor', () => {
		expect(isEditor(viewer('admin'))).toBe(true);
		expect(isEditor(viewer('visitor'))).toBe(false);
		expect(isEditor(viewer('owner', false))).toBe(false);
		expect(isEditor(ANONYMOUS)).toBe(false);
		expect(isEditor(null)).toBe(false);
	});
});

describe('pageAccess', () => {
	it('hides drafts from anyone but editors', () => {
		expect(pageAccess({ draft: true }, ANONYMOUS).visible).toBe(false);
		expect(pageAccess({ draft: true }, viewer('visitor')).visible).toBe(false);
		expect(pageAccess({ draft: true }, viewer('editor'))).toEqual({
			visible: true,
			headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
		});
	});

	it('serves published pages to everyone, privately for editors', () => {
		expect(pageAccess({ draft: false }, ANONYMOUS)).toEqual({ visible: true, headers: {} });
		expect(pageAccess({ draft: null }, ANONYMOUS)).toEqual({ visible: true, headers: {} });
		expect(pageAccess({ draft: false }, viewer('owner')).headers).toEqual({ 'Cache-Control': 'private, no-store' });
	});
});

describe('pagePath', () => {
	it.each([
		['/{slug}', 'about', '/about'],
		['/{slug}', 'index', '/'],
		['/blog/{slug}', 'index', '/blog/'],
		['/blog/{slug}', 'hello-world', '/blog/hello-world'],
		['/{slug}', 'docs/getting started', '/docs/getting%20started'],
	])('%s with %s → %s', (pattern, slug, expected) => {
		expect(pagePath(pattern, slug)).toBe(expected);
	});
});
