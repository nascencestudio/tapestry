/**
 * Draft / publish / history in the editor. The editor's document is always the
 * working copy; this module decides what gets stored (see ../revisions.ts):
 *
 * - **Save** (StudioCMS's button, ours, Ctrl/⌘+S) stores it as the draft. The
 *   live site keeps showing the published version.
 * - **Publish** makes it the published version (the old one goes to history)
 *   and saves.
 * - **Discard** and **Restore** just change the working copy (undoable), so
 *   nothing goes live until it's published.
 * - **Schedule** stores a copy of the working version to go live at a set time
 *   (applied by every reader once due; see `applyDueSchedule`), and saves.
 */
import { computed, effect, signal } from '@preact/signals';
import {
	cancelSchedule,
	type PageStatus,
	publish as publishPage,
	type StoredPage,
	sameDocument,
	saveDraft,
	schedulePublish,
	serializeStoredPage,
} from '../revisions.js';
import type { EditorStore } from './store.js';

export interface PublishingOptions {
	store: EditorStore;
	stored: StoredPage;
	/** StudioCMS's `page-content` textarea. */
	field: HTMLTextAreaElement;
	historyLimit: number;
	/** Display name of the current user, recorded on publish. */
	userName?: string;
	now?: () => string;
}

export function createPublishing({
	store,
	stored: initialStored,
	field,
	historyLimit,
	userName,
	now,
}: PublishingOptions) {
	const stored = signal(initialStored);
	const initialDoc = store.doc.peek();
	/** Whether we've written to the field yet (never on open, so viewing can't rewrite content). */
	let written = false;

	const status = computed<PageStatus>(() => {
		const published = stored.value.published;
		if (!published) return 'unpublished';
		return sameDocument(store.doc.value, published) ? 'published' : 'changed';
	});

	function write(page: StoredPage) {
		const json = serializeStoredPage(page);
		if (field.value === json) return;
		field.value = json;
		written = true;
		// Let StudioCMS (or anything else listening) know the content changed.
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('change', { bubbles: true }));
	}

	// Every edit updates the stored draft (after the first real change).
	const stopSync = effect(() => {
		const doc = store.doc.value;
		if (doc === initialDoc && !written) return;
		write(saveDraft(stored.peek(), doc));
	});

	/** Make the working copy live. Returns the new stored page; the caller submits the form. */
	function publish(): StoredPage {
		const next = publishPage(stored.peek(), {
			doc: store.doc.peek(),
			now: (now ?? (() => new Date().toISOString()))(),
			...(userName ? { by: userName } : {}),
			historyLimit,
		});
		stored.value = next;
		write(next);
		return next;
	}

	/** When the scheduled version goes live (ISO 8601), or null. */
	const scheduledAt = computed(() => stored.value.scheduled?.at ?? null);

	/** Schedule the working copy to go live at `at` (ISO 8601). Returns the new stored page; the caller submits. */
	function schedule(at: string): StoredPage {
		const doc = store.doc.peek();
		const next = schedulePublish(saveDraft(stored.peek(), doc), { doc, at, ...(userName ? { by: userName } : {}) });
		stored.value = next;
		write(next);
		return next;
	}

	/** Cancel the scheduled publish. Returns the new stored page; the caller submits. */
	function unschedule(): StoredPage {
		const next = cancelSchedule(saveDraft(stored.peek(), store.doc.peek()));
		stored.value = next;
		write(next);
		return next;
	}

	/** Replace the working copy with the published version (undoable). */
	function discard(): boolean {
		const published = stored.peek().published;
		return published ? store.commit(published) : false;
	}

	/** Load a history entry into the working copy (undoable; not live until published). */
	function restore(index: number): boolean {
		const entry = stored.peek().history[index];
		return entry ? store.commit(entry.document, { select: null }) : false;
	}

	return {
		stored,
		status,
		scheduledAt,
		publish,
		schedule,
		unschedule,
		discard,
		restore,
		historyLimit,
		dispose: () => stopSync(),
	};
}

export type Publishing = ReturnType<typeof createPublishing>;
