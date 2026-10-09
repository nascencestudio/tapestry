// Seeds (or resets) a demo Tapestry page as the site's home page ("index").
//
// Writes straight to the local libSQL database so the playground has content
// without clicking through the dashboard. Development only: it refuses to run
// against anything except a local file database.
//
// Note: a running dev server caches pages (StudioCMS SDK cache, 5 minutes by
// default), so changes may not show until the cache expires or the server
// restarts. The e2e test resets content through the editor instead.
//
// Usage: pnpm --filter playground seed
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { demoDocument } from './demo-document.mjs';

process.loadEnvFile?.('.env');
const url = process.env.CMS_LIBSQL_URL ?? '';
if (!url.startsWith('file:')) {
	console.error(`Refusing to seed: CMS_LIBSQL_URL must be a local file: database (got "${url}").`);
	process.exit(1);
}

const SLUG = 'index';

const db = createClient({ url });
const author = await db.execute('select id from StudioCMSUsersTable limit 1');
const authorId = author.rows[0]?.id;
if (!authorId) {
	console.error('No users found. Complete first-time setup at /start first.');
	process.exit(1);
}

const now = new Date().toISOString();
const content = JSON.stringify(demoDocument);
const existing = await db.execute({ sql: 'select id from StudioCMSPageData where slug = ?', args: [SLUG] });
const pageId = existing.rows[0]?.id ?? randomUUID();

// Update in place when the page exists, so StudioCMS's revision history
// (StudioCMSDiffTracking references the page id) is preserved.
await db.batch(
	existing.rows.length > 0
		? [
				{
					sql: `update StudioCMSPageData set package = 'tapestry/canvas', title = 'Home',
						description = 'Tapestry demo page', updatedAt = ?, draft = 0 where id = ?`,
					args: [now, pageId],
				},
				{ sql: 'update StudioCMSPageContent set content = ? where contentId = ?', args: [content, pageId] },
			]
		: [
				{
					sql: `insert into StudioCMSPageData
						(id, package, title, description, showOnNav, publishedAt, updatedAt, slug, contentLang, authorId, draft)
						values (?, 'tapestry/canvas', 'Home', 'Tapestry demo page', 1, ?, ?, ?, 'default', ?, 0)`,
					args: [pageId, now, now, SLUG, authorId],
				},
				{
					sql: `insert into StudioCMSPageContent (id, contentId, contentLang, content) values (?, ?, 'default', ?)`,
					args: [randomUUID(), pageId, content],
				},
			],
	'write',
);

console.log(`Seeded Tapestry page "${SLUG}" (${pageId}). Visit http://localhost:4321/`);
