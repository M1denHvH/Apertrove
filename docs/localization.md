# Localization

Apertrove supports Russian (ru-RU) and English (en-US). New profiles follow the system language reported by Electron through app.getPreferredSystemLanguages(). Other system languages resolve to English. Profiles created before the language setting was introduced keep Russian. The language selector is available on the welcome screen and in Settings. Language and appearance use independent fields in the same application settings.

- [Dictionaries](../electron/i18n/locales) use semantic keys grouped by screen. Write both translations for new strings.
- [Shared runtime](../electron/i18n/runtime.js) runs in Electron, React and Web Remote. Use t with an interpolation object and include a numeric count for plural messages. Add one, few, many or other variants as required by Intl.PluralRules. Use the runtime’s number and date helpers for presentation.
- The [React adapter](../src/i18n.js) loads the dictionaries through Vite and subscribes to locale changes. Keep selected IDs and navigation independent of language. Translate labels when rendering or use localized for collections of messages.
- Electron sends the resolved locale through the existing settings event and Shot Inspector state. Web Remote reads the initial locale from the host and receives updates through its existing state stream.
- The legacy namespace catalogs Russian messages already present in the camera, SDK and saved-data contracts. Translate those at the display boundary. Leave filenames, model names, EXIF tags, camera identifiers and error codes intact.

To add a language, add its identifier to supportedLocales, create a matching JSON dictionary and add its language name to the dictionaries. Extend the validator to check the new locale and its plural forms.

Run npm run i18n:check, npm test, npm run build and npm run i18n:ui. The UI suite uses isolated Electron profiles and a mocked camera worker. It covers first-run preferences, migration, persistence, synchronization between surfaces and continuity of an active Live View stream. Screenshots go to qa/i18n.

