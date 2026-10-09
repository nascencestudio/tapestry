// CI check for the production image (run inside the container): resolve sharp
// the same way packages/medialibrary/src/runtime/images.ts loadSharp() does,
// from the server bundle's directory, then resize an image. A bundled sharp
// can't find its native binary (docs/known-issues.md #30), so this catches
// regressions the healthcheck wouldn't.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const chunk = readdirSync('/app/dist/server/chunks').find((f) => f.startsWith('images_'));
const fromChunk = createRequire(`/app/dist/server/chunks/${chunk}`);
const sharp = createRequire(fromChunk.resolve('@nascencestudio/medialibrary/package.json'))('sharp');
const out = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#336' } })
	.jpeg()
	.toBuffer()
	.then((b) => sharp(b).resize({ width: 480 }).webp().toBuffer({ resolveWithObject: true }));
console.log(
	'sharp',
	sharp.versions.sharp,
	'resized to',
	out.info.width,
	'x',
	out.info.height,
	out.info.format,
	`(chunk ${chunk})`,
);
