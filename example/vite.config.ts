import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/conduit/',
  resolve: {
    alias: {
      '@conduit/sdk': path.resolve(__dirname, '../dist'),
    },
  },
})
