import { useSignal } from '@preact/signals';
import { parseStoredPage, workingDocument } from '../revisions.js';
import type { ValidationIssue } from '../validate.js';
import { parseDocument } from '../validate.js';
import type { EditorStore } from './store.js';

interface Props {
	store: EditorStore;
	/** Text to start from; defaults to the current document. Used when stored content couldn't be parsed. */
	initialText?: string;
	/** True while stored content is unreadable: the visual editor stays closed until valid JSON is applied. */
	locked: boolean;
	onClose: () => void;
}

/** Raw JSON editing for power users and for repairing content the visual editor can't read. */
export function JsonView({ store, initialText, locked, onClose }: Props) {
	const text = useSignal(initialText ?? JSON.stringify(store.doc.peek(), null, 2));
	const issues = useSignal<ValidationIssue[]>([]);

	function apply() {
		// Accept a single document, or a whole stored page (format 2: published,
		// draft, history) pasted when repairing content; then use its working copy.
		const stored = /"version"\s*:\s*2/.test(text.value) ? parseStoredPage(text.value, store.manifest) : null;
		if (stored && !stored.unreadable) {
			issues.value = stored.issues;
			store.commit(workingDocument(stored.page));
			if (!stored.issues.some((i) => i.severity === 'error')) onClose();
			return;
		}
		const result = parseDocument(text.value, store.manifest);
		issues.value = result.issues;
		// Invalid JSON or an unsupported version yields an empty document; never apply that silently.
		if (result.issues.some((i) => i.path === '$' || i.path === 'version')) return;
		store.commit(result.document);
		if (result.valid) onClose();
	}

	return (
		<section class="tp-panel tp-json" aria-labelledby="tp-json-heading">
			<h3 id="tp-json-heading" class="tp-panel__title">
				Page JSON
			</h3>
			<p class="tp-muted">
				Edit the stored document directly. Applying validates it first; invalid parts are reported and left out.
			</p>
			<textarea
				class="tp-input tp-input--code"
				spellcheck={false}
				aria-label="Page JSON"
				value={text.value}
				onInput={(e) => {
					text.value = e.currentTarget.value;
				}}
			/>
			<div class="tp-json__actions">
				<button type="button" class="tp-button tp-button--primary" onClick={apply}>
					Apply JSON
				</button>
				{!locked && (
					<button type="button" class="tp-button" onClick={onClose}>
						Back to visual editor
					</button>
				)}
			</div>
			{issues.value.length > 0 && (
				<ul class="tp-issues" role="alert">
					{issues.value.map((issue) => (
						<li key={`${issue.path}:${issue.message}`} data-severity={issue.severity}>
							<strong>{issue.severity}</strong> <code>{issue.path}</code> {issue.message}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
