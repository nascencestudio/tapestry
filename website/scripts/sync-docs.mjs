// Builds the documentation site's pages from the repository's Markdown (docs/ and the
// README), so docs/ stays the single source of truth (ADR 0036). Writes into
// src/content/docs/<section>/ (generated, gitignored); the landing page (index.mdx) is the
// site's own.
//
// For each source file: the first `# Heading` becomes the page title (frontmatter), and
// relative links are rewritten: to another published page → its site URL (with the base
// path); to any other repository file → GitHub (`REPO_URL`, e.g. https://github.com/org/repo),
// or plain text when that isn't set.
//
// Env: DOCS_BASE (e.g. /tapestry for GitHub Pages project sites; default /), REPO_URL,
// REPO_BRANCH (default main).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(site, '..');
const out = join(site, 'src/content/docs');
const base = `/${(process.env.DOCS_BASE ?? '').replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '');
const repoUrl = process.env.REPO_URL?.replace(/\/+$/, '') ?? '';
const branch = process.env.REPO_BRANCH ?? 'main';

/** Source file (repo-relative) → page slug, by section. Order = sidebar order. */
const pages = [
	['README.md', 'start/install', 'Install and set up'],
	['docs/guides/defining-components.md', 'guides/defining-components'],
	['docs/admin-bar.md', 'guides/site-integration', 'Site integration: getPage(), admin bar, translations'],
	['docs/guides/development.md', 'guides/development', 'Contributing and development'],
	['docs/data-model.md', 'reference/data-model'],
	['docs/architecture.md', 'reference/architecture'],
	['docs/security.md', 'reference/security'],
	['docs/known-issues.md', 'project/known-issues'],
	['docs/roadmap.md', 'project/roadmap'],
	...readdirSync(join(repo, 'docs/decisions'))
		.filter((name) => /^\d{4}-.+\.md$/.test(name))
		.sort()
		.map((name) => [`docs/decisions/${name}`, `decisions/${name.replace(/\.md$/, '')}`]),
];
const slugOf = new Map(pages.map(([source, slug]) => [source, slug]));

/** Rewrite one link target found in `source` (repo-relative). */
function rewrite(target, source) {
	if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return target; // absolute, anchor, root-relative
	const [path, hash = ''] = target.split('#');
	const repoPath = relative(repo, resolve(repo, dirname(source), decodeURI(path)));
	const slug = slugOf.get(repoPath);
	if (slug) return `${base}/${slug}/${hash ? `#${hash}` : ''}`;
	if (repoUrl && !repoPath.startsWith('..')) return `${repoUrl}/blob/${branch}/${repoPath}${hash ? `#${hash}` : ''}`;
	return null;
}

function convert(source, slug, title, order) {
	let text = readFileSync(join(repo, source), 'utf8');
	const heading = /^# (.+)\n+/m.exec(text);
	if (heading) text = text.replace(heading[0], '');
	const pageTitle = title ?? heading?.[1].trim() ?? slug;
	// Links outside code: [text](target). Fenced and inline code are left as they are.
	const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
	text = parts
		.map((part, i) =>
			i % 2 === 1
				? part
				: part.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (all, bang, label, target) => {
						if (bang) return all;
						const next = rewrite(target, source);
						return next === null ? label : `[${label}](${next})`;
					}),
		)
		.join('');
	const note = `\n\n---\n\n<small>Source: \`${source}\`${repoUrl ? ` ([view on GitHub](${repoUrl}/blob/${branch}/${source}))` : ''}</small>\n`;
	return `---\ntitle: ${JSON.stringify(pageTitle)}\nsidebar:\n  order: ${order}\n---\n\n${text.trim()}${note}`;
}

for (const dir of ['start', 'guides', 'reference', 'project', 'decisions'])
	rmSync(join(out, dir), { recursive: true, force: true });
pages.forEach(([source, slug, title], index) => {
	const file = join(out, `${slug}.md`);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, convert(source, slug, title, index + 1));
});
console.log(`docs: ${pages.length} pages synced (base ${base || '/'}${repoUrl ? `, links to ${repoUrl}` : ''})`);
