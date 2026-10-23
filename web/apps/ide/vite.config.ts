import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        resolve(import.meta.dirname, '../../../backend/api'),
      ],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    restoreMocks: true,
  },
})
