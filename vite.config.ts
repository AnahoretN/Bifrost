import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vitejs.dev/config/
// Plain `dev` runs HTTP on localhost — localhost is a secure context anyway,
// so showDirectoryPicker/clipboard work without any certificate fuss.
// `dev:lan` (mode 'lan') adds self-signed HTTPS for phones on the network.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'lan' ? [basicSsl()] : [])],
  define: {
    // Build stamp surfaced in the UI — stale cached tabs are immediately visible.
    __BUILD: JSON.stringify(new Date().toISOString()),
  },
  base: './',
  server: {
    host: true,
    port: 5599,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
}));
