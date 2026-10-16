/**
 * `@nascencestudio/tapestry/links`: link validation for companion plugins (ADR 0042), safe to import in
 * the browser (the package's main entry is the StudioCMS plugin, server only). The same rules as link
 * props: page ids, or relative, http(s), mailto and tel addresses.
 */
export type { LinkValue } from './types.js';
export { cleanLinkValue, isSafeUrl } from './validate.js';
