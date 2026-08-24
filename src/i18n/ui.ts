// Locale configuration — central registry for all supported languages

export const defaultLocale = 'en' as const;

export const locales = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ar', 'pt-br'] as const;

export type Locale = (typeof locales)[number];

/** Human-readable locale metadata */
export const localeInfo: Record<Locale, { label: string; flag: string; dir: 'ltr' | 'rtl' }> = {
  en: { label: 'English',            flag: '🇺🇸', dir: 'ltr' },
  es: { label: 'Español',            flag: '🇪🇸', dir: 'ltr' },
  fr: { label: 'Français',           flag: '🇫🇷', dir: 'ltr' },
  de: { label: 'Deutsch',            flag: '🇩🇪', dir: 'ltr' },
  ja: { label: '日本語',              flag: '🇯🇵', dir: 'ltr' },
  zh: { label: '中文',               flag: '🇨🇳', dir: 'ltr' },
  ar: { label: 'العربية',            flag: '🇸🇦', dir: 'rtl' },
  'pt-br': { label: 'Português',     flag: '🇧🇷', dir: 'ltr' },
};
