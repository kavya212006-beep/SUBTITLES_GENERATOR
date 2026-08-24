import { getRelativeLocaleUrl } from 'astro:i18n';
import { localeInfo, type Locale } from './ui';

import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import de from './de.json';
import ja from './ja.json';
import zh from './zh.json';
import ar from './ar.json';
import ptBr from './pt-br.json';

export type TranslationKey = keyof typeof en;

const translations: Record<string, Record<string, string>> = {
  en, es, fr, de, ja, zh, ar, 'pt-br': ptBr,
};

/**
 * t() — get a translated string by key.
 * Falls back to English if the key is missing in the requested locale.
 */
export function t(lang: string, key: TranslationKey): string {
  const dict = translations[lang] ?? translations['en'];
  return (dict[key] ?? translations['en'][key] ?? key) as string;
}

/**
 * isRTL() — returns true if the locale is right-to-left (Arabic, etc.)
 */
export function isRTL(lang: string): boolean {
  return localeInfo[lang as Locale]?.dir === 'rtl';
}

/**
 * getLocalizedUrl() — wrapper for Astro's getRelativeLocaleUrl.
 * pt-br is handled manually since it's configured as a path alias in astro.config.
 */
export function getLocalizedUrl(lang: string, path: string): string {
  if (lang === 'pt-br') {
    const normalPath = path.startsWith('/') ? path : `/${path}`;
    return `/pt-br${normalPath === '/' ? '' : normalPath}`;
  }
  return getRelativeLocaleUrl(lang, path);
}

/**
 * getAlternateUrls() — returns hreflang alternate link entries for SEO.
 * Note: pt-br uses manual path building since Astro treats it as a path alias.
 */
export function getAlternateUrls(path: string): Array<{ hreflang: string; href: string }> {
  const supportedLocales: Locale[] = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ar'];
  const hreflangMap: Record<string, string> = {
    en: 'en', es: 'es', fr: 'fr', de: 'de',
    ja: 'ja', zh: 'zh-Hans', ar: 'ar', 'pt-br': 'pt-BR',
  };

  const results = supportedLocales.map(locale => ({
    hreflang: hreflangMap[locale],
    href: getRelativeLocaleUrl(locale, path),
  }));

  // pt-br: manually construct the path since it's a locale alias in astro.config
  const normalPath = path.startsWith('/') ? path : `/${path}`;
  results.push({
    hreflang: 'pt-BR',
    href: `/pt-br${normalPath === '/' ? '' : normalPath}`,
  });

  return results;
}
