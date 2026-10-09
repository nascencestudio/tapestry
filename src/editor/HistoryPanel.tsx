import type { TapestryDocument } from '../types.js';
import type { Publishing } from './publishing.js';

interface Props {
	publishing: Publishing;
	announce: (message: string) => void;
	onClose: () => void;
	/** Open the comparison of an earlier version with the live one. */
	onCompare?: (index: number) => void;
}

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'unknown date');
const countNodes = (doc: TapestryDocument) => {
	let n = 0;
	const walk = (nodes: TapestryDocument['root']) => {
		for (const node of nodes) {
			n++;
			if (node.children) walk(node.children);
		}
	};
	walk(doc.root);
	return n;
};

/** The live version, earlier published versions, and actions to restore or discard. */
export function HistoryPanel({ publishing, announce, onClose, onCompare }: Props) {
	const { stored, status } = publishing;
	const page = stored.value;

	return (
		<section class="tp-panel tp-history" aria-labelledby="tp-history-heading" data-tapestry-history>
			<div class="tp-history__header">
				<h3 id="tp-history-heading" class="tp-panel__title">
					Versions
				</h3>
				<button type="button" class="tp-button" onClick={onClose}>
					Close
				</button>
			</div>

			<ol class="tp-history__list">
				<li class="tp-history__item" data-current>
					<div>
						<strong>Live version</strong>
						<span class="tp-muted">
							{page.published
								? ` · published ${formatDate(page.publishedAt)}${page.publishedBy ? ` by ${page.publishedBy}` : ''} · ${countNodes(page.published)} components`
								: ' · not published yet'}
						</span>
					</div>
					{status.value === 'changed' && (
						<button
							type="button"
							class="tp-button"
							data-tapestry-discard
							onClick={() => {
								if (publishing.discard()) announce('Unpublished changes discarded. Undo with Ctrl/⌘+Z.');
							}}
						>
							Discard unpublished changes
						</button>
					)}
				</li>
				{page.history.map((entry, index) => (
					<li class="tp-history__item" key={`${entry.publishedAt}-${index}`} data-tapestry-history-entry={index}>
						<div>
							<strong>Earlier version {index + 1}</strong>
							<span class="tp-muted">
								{` · published ${formatDate(entry.publishedAt)}${entry.publishedBy ? ` by ${entry.publishedBy}` : ''} · ${countNodes(entry.document)} components`}
							</span>
						</div>
						<span class="tp-history__actions">
							{onCompare && page.published && (
								<button type="button" class="tp-button" data-tapestry-compare={index} onClick={() => onCompare(index)}>
									Compare
								</button>
							)}
							<button
								type="button"
								class="tp-button"
								data-tapestry-restore={index}
								onClick={() => {
									if (publishing.restore(index)) {
										announce('Version restored into the draft. Publish to make it live; undo with Ctrl/⌘+Z.');
									}
								}}
							>
								Restore to draft
							</button>
						</span>
					</li>
				))}
			</ol>
			<p class="tp-hint">
				Up to {publishing.historyLimit} earlier published versions are kept. Restoring puts a version into the draft;
				the live site doesn't change until you publish.
			</p>
		</section>
	);
}
