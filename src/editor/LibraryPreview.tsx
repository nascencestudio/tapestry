/**
 * The popover next to a hovered (or focused) library item: the component
 * rendered with its starting values, scaled down. Decorative (the item's
 * label and description say what it is), so it's hidden from assistive tech.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ComponentManifest } from '../types.js';
import { previewDocument, previewMarkup, siteStyles, thumbnails } from './library-previews.js';

/** The frame renders the component at this width, then scales it down. */
const FRAME_WIDTH = 960;
const SCALE = 0.3;
const MAX_HEIGHT = 260;

export function LibraryPreview({
	manifest,
	type,
	anchor,
}: {
	manifest: ComponentManifest;
	type: string;
	anchor: DOMRect;
}) {
	const [markup, setMarkup] = useState<string | null | undefined>(undefined);
	const [height, setHeight] = useState(0);
	useEffect(() => {
		let alive = true;
		setMarkup(undefined);
		setHeight(0);
		previewMarkup(manifest, type).then((result) => alive && setMarkup(result));
		return () => {
			alive = false;
		};
	}, [manifest, type]);

	const width = FRAME_WIDTH * SCALE;
	// To the right of the item, or to its left when there's no room.
	const left =
		anchor.right + 8 + width + 16 <= window.innerWidth ? anchor.right + 8 : Math.max(8, anchor.left - width - 24);
	const top = Math.max(8, Math.min(anchor.top, window.innerHeight - MAX_HEIGHT - 48));
	const label = manifest[type]?.label ?? type;
	const box = { left: `${left}px`, top: `${top}px`, width: `${width + 16}px` };
	// The developer's picture says more than, say, an empty layout rendered live.
	const thumbnail = thumbnails.value[type];
	if (thumbnail) {
		return (
			<div class="tp-preview" style={box} aria-hidden="true" data-tapestry-preview={type}>
				<div class="tp-preview__label">{label}</div>
				<img class="tp-preview__thumbnail" src={thumbnail} alt="" />
			</div>
		);
	}
	const styles = siteStyles();
	if (markup === null || !styles) return null;
	return (
		<div class="tp-preview" style={box} aria-hidden="true" data-tapestry-preview={type}>
			<div class="tp-preview__label">{label}</div>
			{markup === undefined ? (
				<div class="tp-preview__loading">Loading preview…</div>
			) : (
				<div class="tp-preview__viewport" style={{ height: `${Math.min(MAX_HEIGHT, height * SCALE || 80)}px` }}>
					<iframe
						// No scripts; same origin only so the frame's height can be measured.
						sandbox="allow-same-origin"
						srcdoc={previewDocument(markup, styles)}
						title={`Preview of ${manifest[type]?.label ?? type}`}
						tabIndex={-1}
						style={{ width: `${FRAME_WIDTH}px`, height: `${Math.max(height, 1)}px`, transform: `scale(${SCALE})` }}
						onLoad={(event) => {
							const body = event.currentTarget.contentDocument?.body;
							if (body) setHeight(Math.ceil(body.scrollHeight));
						}}
					/>
				</div>
			)}
		</div>
	);
}
