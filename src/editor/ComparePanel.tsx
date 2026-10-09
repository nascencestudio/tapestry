/**
 * Version comparison: an earlier published version next to the live version
 * (or the last saved draft), as a list of changes and side by side on the real
 * page (`?tapestry-version=…`, editors only, without the admin bar).
 */
import { useSignal } from '@preact/signals';
import { type PageVersion, workingDocument } from '../revisions.js';
import { diffDocuments, diffSize, type NodeRef } from './diff.js';
import type { Publishing } from './publishing.js';
import type { EditorStore } from './store.js';

interface Props {
	store: EditorStore;
	publishing: Publishing;
	/** Index of the earlier version (0 = newest). */
	index: number;
	/** The page's public path, or null if it has no slug yet. */
	pageUrl: string | null;
	onClose: () => void;
}

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'unknown date');

function versionUrl(pageUrl: string, version: PageVersion): string {
	const url = new URL(pageUrl, location.origin);
	url.searchParams.set('tapestry-version', version);
	return `${url.pathname}${url.search}`;
}

function Where({ node }: { node: NodeRef }) {
	return (
		<>
			<strong>{node.label}</strong>
			{node.path && <span class="tp-muted"> in {node.path}</span>}
		</>
	);
}

export function ComparePanel({ store, publishing, index, pageUrl, onClose }: Props) {
	const against = useSignal<'published' | 'draft'>('published');
	const page = publishing.stored.value;
	const entry = page.history[index];
	if (!entry) return null;
	const otherDoc = against.value === 'published' ? page.published : workingDocument(page);
	const otherLabel = against.value === 'published' ? 'Live version' : 'Draft (last saved)';
	const diff = otherDoc ? diffDocuments(entry.document, otherDoc, store.manifest) : null;
	const hasDraft = Boolean(page.draft);

	return (
		<section class="tp-panel tp-compare" aria-labelledby="tp-compare-heading" data-tapestry-compare>
			<div class="tp-panel__header">
				<h3 id="tp-compare-heading" class="tp-panel__title">
					Compare versions
				</h3>
				<button type="button" class="tp-button" onClick={onClose} data-tapestry-compare-close>
					Close
				</button>
			</div>
			<div class="tp-compare__choice">
				<span>
					<strong>Earlier version {index + 1}</strong>
					<span class="tp-muted"> · published {formatDate(entry.publishedAt)}</span>
				</span>
				<span aria-hidden="true">→</span>
				{/* biome-ignore lint/a11y/useSemanticElements: a button group, not form fields (inside StudioCMS's form) */}
				<span class="tp-segmented" role="group" aria-label="Compare with">
					<button
						type="button"
						class="tp-segmented__item"
						aria-pressed={against.value === 'published'}
						data-tapestry-compare-with="published"
						onClick={() => {
							against.value = 'published';
						}}
					>
						Live version
					</button>
					<button
						type="button"
						class="tp-segmented__item"
						aria-pressed={against.value === 'draft'}
						disabled={!hasDraft}
						title={hasDraft ? undefined : 'There is no saved draft'}
						data-tapestry-compare-with="draft"
						onClick={() => {
							against.value = 'draft';
						}}
					>
						Draft
					</button>
				</span>
			</div>

			{diff && (
				<div class="tp-compare__changes" data-tapestry-compare-changes={diffSize(diff)}>
					{diffSize(diff) === 0 ? (
						<p class="tp-muted">No differences: the two versions are the same.</p>
					) : (
						<ul class="tp-compare__list">
							{diff.added.map((n) => (
								<li key={`a-${n.id}`} data-change="added">
									<span class="tp-compare__tag tp-compare__tag--added">Added</span> <Where node={n} />
								</li>
							))}
							{diff.removed.map((n) => (
								<li key={`r-${n.id}`} data-change="removed">
									<span class="tp-compare__tag tp-compare__tag--removed">Removed</span> <Where node={n} />
								</li>
							))}
							{diff.moved.map((n) => (
								<li key={`m-${n.id}`} data-change="moved">
									<span class="tp-compare__tag">Moved</span> <Where node={n} />
								</li>
							))}
							{diff.changed.map((n) => (
								<li key={`c-${n.id}`} data-change="changed">
									<span class="tp-compare__tag tp-compare__tag--changed">Changed</span> <Where node={n} />
									<dl class="tp-compare__props">
										{n.props.map((p) => (
											<div key={p.prop}>
												<dt>{p.label}</dt>
												<dd>
													<del>{p.before}</del> → <ins>{p.after}</ins>
												</dd>
											</div>
										))}
									</dl>
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			{pageUrl ? (
				<div class="tp-compare__frames">
					<figure>
						<figcaption>Earlier version {index + 1}</figcaption>
						<iframe
							title={`Earlier version ${index + 1}`}
							src={versionUrl(pageUrl, `history-${index}`)}
							loading="lazy"
							data-tapestry-compare-frame="before"
						/>
					</figure>
					<figure>
						<figcaption>{otherLabel}</figcaption>
						<iframe
							key={against.value}
							title={otherLabel}
							src={versionUrl(pageUrl, against.value)}
							loading="lazy"
							data-tapestry-compare-frame="after"
						/>
					</figure>
				</div>
			) : (
				<p class="tp-muted">Give the page a slug to see the versions side by side.</p>
			)}
			<p class="tp-hint">
				Unsaved edits aren't included. Use "Restore to draft" in the version list to bring an earlier version back.
			</p>
		</section>
	);
}
