// Prop migrations for the Counter (see `version` in tapestry.config.mjs). Each entry upgrades
// props saved with the previous version; pages are upgraded when read and saved in the new
// shape the next time they're edited. Plain JavaScript: it runs on the server and in the editor.
export default {
	// Version 2: `start` was renamed to `initial`.
	2: ({ start, ...props }) => (start === undefined ? props : { ...props, initial: start }),
};
