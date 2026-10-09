/**
 * The editor's translations menu (ADR 0032): this page's language, its other
 * language versions (edit or view them) and "Create" for missing ones. Each
 * translation is its own page; creating one copies this page's content as an
 * unpublished draft and opens it in the editor.
 */
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { PageStatus } from '../revisions.js';
import { TRANSLATIONS_ROUTE } from '../routes.js';
import type { Language } from '../translations.js';
import { Popover } from './InfoPopover.js';
import { UI_ICONS } from './icons.js';

interface Member {
	lang: string;
	pageId: string;
	title: string;
	path: string;
	status: PageStatus;
	/** A StudioCMS draft page (hidden from visitors whatever its content). */
	hidden: boolean;
}

interface Group {
	current: string | null;
	members: Member[];
}

const STATUS: Record<PageStatus, string> = {
	unpublished: 'Not published',
	published: 'Published',
	changed: 'Published, with unpublished changes',
};

/** The dashboard's edit URL for another page: this URL with a different `edit` parameter. */
function editUrl(pageId: string): string {
	const url = new URL(location.href);
	url.searchParams.set('edit', pageId);
	url.hash = '';
	return url.href;
}

export function TranslationsMenu({ languages, pageId }: { languages: readonly Language[]; pageId: string }) {
	const group = useSignal<Group | null>(null);
	const error = useSignal('');
	const creating = useSignal<string | null>(null);

	const load = async () => {
		error.value = '';
		try {
			const response = await fetch(`${TRANSLATIONS_ROUTE}?page=${encodeURIComponent(pageId)}`, {
				credentials: 'same-origin',
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			group.value = (await response.json()) as Group;
		} catch {
			error.value = "Couldn't load this page's translations.";
		}
	};

	const create = async (lang: string) => {
		creating.value = lang;
		error.value = '';
		try {
			const response = await fetch(TRANSLATIONS_ROUTE, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ page: pageId, lang }),
			});
			const body = (await response.json().catch(() => ({}))) as { pageId?: string; error?: string };
			// Created (or it already existed): open it.
			if ((response.ok || response.status === 409) && body.pageId) {
				location.assign(editUrl(body.pageId));
				return;
			}
			error.value = body.error ?? `Creating the translation failed (HTTP ${response.status}).`;
		} catch {
			error.value = 'Creating the translation failed (network).';
		}
		creating.value = null;
	};

	// Load right away: the button shows this page's language.
	useEffect(() => {
		void load();
	}, [pageId]);

	const current = languages.find((l) => l.code === group.value?.current) ?? languages[0];
	return (
		<Popover
			id="tp-translations"
			label="Translations of this page"
			title="Translations"
			icon={UI_ICONS.globe}
			text={<span data-tapestry-current-language>{current?.label ?? 'Translations'}</span>}
			onOpen={() => void load()}
		>
			{error.value && (
				<p class="tp-field__error" role="alert">
					{error.value}
				</p>
			)}
			{!group.value && !error.value && <p class="tp-muted">Loading…</p>}
			{group.value && (
				<ul class="tp-translations" data-tapestry-translations>
					{languages.map((language, index) => {
						const member = group.value?.members.find((m) => m.lang === language.code);
						const isCurrent = member?.pageId === pageId;
						return (
							<li key={language.code} class="tp-translations__item" data-tapestry-translation={language.code}>
								<div class="tp-translations__language">
									<span class="tp-translations__label">{language.label}</span>
									{index === 0 && <span class="tp-muted"> · original</span>}
								</div>
								{member ? (
									<div class="tp-translations__details">
										<span class="tp-translations__title">{member.title}</span>
										<span class="tp-muted tp-translations__status">
											{member.hidden ? 'Draft page' : STATUS[member.status]}
										</span>
										<span class="tp-translations__actions">
											{isCurrent ? (
												<span class="tp-muted">Editing now</span>
											) : (
												<a class="tp-link-button" href={editUrl(member.pageId)} data-tapestry-translation-edit>
													Edit
												</a>
											)}
											<a class="tp-link-button" href={member.path} target="_blank" rel="noopener">
												View ↗
											</a>
										</span>
									</div>
								) : (
									<div class="tp-translations__details">
										<span class="tp-muted">Not translated yet</span>
										<button
											type="button"
											class="tp-button"
											disabled={creating.value !== null}
											data-tapestry-translation-create={language.code}
											onClick={() => void create(language.code)}
										>
											{creating.value === language.code ? 'Creating…' : `Create ${language.label} version`}
										</button>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{group.value && (
				<p class="tp-field__help">
					A new version starts as an unpublished copy of the original, with the slug
					<code> {'<language>/<slug>'}</code>. Translate it, then publish it.
				</p>
			)}
		</Popover>
	);
}
