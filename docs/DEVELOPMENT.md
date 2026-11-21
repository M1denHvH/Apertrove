# Develop Apertrove

Use Windows x64, Git, Node.js 24 and npm. Canon SDK files are unnecessary for building the UI or running the synthetic suites.

## Run from source

```powershell
npm ci
npm run build
npm start
```

For live renderer development, run `npm run dev`. In a second PowerShell terminal:

```powershell
$env:FOCAL_DEV_URL = 'http://127.0.0.1:5173'
npm start
```

The development origin is restricted to that loopback address and port. Remove `FOCAL_DEV_URL` when returning to the built renderer.

Use an isolated profile for development so that tests cannot rewrite your normal library:

```powershell
$env:FOCAL_TEST_DATA = Join-Path $env:TEMP ('apertrove-dev-' + [guid]::NewGuid())
npm start
```

The profile setting isolates application data; it does **not** disable hardware. Use the explicit fake-provider test harness when camera actions are required.

## Checks

```powershell
npm test
npm run test:t1
npm run i18n:check
npm run build
npm run preflight
```

For the actual Electron control/session smoke with the fenced JavaScript camera provider:

```powershell
npm run test:ui:prepare
npm run build
npm run test:ui:controls
```

Preparation verifies the pinned stock Electron bytes installed by `npm ci`. It preserves existing admission files and refuses mismatched versions. The smoke creates fresh isolated fixtures and performs no physical camera operations.

The project has no separate lint or TypeScript check script. Additional focused Node tests live under `tests/`; read their entry guards before running them. Tests with names containing hardware are not automatically safe. Never use a connected camera to debug a UI test.

## Build a portable application

```powershell
npm run package
```

This produces `release/win-unpacked/Apertrove.exe`. Keep the whole directory together. It packages the existing version and publishes nothing. The build is unsigned. Canon DLLs, developer profiles, QA artifacts and internal validation documents must not enter the distributed application.

## Working rules

Keep SDK access in the camera worker. New controls need argument checks, explicit unavailable and unknown states, stop/cleanup handling, and tests that run with a fake adapter. Never infer optical focus from command acceptance.

Photo registration must complete before a photo is announced as saved. Pin delivery context when admitting a transfer; do not silently assign a delayed photo to whichever session happens to be open later. A camera callback without a capture key cannot prove application-level correlation.

Preserve existing libraries and originals. Do not reset a damaged library, overwrite a valid original, or run migrations on a user's profile during development. Internal diagnostics and validation history are retained separately from user-facing guidance.

[Architecture](ARCHITECTURE.md) · [Contributing](../CONTRIBUTING.md) · [Localization](localization.md)
