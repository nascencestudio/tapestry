/**
 * Required by StudioCMS's `settingsPage` (it lists Tapestry under the
 * dashboard's Plugins section). Tapestry's settings page has its own form and
 * endpoint (settings-endpoint.ts), so StudioCMS's generic save isn't used.
 */
export const onSave = () => async () =>
	new Response('Tapestry settings are saved from the Tapestry settings page.', {
		status: 405,
		headers: { 'Content-Type': 'text/plain' },
	});
