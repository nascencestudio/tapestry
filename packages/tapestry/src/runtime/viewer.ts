/// <reference types="studiocms/v/types" />
import { User } from 'studiocms:auth/lib';
import type { AstroGlobal } from 'astro';
import { Effect, runEffect } from 'studiocms/effect';
import { ANONYMOUS, hasPermission, type PermissionLevel, type Viewer } from '../access.js';

/**
 * Who is making this request, using StudioCMS's own session validation.
 *
 * StudioCMS only resolves the session for dashboard and API routes, so public
 * routes have to ask. Without a session cookie this does no database work.
 * Any failure is treated as anonymous (fail closed).
 */
export async function getViewer(context: Pick<AstroGlobal, 'cookies'>): Promise<Viewer> {
	try {
		const data = await runEffect(
			Effect.gen(function* () {
				const user = yield* User;
				return yield* user.getUserData(context as never);
			}),
		);
		if (!data?.isLoggedIn || !data.user) return ANONYMOUS;
		const level: PermissionLevel = hasPermission(data.permissionLevel, 'visitor')
			? (data.permissionLevel as PermissionLevel)
			: 'unknown';
		return {
			isLoggedIn: true,
			permissionLevel: level,
			user: { id: data.user.id, name: data.user.name, username: data.user.username },
		};
	} catch (error) {
		console.warn('[tapestry] session check failed; treating request as anonymous', error);
		return ANONYMOUS;
	}
}
