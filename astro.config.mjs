// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://subtitlegeneratorfree.com',
  i18n: {
    defaultLocale: 'en',
    locales: [
      'en', 'es', 'fr', 'de', 'ja', 'zh', 'ar',
      { path: 'pt-br', codes: ['pt-BR', 'pt'] }
    ],
    routing: {
      prefixDefaultLocale: false,
      fallbackType: 'rewrite',
    },
    fallback: {
      es: 'en', fr: 'en', de: 'en',
      ja: 'en', zh: 'en', ar: 'en', 'pt-br': 'en',
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});