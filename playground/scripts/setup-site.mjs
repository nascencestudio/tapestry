// Non-interactive StudioCMS first-time setup (the /start wizard's two steps),
// for CI and fresh local databases. The server must run with CMS_SETUP=1
// (studiocms.config.mjs turns the setup routes on only then) and a migrated,
// empty database.
//
// Creates the site and an owner account, then writes the login to
// .dev-credentials (gitignored, mode 600) for the e2e suites.
//
//   CMS_SETUP=1 pnpm dev && node scripts/setup-site.mjs
//
// SETUP_USERNAME / SETUP_PASSWORD override the account (default: tapestry-dev
// and a random password). BASE_URL defaults to http://localhost:4321.
// CREDENTIALS_FILE changes where the login is written.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const username = process.env.SETUP_USERNAME || 'tapestry-dev';
const password = process.env.SETUP_PASSWORD || `Tp-${randomBytes(18).toString('base64url')}`;

async function post(path, body) {
	const response = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: BASE },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		throw new Error(`${path} failed (HTTP ${response.status}): ${await response.text()}`);
	}
}

await post('/studiocms_api/dashboard/step-1', {
	title: 'Tapestry playground',
	description: 'Astro + StudioCMS site used to develop and test Tapestry',
	defaultOgImage: '',
	siteIcon: '',
	enableDiffs: false,
	diffPerPage: 10,
	loginPageBackground: 'studiocms-curves',
	loginPageBackgroundCustom: '',
});
await post('/studiocms_api/dashboard/step-2', {
	username,
	displayname: 'Tapestry Dev',
	email: `${username}@example.com`,
	password,
	confirmPassword: password,
});

writeFileSync(
	process.env.CREDENTIALS_FILE || join(import.meta.dirname, '..', '.dev-credentials'),
	`Local dev admin for the playground (created by setup, never commit)\nURL: ${BASE}/dashboard\nusername: ${username}\npassword: ${password}\n`,
	{ mode: 0o600 },
);
console.log(`Site set up; owner "${username}" (login in .dev-credentials).`);
