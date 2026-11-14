// Runs before styles and the renderer bundles, using Electron's startup snapshot.
(() => {
  const appearance = window.focal?.initialAppearance ?? window.shotInspector?.initialAppearance;
  const root = document.documentElement;
  if (window.focal?.initialLocale || window.shotInspector?.initialLocale) root.lang = window.focal?.initialLocale ?? window.shotInspector.initialLocale;
  const theme = appearance?.resolvedTheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.dataset.theme = theme;
  root.dataset.themeMode = appearance?.theme ?? 'system';
  root.dataset.design = appearance?.design ?? 'current';
  root.style.colorScheme = theme;
  if (appearance) {
    root.toggleAttribute('data-performance-mode', appearance.performanceMode);
    root.style.setProperty('--accent-color', appearance.accentColor);
    root.style.setProperty('--on-accent', appearance.onAccent);
  }
})();
