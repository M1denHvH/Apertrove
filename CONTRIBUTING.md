# Contributing to Apertrove

Start with the user-visible problem: what you tried, what happened, and what you expected. A small focused change is easier to verify than an architectural rewrite.

## Set up and check

Use Windows x64 and Node.js 24. Follow [Development](docs/DEVELOPMENT.md) for isolated profiles, commands and portable packaging. Before opening a pull request, run the relevant synthetic tests plus `npm test`, `npm run i18n:check`, `npm run build` and `npm run preflight`.

A source review or fake-provider result does not qualify a physical camera. Do not run tests that change camera settings, move a lens, release the shutter, raise a flash or transfer camera files without the owner's explicit permission.

## Keep the boundaries intact

- Renderer commands go through preload and Electron main; EDSDK calls stay in the camera worker.
- Validate arguments, use camera-reported choices and readback, and give active operations an explicit stop and cleanup path.
- Keep captured delivery context and original files intact. Unknown correlation or completion must stay visible.
- Preserve existing libraries, recovery evidence and test artifacts. Use new synthetic files and profiles for tests.
- Never commit Canon binaries, proprietary headers/manuals, user libraries, photos, access keys or generated builds.

See [Architecture](docs/ARCHITECTURE.md). New controls need tests for errors, repeated requests, disconnect and shutdown as well as the successful path.

## Interface and documentation

Use translation keys for user-facing messages and add both English and Russian. Keep saved values independent of language. Preserve the existing theme tokens and test light/dark themes, keyboard focus, arbitrary accents and reduced motion.

Screenshots must come from the running application. Label simulated camera previews clearly and remove private paths, serial numbers and remote access links. User guides describe actions and current limits; internal validation history belongs outside the user navigation.

By contributing original code, you agree to distribute it under the repository's MIT license. Retain third-party notices.
