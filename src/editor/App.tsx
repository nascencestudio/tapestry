import { effect, type ReadonlySignal, useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { Language } from '../translations.js';
import type { ValidationIssue } from '../validate.js';
import { ComparePanel } from './ComparePanel.js';
import { Canvas } from './canvas/Canvas.js';
import { monitorDrops } from './dnd.js';
import { HistoryPanel } from './HistoryPanel.js';
import { UI_ICONS } from './icons.js';
import { JsonView } from './JsonView.js';
import { Layers } from './Layers.js';
import { Library } from './Library.js';
import { Modal } from './Modal.js';
import { PropsPanel } from './PropsPanel.js';
import type { Publishing } from './publishing.js';
import { formatWhen, SchedulePanel } from './SchedulePanel.js';
import type { EditorStore } from './store.js';
import { TranslationsMenu } from './TranslationsMenu.js';

export interface AppProps {
	store: EditorStore;
	/** Problems found in the stored content when the editor opened. */
	initialIssues: ValidationIssue[];
	/** Raw stored content, set only when it couldn't be parsed at all. */
	unreadableContent?: string;
	/** Public URL of the page (from its slug), for "View page" and the canvas. */
	pageUrl?: ReadonlySignal<string | null>;
	/** Editors-only endpoint that renders unsaved documents for the canvas. */
	renderUrl: string;
	/** StudioCMS's page form; Save submits it. */
	form?: HTMLFormElement | null;
	/** Draft / publish / history state and actions. */
	publishing: Publishing;
	/** Translation languages (ADR 0032); the menu shows with two or more. */
	languages?: readonly Language[];
	/** The StudioCMS page being edited (for translations). */
	pageId?: string;
	/** Whether the current user may publish and schedule (ADR 0022). Default true. */
	canPublish?: boolean;
	/** The lowest role that may publish (for the explanation). */
	publishRole?: string;
}

const STATUS_LABEL = {
	unpublished: 'Not published yet',
	published: 'Published',
	changed: 'Unpublished changes',
} as const;

function isTextEntry(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
}

/** The Tapestry editor: library, layers, visual canvas and settings, with undo/redo and a JSON view. */
export function App({
	store,
	initialIssues,
	unreadableContent,
	pageUrl,
	renderUrl,
	form,
	publishing,
	canPublish = true,
	publishRole = 'admin',
	languages,
	pageId,
}: AppProps) {
	const publishTitle = canPublish
		? undefined
		: `Only ${publishRole === 'owner' ? 'the owner' : `${publishRole}s`} can publish. Save a draft and ask them to publish it.`;
	const message = useSignal('');
	const locked = useSignal(unreadableContent !== undefined);
	const showJson = useSignal(locked.peek());
	const fullscreen = useSignal(false);
	const showHistory = useSignal(false);
	const showSchedule = useSignal(false);
	const compareIndex = useSignal<number | null>(null);
	const root = useRef<HTMLDivElement>(null);

	const announce = (text: string) => {
		// Re-set so repeated identical messages are still announced.
		message.value = '';
		requestAnimationFrame(() => {
			message.value = text;
		});
	};

	function save() {
		// StudioCMS's own submit handler does the saving and shows its toast.
		// Saving stores the draft; the live site is unchanged until Publish.
		form?.requestSubmit();
		announce('Saving draft…');
	}

	function publishNow() {
		publishing.publish();
		form?.requestSubmit();
		announce('Publishing…');
	}

	function scheduleAt(at: string) {
		publishing.schedule(at);
		form?.requestSubmit();
		showSchedule.value = false;
		announce(`Scheduled to go live on ${formatWhen(at)}. Saving…`);
	}

	function cancelSchedule() {
		publishing.unschedule();
		form?.requestSubmit();
		announce('Schedule cancelled. Saving…');
	}

	/**
	 * Editor-wide shortcuts, used for key presses in the dashboard and inside
	 * the canvas iframe. Returns true if the event was handled.
	 */
	function handleShortcut(event: KeyboardEvent): boolean {
		if (locked.peek() || !(event.metaKey || event.ctrlKey)) return false;
		const key = event.key.toLowerCase();
		if (key === 's') {
			event.preventDefault();
			save();
			return true;
		}
		if (isTextEntry(event.target)) return false; // keep native undo in text fields
		if (key === 'z' && !event.shiftKey) {
			event.preventDefault();
			if (store.undo()) announce('Undone.');
			return true;
		}
		if ((key === 'z' && event.shiftKey) || key === 'y') {
			event.preventDefault();
			if (store.redo()) announce('Redone.');
			return true;
		}
		return false;
	}

	useEffect(() => monitorDrops(store, announce), [store]);
	// A change to a component the user may not change was refused (ADR 0033): say why, for a while.
	const lockedNotice = useSignal<string | null>(null);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const stop = effect(() => {
			const blocked = store.blocked.value;
			if (!blocked) return;
			announce(blocked.message);
			lockedNotice.value = blocked.message;
			clearTimeout(timer);
			timer = setTimeout(() => {
				lockedNotice.value = null;
			}, 6000);
		});
		return () => {
			stop();
			clearTimeout(timer);
		};
	}, [store]);

	// Shortcuts listen on the document so they still work when focus falls to
	// <body> (e.g. after the focused row is deleted), but only act on events from
	// <body> or inside the editor, so other dashboard inputs are unaffected.
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			const target = event.target as Node | null;
			if (target === document.body || (target !== null && root.current?.contains(target))) handleShortcut(event);
		}
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [store]);

	// Full screen covers the dashboard; stop the page behind it from scrolling.
	useEffect(() => {
		document.documentElement.style.overflow = fullscreen.value ? 'hidden' : '';
		return () => {
			document.documentElement.style.overflow = '';
		};
	}, [fullscreen.value]);

	function onKeyDown(event: KeyboardEvent) {
		// The editor lives inside StudioCMS's page form: Enter in a single-line
		// input would submit (save) the whole page.
		if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
	}

	const { issues, valid } = store.validation.value;
	const errorCount = issues.filter((i) => i.severity === 'error').length;

	/** The purple bar above the canvas: undo and redo, then language, history and JSON. */
	const editingTools = (
		<div class="tp-actionbar" role="toolbar" aria-label="Editing tools" data-tapestry-actionbar>
			<button
				type="button"
				class="tp-icon-button"
				onClick={() => store.undo() && announce('Undone.')}
				disabled={!store.canUndo.value || locked.value}
				title="Undo (Ctrl/⌘+Z)"
				aria-label="Undo"
				data-tapestry-undo
			>
				{UI_ICONS.undo}
			</button>
			<button
				type="button"
				class="tp-icon-button"
				onClick={() => store.redo() && announce('Redone.')}
				disabled={!store.canRedo.value || locked.value}
				title="Redo (Ctrl/⌘+Shift+Z)"
				aria-label="Redo"
				data-tapestry-redo
			>
				{UI_ICONS.redo}
			</button>
			<span class="tp-actionbar__separator" aria-hidden="true" />
			{languages && languages.length > 1 && pageId && <TranslationsMenu languages={languages} pageId={pageId} />}
			<button
				type="button"
				class="tp-button"
				aria-pressed={showHistory.value}
				onClick={() => {
					showHistory.value = !showHistory.value;
				}}
				data-tapestry-history-toggle
			>
				History ({publishing.stored.value.history.length})
			</button>
			<button
				type="button"
				class="tp-button"
				aria-pressed={showJson.value}
				disabled={locked.value}
				onClick={() => {
					showJson.value = !showJson.value;
				}}
				data-tapestry-json-toggle
			>
				{'{ }'} JSON
			</button>
		</div>
	);

	/** Saving, at the right of the canvas's bottom bar: Save draft, Schedule…, Publish. */
	const saveActions = form && (
		<span class="tp-save-actions">
			<button
				type="button"
				class="tp-button"
				onClick={save}
				disabled={locked.value}
				title="Save as a draft; the live page doesn't change (Ctrl/⌘+S)"
				data-tapestry-save
			>
				Save draft
			</button>
			<button
				type="button"
				class="tp-button"
				aria-pressed={showSchedule.value}
				disabled={!canPublish || locked.value || !valid}
				onClick={() => {
					showSchedule.value = !showSchedule.value;
				}}
				title={publishTitle ?? 'Publish the current version at a date and time you choose'}
				data-tapestry-schedule-toggle
			>
				Schedule…
			</button>
			<button
				type="button"
				class="tp-button tp-button--primary"
				onClick={publishNow}
				disabled={!canPublish || locked.value || publishing.status.value === 'published' || !valid}
				title={
					publishTitle ?? (valid ? 'Make the current version live for visitors' : 'Fix the problems before publishing')
				}
				data-tapestry-publish
			>
				Publish
			</button>
		</span>
	);

	/** Full screen, next to the preview widths. */
	const fullscreenButton = (
		<button
			type="button"
			class="tp-icon-button"
			aria-pressed={fullscreen.value}
			aria-label={fullscreen.value ? 'Exit full screen' : 'Full screen'}
			title={fullscreen.value ? 'Exit full screen' : 'Full screen'}
			onClick={() => {
				fullscreen.value = !fullscreen.value;
			}}
			data-tapestry-fullscreen-toggle
		>
			{fullscreen.value ? UI_ICONS.shrink : UI_ICONS.expand}
		</button>
	);

	/** View page, next to the canvas's reload button. */
	const viewPage = pageUrl?.value ? (
		<a
			class="tp-button tp-button--small"
			href={pageUrl.value}
			target="_blank"
			rel="noopener"
			title="Open the saved page in a new tab (unsaved changes aren't shown)"
			data-tapestry-view
		>
			View page {UI_ICONS.external}
		</a>
	) : undefined;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: only suppresses implicit form submission
		<div
			class={`tp-editor${fullscreen.value ? ' tp-editor--fullscreen' : ''}`}
			ref={root}
			onKeyDown={onKeyDown}
			data-tapestry-fullscreen={fullscreen.value ? '' : undefined}
		>
			{/* Between StudioCMS's page title (h1) and the panel titles (h3), for a correct outline. */}
			<h2 class="tp-sr-only">Visual editor</h2>
			{/* Statuses only: the editing tools are in the bar above the canvas, saving in the bar below it. */}
			<div class="tp-toolbar">
				<span class="tp-toolbar__spacer" />
				<span class="tp-toolbar__statuses">
					<span class="tp-status" data-state={valid ? 'ok' : 'error'}>
						{valid ? 'Valid' : `${errorCount} problem${errorCount === 1 ? '' : 's'}`}
					</span>
					<span
						class="tp-status tp-status--publish"
						data-publish-state={publishing.status.value}
						data-tapestry-publish-status={publishing.status.value}
					>
						{STATUS_LABEL[publishing.status.value]}
					</span>
					{publishing.scheduledAt.value && (
						<span
							class="tp-status tp-status--scheduled"
							title="A version is scheduled to go live"
							data-tapestry-scheduled-status
						>
							Scheduled · {formatWhen(publishing.scheduledAt.value)}
						</span>
					)}
				</span>
			</div>

			{initialIssues.length > 0 && (
				<details class="tp-banner" open={locked.value}>
					<summary>
						{locked.value
							? 'The stored content could not be read. Fix the JSON below to continue; nothing is changed until you apply it.'
							: `The stored content had ${initialIssues.length} problem${initialIssues.length === 1 ? '' : 's'}. Invalid parts are hidden here and will be removed when you save.`}
					</summary>
					<ul class="tp-issues">
						{initialIssues.map((issue) => (
							<li key={`${issue.path}:${issue.message}`} data-severity={issue.severity}>
								<code>{issue.path}</code> {issue.message}
							</li>
						))}
					</ul>
				</details>
			)}

			{showSchedule.value && form && (
				<SchedulePanel
					publishing={publishing}
					disabled={locked.value || !valid}
					onSchedule={scheduleAt}
					onCancel={cancelSchedule}
					onClose={() => {
						showSchedule.value = false;
					}}
				/>
			)}

			{showHistory.value && compareIndex.value === null && (
				<Modal
					title="Versions"
					id="tp-history-heading"
					onClose={() => {
						showHistory.value = false;
					}}
					data={{ 'data-tapestry-history-modal': '' }}
				>
					<HistoryPanel
						publishing={publishing}
						announce={announce}
						onCompare={(index) => {
							compareIndex.value = index;
						}}
						onDone={() => {
							showHistory.value = false;
						}}
					/>
				</Modal>
			)}

			{/* Opened from History; closing it goes back to History. */}
			{compareIndex.value !== null && (
				<Modal
					title="Compare versions"
					id="tp-compare-heading"
					size="large"
					onClose={() => {
						compareIndex.value = null;
					}}
					data={{ 'data-tapestry-compare-modal': '' }}
				>
					<ComparePanel
						store={store}
						publishing={publishing}
						index={compareIndex.value}
						pageUrl={pageUrl?.value ?? null}
					/>
				</Modal>
			)}

			{showJson.value && (
				<Modal
					title="Page JSON"
					id="tp-json-heading"
					size="large"
					dismissable={!locked.value}
					onClose={() => {
						showJson.value = false;
					}}
					data={{ 'data-tapestry-json-modal': '' }}
				>
					<JsonView
						store={store}
						initialText={locked.value ? unreadableContent : undefined}
						locked={locked.value}
						onClose={() => {
							locked.value = false;
							showJson.value = false;
						}}
					/>
				</Modal>
			)}

			<div class="tp-workspace">
				<div class="tp-grid">
					<div class="tp-side">
						<Library store={store} announce={announce} />
						<Layers store={store} announce={announce} />
					</div>
					<Canvas
						store={store}
						pageUrl={pageUrl}
						renderUrl={renderUrl}
						announce={announce}
						onKeyDown={handleShortcut}
						toolbar={editingTools}
						afterViewports={fullscreenButton}
						afterReload={viewPage}
						footerEnd={saveActions || undefined}
					/>
					<PropsPanel store={store} />
				</div>
			</div>

			{lockedNotice.value && (
				<p class="tp-locked-notice" data-tapestry-locked-notice>
					{UI_ICONS.lock} {lockedNotice.value}
				</p>
			)}
			<div class="tp-sr-only" aria-live="polite" aria-atomic="true">
				{message.value}
			</div>
		</div>
	);
}
