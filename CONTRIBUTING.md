# Contribute to Apertrove

Reports from a real shoot are as useful as code. Tell us what you tried, what you expected and what happened; you do not need to know how the camera SDK works.

## Report a problem or share a camera result

Use the [bug report form](https://github.com/M1denHvH/Apertrove/issues/new?template=bug_report.yml). Include Apertrove and Windows versions, reproduction steps and the result. For a camera issue, add the model, firmware, lens, shooting mode, USB connection and Canon runtime version if known. For a shutter problem, say whether you clicked, held, used a keyboard or had just changed Servo.

Remove serial numbers, private paths, personal images, network details, QR codes and remote access keys before sharing screenshots or logs. Do not attach Canon DLLs, headers or proprietary dumps. Use [Security reporting](SECURITY.md) for a vulnerability.

For a feature idea, describe the workflow in a [feature request](https://github.com/M1denHvH/Apertrove/issues/new?template=feature_request.yml).

## Make a code change

Follow [Development](docs/DEVELOPMENT.md) for Windows x64, Node.js 24, isolated profiles and the fake-provider test harness. Start with a small change and include tests for the behavior it fixes.

Before a pull request, run the relevant synthetic checks plus `npm test`, `npm run i18n:check`, `npm run build` and `npm run preflight`. The [architecture guide](docs/ARCHITECTURE.md) explains the process boundaries.

Keep these contracts intact:

- Renderer requests go through preload and main; Canon calls remain in the existing camera worker.
- Validate arguments, use camera-reported choices and preserve a clear stop/cleanup path.
- Retain originals, Library records and transfer context. An unknown outcome must remain visible.
- Preserve existing diagnostics, reports and test artifacts. Use fresh synthetic files/profiles for new checks.
- Keep Canon binaries, proprietary headers, user data, secrets and generated builds out of Git.

A passing fake test cannot qualify physical camera behavior. Agree a specific test with the owner before changing settings, moving a lens, taking a photograph, raising a flash or starting an exposure.

## Improve the interface and guides

Use translation keys for visible messages and supply English and Russian text. Keep saved values independent of the chosen language. Follow existing theme tokens and check light/dark themes, keyboard focus, arbitrary accent colors and reduced motion.

Screenshots must be direct captures of the running application. Mark demo/fake camera data clearly and remove private information. Describe what a user can do and its current limits; keep internal research and validation history outside user navigation.

Original contributions are distributed under the project's MIT license. Retain third-party notices.
