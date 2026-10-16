/**
 * Companion panels under the settings panel (ADR 0042), like the sections of Drupal's node sidebar:
 * e.g. Menu settings from @nascencestudio/tapestry-menus. Each is a collapsible section, closed at
 * first; opening it loads the companion's module, which fills the section (and cleans up when the
 * editor goes). Only for pages (not parts or templates).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { type EditorExtension, editorExtensions, mountExtension } from './extensions.js';

export function CompanionPanels({ pageId }: { pageId: string | undefined }) {
	const panels = editorExtensions('panel');
	if (!pageId || panels.length === 0) return null;
	return (
		<>
			{panels.map((extension) => (
				<CompanionPanel key={extension.id} extension={extension} pageId={pageId} />
			))}
		</>
	);
}

function CompanionPanel({ extension, pageId }: { extension: EditorExtension; pageId: string }) {
	const host = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Mounted the first time it's opened, then kept (closing only hides it).
	useEffect(() => {
		const element = host.current;
		if (!open || !element || element.dataset.mounted !== undefined) return;
		element.dataset.mounted = '';
		let cleanup: (() => void) | null = null;
		let gone = false;
		mountExtension(extension, element, pageId)
			.then((done) => {
				if (gone) done();
				else cleanup = done;
			})
			.catch((e: Error) => {
				console.error(`[tapestry] the ${extension.label} panel failed to load`, e);
				setError(e.message);
			});
		return () => {
			gone = true;
			cleanup?.();
			delete element.dataset.mounted;
		};
	}, [open, extension, pageId]);

	return (
		<details
			class="tp-panel tp-companion"
			data-tapestry-panel={extension.id}
			onToggle={(event) => {
				if ((event.currentTarget as HTMLDetailsElement).open) setOpen(true);
			}}
		>
			<summary class="tp-panel__title tp-companion__summary" title={extension.title}>
				{extension.label}
			</summary>
			{error && <p class="tp-muted">Couldn’t load: {error}</p>}
			<div ref={host} class="tp-companion__body" />
		</details>
	);
}
