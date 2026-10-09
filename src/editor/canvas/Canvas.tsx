import { type ReadonlySignal, useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { CANVAS_PARAM } from '../../runtime/canvas-mode.js';
import { InfoPopover, type Shortcut, ShortcutList, shortcutText } from '../InfoPopover.js';
import { UI_ICONS } from '../icons.js';
import type { EditorStore } from '../store.js';
import { type CanvasController, type CanvasState, createCanvasController } from './controller.js';

export const VIEWPORTS = {
	desktop: { label: 'Desktop', width: '100%' },
	tablet: { label: 'Tablet', width: '768px' },
	mobile: { label: 'Mobile', width: '390px' },
} as const;

export type Viewport = keyof typeof VIEWPORTS;

interface Props {
	store: EditorStore;
	/** Public URL of the page; the canvas loads it in canvas mode. */
	pageUrl: ReadonlySignal<string | null> | undefined;
	renderUrl: string;
	announce: (message: string) => void;
	onKeyDown: (event: KeyboardEvent) => boolean;
	/** The editor's tool bar, above the canvas bar. */
	toolbar?: ComponentChildren;
	/** After the preview widths (full screen). */
	afterViewports?: ComponentChildren;
	/** After the reload button (View page). */
	afterReload?: ComponentChildren;
	/** The bottom bar's right end (saving and publishing). */
	footerEnd?: ComponentChildren;
}

function canvasUrl(pageUrl: string): string {
	const url = new URL(pageUrl, window.location.origin);
	url.searchParams.set(CANVAS_PARAM, '');
	return `${url.pathname}${url.search}`;
}

/** The visual canvas: the real page in an iframe, kept in sync with the editor. */
/** Keyboard shortcuts of the canvas (shown in its info popover). */
const CANVAS_SHORTCUTS: readonly Shortcut[] = [
	{ keys: 'Tab', action: 'into the canvas' },
	{ keys: '↑ / ↓', action: 'select' },
	{ keys: '←', action: 'select the parent' },
	{ keys: '→', action: 'select inside' },
	{ keys: 'Enter', action: 'edit text' },
	{ keys: 'Alt+arrows', action: 'move' },
	{ keys: 'Delete', action: 'remove' },
	{ keys: 'Ctrl/⌘+D', action: 'duplicate' },
	{ keys: 'Ctrl/⌘+C / X / V', action: 'copy, cut, paste' },
	{ keys: 'Esc', action: 'deselect' },
];

export function Canvas({
	store,
	pageUrl,
	renderUrl,
	announce,
	onKeyDown,
	toolbar,
	afterViewports,
	afterReload,
	footerEnd,
}: Props) {
	const viewport = useSignal<Viewport>('desktop');
	const status = useSignal<{ state: CanvasState; message?: string }>({ state: 'loading' });
	const iframe = useRef<HTMLIFrameElement>(null);
	const controller = useRef<CanvasController | null>(null);
	const url = pageUrl?.value ? canvasUrl(pageUrl.value) : null;

	useEffect(() => {
		const element = iframe.current;
		if (!element || !url) return;
		const instance = createCanvasController({
			iframe: element,
			store,
			renderUrl,
			announce,
			onKeyDown,
			onStatus: (state, message) => {
				status.value = { state, message };
			},
		});
		controller.current = instance;
		return () => {
			instance.dispose();
			controller.current = null;
		};
	}, [url, store, renderUrl]);

	return (
		<section class="tp-panel tp-canvas" aria-labelledby="tp-canvas-heading">
			{toolbar}
			<div class="tp-canvas__bar">
				<h3 id="tp-canvas-heading" class="tp-panel__title">
					Canvas
				</h3>
				{/* biome-ignore lint/a11y/useSemanticElements: a button group, not form fields (a fieldset inside the StudioCMS form would mislead) */}
				<div class="tp-segmented" role="group" aria-label="Preview width">
					{(Object.keys(VIEWPORTS) as Viewport[]).map((key) => (
						<button
							key={key}
							type="button"
							class="tp-segmented__item"
							aria-pressed={viewport.value === key}
							data-tapestry-viewport={key}
							onClick={() => {
								viewport.value = key;
							}}
						>
							{VIEWPORTS[key].label}
						</button>
					))}
				</div>
				{afterViewports}
				<span class="tp-canvas__status" data-state={status.value.state} aria-live="polite">
					{status.value.state === 'loading' ? 'Loading…' : status.value.state === 'ready' ? '' : status.value.message}
				</span>
				{url && (
					<button
						type="button"
						class="tp-icon-button"
						title="Reload canvas"
						aria-label="Reload canvas"
						onClick={() => {
							status.value = { state: 'loading' };
							iframe.current?.contentWindow?.location.reload();
						}}
					>
						{UI_ICONS.reload}
					</button>
				)}
				{afterReload}
			</div>
			<div class="tp-canvas__stage">
				{url ? (
					<iframe
						ref={iframe}
						src={url}
						title="Page canvas: the page as visitors will see it. Arrow keys select components, Enter edits text."
						aria-describedby="tp-canvas-keys"
						class="tp-canvas__frame"
						style={{ width: VIEWPORTS[viewport.value].width }}
						data-tapestry-canvas
					/>
				) : (
					<p class="tp-muted tp-canvas__empty">Give the page a slug (Basic Information tab) to see the canvas.</p>
				)}
			</div>
			{(url || footerEnd) && (
				// The bottom bar: keyboard help on the left, saving and publishing on the right.
				<div class="tp-canvas__footer" role="toolbar" aria-label="Canvas help and saving">
					{url && (
						<>
							<InfoPopover
								id="tp-canvas-help"
								label="Keyboard shortcuts for the canvas"
								title="Canvas keys"
								placement="above"
							>
								<ShortcutList shortcuts={CANVAS_SHORTCUTS} />
							</InfoPopover>
							<p id="tp-canvas-keys" class="tp-sr-only">
								{shortcutText(CANVAS_SHORTCUTS)}
							</p>
						</>
					)}
					<span class="tp-toolbar__spacer" />
					{footerEnd}
				</div>
			)}
		</section>
	);
}
