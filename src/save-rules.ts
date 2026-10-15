/**
 * What a save of stored content may change (ADRs 0022, 0033), for pages (publish-guard.ts) and
 * template parts (ADR 0041):
 * - someone not allowed to publish keeps the live version, schedule and history as they are;
 * - components locked for the saver's role may not be added, changed or removed in the live
 *   version, the working copy or a schedule, unless that document matches a version already stored.
 * Pure.
 */
import { lockedChanges, lockedMessage, matchesSomeVersion } from './permissions.js';
import { keepPublishingState, parseStoredPage, type StoredPage, workingDocument } from './revisions.js';
import type { ComponentManifest, TapestryDocument } from './types.js';

export interface SaveRules {
	/** The saver may not publish: the incoming publishing state is replaced by the stored one. */
	keepPublishing: boolean;
	/** Component types the saver may not change. */
	locked: ReadonlySet<string>;
	manifest: ComponentManifest;
	historyLimit: number;
}

/** Every document a stored page holds (the versions locked components may come from). */
export function versionsOf(page: StoredPage): TapestryDocument[] {
	return [
		workingDocument(page),
		...(page.published ? [page.published] : []),
		...(page.scheduled ? [page.scheduled.document] : []),
		...page.history.map((entry) => entry.document),
	];
}

/** The documents a save sets: live, working copy, scheduled. */
export function documentsOf(page: StoredPage): TapestryDocument[] {
	return [
		workingDocument(page),
		...(page.published ? [page.published] : []),
		...(page.scheduled ? [page.scheduled.document] : []),
	];
}

/** The content to store (possibly with the live version kept), or why the save is refused. */
export function applySaveRules(
	incoming: string,
	current: string,
	rules: SaveRules,
): { content: string } | { error: string } {
	let content = incoming;
	if (rules.keepPublishing) {
		const merged = keepPublishingState(content, current) ?? keepPublishingState('', current);
		if (merged === null) return { error: 'Only people allowed to publish can save this content.' };
		content = merged;
	}
	if (rules.locked.size > 0) {
		const before = parseStoredPage(current, rules.manifest, rules.historyLimit).page;
		const after = parseStoredPage(content, rules.manifest, rules.historyLimit).page;
		const versions = versionsOf(before);
		for (const doc of documentsOf(after)) {
			if (matchesSomeVersion(doc, versions, rules.locked)) continue;
			const [change] = lockedChanges(workingDocument(before), doc, rules.locked);
			return {
				error: change ? lockedMessage(change, rules.manifest) : 'This content has components you can’t change.',
			};
		}
	}
	return { content };
}
