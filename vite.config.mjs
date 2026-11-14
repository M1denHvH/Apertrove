import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'inspector-dev-csp',
    apply: 'serve',
    transformIndexHtml(html, { path }) {
      if (path !== '/shot-inspector.html') return html;
      return html.replace("default-src 'self';", "default-src 'self'; script-src 'self' 'unsafe-inline';");
    }
  }],
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      inspector: fileURLToPath(new URL('./shot-inspector.html', import.meta.url))
    } }
  }
});
