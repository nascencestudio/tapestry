/**
 * The settings field for `link` props: a page on this site (picked from a
 * list, stored by id) or a web address, plus "open in a new tab".
 */
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { PAGES_ROUTE } from '../routes.js';
import type { LinkValue, PropValue } from '../types.js';
import { LIMITS } from '../validate.js';

interface LinkablePage {
	id: string;
	title: string;
	path: string;
	draft: boolean;
}

/** The site's pages, loaded once per editor session (null until loaded). */
const pages = signal<LinkablePage[] | null>(null);
/** True when loading failed (the field offers to try again; failures aren't cached). */
const loadFailed = signal(false);
let loading: Promise<void> | null = null;

function loadPages(): Promise<void> {
	loading ??= fetch(PAGES_ROUTE, { credentials: 'same-origin' })
		.then(async (response) => {
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const body = (await response.json()) as { pages?: LinkablePage[] };
			pages.value = Array.isArray(body.pages) ? body.pages : [];
			loadFailed.value = false;
		})
		.catch(() => {
			loading = null;
			loadFailed.value = true;
		});
	return loading;
}

interface Props {
	id: string;
	value: PropValue | undefined;
	onChange: (value: LinkValue | undefined) => void;
	describedBy: string | undefined;
	invalid: boolean;
}

const asLink = (value: PropValue | undefined): LinkValue | null =>
	value && typeof value === 'object' && !Array.isArray(value) && (value.type === 'page' || value.type === 'url')
		? (value as LinkValue)
		: null;

export function LinkField({ id, value, onChange, describedBy, invalid }: Props) {
	const link = asLink(value);
	const [mode, setMode] = useState<'page' | 'url'>(link?.type ?? 'page');
	const [filter, setFilter] = useState('');
	// Follow the stored link's type when it changes from outside (undo, another edit), but not on
	// mount: a passive effect there ran after paint and could undo a click on the mode buttons.
	const storedType = useRef(link?.type);
	useLayoutEffect(() => {
		if (link && link.type !== storedType.current) setMode(link.type);
		storedType.current = link?.type;
	}, [link?.type]);
	useEffect(() => {
		void loadPages();
	}, []);

	const newTab = link?.newTab === true;
	const withTab = (next: LinkValue): LinkValue => (newTab ? { ...next, newTab: true } : next);
	const list = pages.value ?? [];
	const shown = filter.trim()
		? list.filter((p) => `${p.title} ${p.path}`.toLowerCase().includes(filter.trim().toLowerCase()))
		: list;
	const selectedPage = link?.type === 'page' ? list.find((p) => p.id === link.page) : undefined;
	const a11y = { 'aria-describedby': describedBy, 'aria-invalid': invalid || undefined };

	return (
		<div class="tp-link-field" data-tapestry-link-field={id}>
			{/* biome-ignore lint/a11y/useSemanticElements: a button group, not form fields (inside StudioCMS's form) */}
			<div class="tp-segmented" role="group" aria-label="Link to">
				<button
					type="button"
					class="tp-segmented__item"
					aria-pressed={mode === 'page'}
					data-tapestry-link-mode="page"
					onClick={() => setMode('page')}
				>
					Page on this site
				</button>
				<button
					type="button"
					class="tp-segmented__item"
					aria-pressed={mode === 'url'}
					data-tapestry-link-mode="url"
					onClick={() => setMode('url')}
				>
					Web address
				</button>
			</div>
			{mode === 'page' ? (
				<>
					{list.length > 8 && (
						<input
							class="tp-input"
							type="search"
							placeholder="Find a page"
							aria-label="Find a page"
							value={filter}
							onInput={(e) => setFilter(e.currentTarget.value)}
							onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
						/>
					)}
					<select
						id={id}
						{...a11y}
						class="tp-input"
						value={link?.type === 'page' ? link.page : ''}
						data-tapestry-link-page
						onChange={(e) => {
							const page = e.currentTarget.value;
							onChange(page ? withTab({ type: 'page', page }) : undefined);
						}}
					>
						<option value="">
							{pages.value !== null ? '— Choose a page —' : loadFailed.value ? 'Pages unavailable' : 'Loading pages…'}
						</option>
						{link?.type === 'page' && !selectedPage && pages.value !== null && (
							<option value={link.page}>(page not found)</option>
						)}
						{shown.map((p) => (
							<option key={p.id} value={p.id}>
								{p.title} ({p.path}){p.draft ? ' · draft' : ''}
							</option>
						))}
					</select>
					{loadFailed.value && pages.value === null && (
						<p class="tp-field__error">
							Couldn't load the site's pages.{' '}
							<button type="button" class="tp-link-button" data-tapestry-link-retry onClick={() => void loadPages()}>
								Try again
							</button>
						</p>
					)}
				</>
			) : (
				// type="text" rather than "url": the browser's URL check rejects relative URLs.
				<input
					id={id}
					{...a11y}
					class="tp-input"
					type="text"
					inputMode="url"
					spellcheck={false}
					maxLength={LIMITS.urlMaxLength}
					placeholder="/page, https://…, mailto:…"
					value={link?.type === 'url' ? link.url : ''}
					data-tapestry-link-url
					onInput={(e) => {
						const url = e.currentTarget.value;
						onChange(url ? withTab({ type: 'url', url }) : undefined);
					}}
				/>
			)}
			<label class="tp-link-field__tab">
				<input
					type="checkbox"
					checked={newTab}
					disabled={!link}
					data-tapestry-link-newtab
					onChange={(e) => {
						if (!link) return;
						const { newTab: _old, ...rest } = link;
						onChange(e.currentTarget.checked ? ({ ...rest, newTab: true } as LinkValue) : (rest as LinkValue));
					}}
				/>
				Open in a new tab
			</label>
		</div>
	);
}
