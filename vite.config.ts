import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: '0.0.0.0',
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  preview: {
    host: '0.0.0.0',
  },
  build: { sourcemap: true },
});
