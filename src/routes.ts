/** Routes the plugin injects, shared by the plugin entry (Node) and the editor (browser). */

/** Editors-only list of pages for the link picker. */
export const PAGES_ROUTE = '/_tapestry/pages';

/** Editors-only saved sections (patterns): list, fetch, save, delete. */
export const PATTERNS_ROUTE = '/_tapestry/patterns';

/** Editors-only translations of a page: list, create. */
export const TRANSLATIONS_ROUTE = '/_tapestry/translations';

/** Templates and parts (ADR 0041): list for editors; the Templates page's forms for admins. */
export const TEMPLATES_ROUTE = '/_tapestry/templates';

/** A header/footer part's content for the part editor (admins). */
export const PARTS_ROUTE = '/_tapestry/parts';
