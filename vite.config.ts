/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/cgt-parcel-tracker/',
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'node',
  },
})
