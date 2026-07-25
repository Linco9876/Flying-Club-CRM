import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? '/Flying-Club-CRM/' : '/',
  server: {
    // BrowserStack Local maps physical-device traffic through this fixed host.
    // Keep the development allowlist narrow rather than accepting arbitrary hosts.
    allowedHosts: ['bs-local.com'],
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
