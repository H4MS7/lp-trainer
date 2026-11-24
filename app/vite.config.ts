import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // relative Pfade: funktioniert auf GitHub Pages (/lp-trainer/) und in jedem Unterordner
  base: './',
  plugins: [react(), tailwindcss()],
})
