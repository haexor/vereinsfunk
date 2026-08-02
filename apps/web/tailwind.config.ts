import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  content: ['./app/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        ink: '#14221d',
        forest: '#163a2c',
        lime: '#caff4a',
        oat: '#f4f2e9',
        coral: '#ff795f',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        display: ['Manrope', 'sans-serif'],
      },
    },
  },
}
