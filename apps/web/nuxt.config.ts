import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-02',
  devtools: { enabled: true },
  // Tailwind 4 laeuft als Vite-Plugin. @nuxtjs/tailwindcss gibt es nur fuer v3.
  vite: { plugins: [tailwindcss()] },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Vereinsfunk — Social Media, das mitspielt',
      htmlAttrs: { lang: 'de' },
      meta: [
        { name: 'description', content: 'Social-Media-Planung für Sportvereine' },
        { name: 'theme-color', content: '#122820' },
      ],
      // Selbst gehostet statt fonts.googleapis.com (Paket 013): kein Drittanbieter-Aufruf mehr
      // bei jedem Seitenaufruf. Alle vier kuratierten Familien werden global geladen, damit die
      // Live-Vorschau auf /marke jede Kombination sofort korrekt darstellen kann -- siehe
      // packages/domain/src/fonts.ts fuer die Registry, die diese Liste widerspiegelt.
      link: [
        { rel: 'stylesheet', href: '/fonts/manrope/manrope.css' },
        { rel: 'stylesheet', href: '/fonts/dm-sans/dm-sans.css' },
        { rel: 'stylesheet', href: '/fonts/space-grotesk/space-grotesk.css' },
        { rel: 'stylesheet', href: '/fonts/karla/karla.css' },
      ],
    },
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:4201',
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL ?? '',
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    },
  },
  typescript: { typeCheck: true, strict: true },
})
