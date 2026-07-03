import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss()],
  resolve: {
    alias: {
      "@/components/ui": path.resolve(__dirname, "."),
      "@/hooks": path.resolve(__dirname, "."),
      "@/lib": path.resolve(__dirname, "."),
      "@": path.resolve(__dirname, "."),
    },
  },
})
