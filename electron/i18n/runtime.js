(function (root) {
  const supportedLocales = Object.freeze(['ru-RU', 'en-US']);
  const languages = Object.freeze(['system', ...supportedLocales]);
  const dictionaries = new Map();
  const listeners = new Set();
  const formatters = new Map();
  const starterLabels = {
    portrait: ['soft_portrait', 'wide_aperture_and_soft_colors_use_m_mode'],
    still: ['still_life', 'detail_and_depth_of_field_use_m_mode'],
    street: ['city_in_motion', 'a_fast_shutter_for_daytime_street_photography_use']
  };
  let locale = 'ru-RU';
  let legacyIndex;

  function systemLocale(preferences) {
    const first = Array.isArray(preferences) ? preferences.find(Boolean) : preferences;
    const language = String(first || '').split(/[-_]/)[0].toLowerCase();
    return supportedLocales.find(id => id.split('-')[0] === language) || 'en-US';
  }

  function resolve(preference, preferences) {
    return supportedLocales.includes(preference) ? preference : systemLocale(preferences);
  }

  function migrate(preference, established) {
    return languages.includes(preference) ? preference : established ? 'ru-RU' : 'system';
  }

  function register(dictionaryLocale, messages) {
    dictionaries.set(dictionaryLocale, messages);
    legacyIndex = null;
  }

  function setLocale(next) {
    if (!supportedLocales.includes(next) || next === locale) return;
    locale = next;
    if (root.document) root.document.documentElement.lang = locale;
    for (const listener of listeners) listener();
  }

  function format(kind, options, formatLocale = locale) {
    const key = JSON.stringify([kind, formatLocale, options]);
    if (!formatters.has(key)) formatters.set(key, new Intl[kind](formatLocale, options));
    return formatters.get(key);
  }

  const getLocale = () => locale;
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const number = (value, options) => format('NumberFormat', options).format(value);
  const date = (value, options) => {
    const instant = new Date(value);
    return Number.isFinite(instant.valueOf()) ? format('DateTimeFormat', options).format(instant) : '—';
  };
  function t(key, values = {}) {
    const own = dictionaries.get(locale);
    const fallback = dictionaries.get('en-US');
    const plural = typeof values.count === 'number';
    const lookup = (dictionary, dictionaryLocale) => {
      if (!plural) return dictionary?.[key];
      const suffix = format('PluralRules', undefined, dictionaryLocale).select(values.count);
      return dictionary?.[key + '.' + suffix] ?? dictionary?.[key + '.other'] ?? dictionary?.[key];
    };
    const pattern = lookup(own, locale) ?? lookup(fallback, 'en-US') ?? key;
    return pattern.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      const value = values[name];
      return typeof value === 'number' && name === 'count' ? number(value) : String(value ?? '');
    });
  }

  // Canon, diagnostics and older presets already carry display labels in their
  // payloads. Translate known messages at the display boundary.
  function legacy(value) {
    if (locale === 'ru-RU' || typeof value !== 'string') return value;
    if (!legacyIndex) {
      const exact = new Map(), patterns = [];
      for (const [key, message] of Object.entries(dictionaries.get('ru-RU') || {})) {
        if (!key.startsWith('legacy.')) continue;
        if (!message.includes('{{')) { exact.set(message, key); continue; }
        const names = [];
        const parts = message.split(/(\{\{\w+\}\})/g).map(part => {
          if (part.startsWith('{{')) { names.push(part.slice(2, -2)); return '([\\s\\S]+?)'; }
          return part.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        });
        patterns.push({ key, names, regexp: new RegExp('^' + parts.join('') + '$') });
      }
      legacyIndex = { exact, patterns };
    }
    const key = legacyIndex.exact.get(value);
    if (key) return t(key);
    for (const { key: pattern, regexp, names } of legacyIndex.patterns) {
      const match = regexp.exec(value);
      if (match) return t(pattern, Object.fromEntries(names.map((name, index) => [name, localizedParameter(pattern,name,match[index+1])])));
    }
    const code = value.match(/^(.*?)\s+(\(0x[\da-f]+\)\.?)$/i);
    if (code) {
      const separator = code[1].indexOf(': ');
      if (separator !== -1) {
        const action = code[1].slice(0, separator);
        const reason = code[1].slice(separator + 2);
        return legacy(action) + ': ' + legacy(reason) + ' ' + code[2];
      }
      return legacy(code[1]) + ' ' + code[2];
    }
    return value;
  }
  function localizedParameter(key, name, value) {
    // Only known label slots are translated. Filenames, model names, user
    // preset names and raw diagnostics keep their source text.
    if ((key.startsWith('legacy.cameraControl.') && name === 'v0') ||
        (key.startsWith('legacy.cameraCapabilities.current') && name === 'v0') ||
        (key.startsWith('legacy.presetSeries.is_unavailable') && name === 'v1')) return legacy(value);
    return value;
  }

  function error(value) {
    return legacy(String(value?.message ?? value ?? '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
  }

  function starterPresetLabel(preset, field) {
    const value = preset?.[field];
    const index = field === 'name' ? 0 : field === 'description' ? 1 : -1;
    const suffix = Object.hasOwn(starterLabels, preset?.id) && starterLabels[preset.id][index];
    if (!suffix) return value;
    const key = 'legacy.main.' + suffix;
    return value === dictionaries.get('ru-RU')?.[key] ? t(key) : value;
  }

  function localized(factory) {
    let previous, value;
    return () => {
      if (previous !== locale) { previous = locale; value = factory(); }
      return value;
    };
  }
  const api = { languages, supportedLocales, systemLocale, resolve, migrate, register, setLocale, getLocale, subscribe, number, date, t, legacy, error, localized, starterPresetLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ApertroveI18n = api;
})(globalThis);
