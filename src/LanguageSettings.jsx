import React from 'react';
import { Languages } from 'lucide-react';
import Select from './Select';
import { i18n, t } from './i18n.js';

export default function LanguageSettings({ value, onChange, compact = false }) {
  const heading = <><Languages size={18} aria-hidden="true"/> {t('language.title')}</>;
  const control = <Select aria-label={t('language.preference')} value={value || 'system'} onChange={event => onChange(event.target.value)}>
    <option value="system">{t('language.system')}</option>
    {i18n.supportedLocales.map(locale => <option key={locale} value={locale} lang={locale}>{t('language.name.'+locale.toLowerCase().replace('-','_'))}</option>)}
  </Select>;
  return compact
    ? <div className="language-setting language-setting-compact"><span>{heading}</span>{control}</div>
    : <section className="settings-card language-setting"><h3>{heading}</h3>{control}</section>;
}

