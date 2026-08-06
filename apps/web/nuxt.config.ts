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
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap',
        },
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
