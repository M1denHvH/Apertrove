# Contributing

Start with an issue describing the user-visible problem, camera model, connection and proposed behavior. Small, focused pull requests are easiest to review.

Use Windows x64 and Node.js 24. Run `npm ci`, `npm test`, `npm run build` and `npm run preflight`. `node tests/designs.cjs` checks the UI without opening a camera session. Tests that access real cameras are explicit opt-in scripts; do not run shutter-release tests without the owner's permission.

Keep all SDK calls inside the isolated worker. Never expose native pointers to Electron renderers or use unowned native buffers. Preserve existing photo files and settings. Camera writes must be capability checked; focus commands need bounded completion and release in `finally`.

Session destinations must remain fixed during an active capture job. Preset queues validate all steps, enforce single-shot drive and restore a snapshot even after cancellation/errors. Native burst tests require explicit permission and a bounded hold duration; a previous permission for two preset frames does not authorize additional bursts. Respect the hardware test budget files.

Run `npm run i18n:check` for dictionary changes and `npm run i18n:ui` (with Microsoft Edge installed) to check the interface with a mocked camera worker. Equipment cards can load and cache product images from validated official URLs. Keep those images out of the repository and document any unverified specifications.

Do not commit EDSDK binaries, Canon headers/manuals, user libraries, photos, access keys or generated builds. Obtain the SDK separately from Canon. Describe hardware validation precisely: a test with one EOS model does not certify all SDK models.

The interface supports Russian and English. Use shared translation keys for user-facing text, add both translations, and keep saved values independent of language. New designs must work with light/dark/system themes, arbitrary accents, keyboard navigation and reduced motion. [Localization guide](docs/localization.md)

By contributing, you agree that your original contribution is distributed under the repository's MIT license. Third-party code and assets must retain their licenses.
