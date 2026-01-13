import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Increase timeout for long-running operations like Helm installs (10 minutes)
        timeout: 600000,
        configure: (proxy) => {
          // Also set proxyTimeout for the underlying http-proxy
          proxy.on('proxyReq', (_proxyReq, _req, res) => {
            // Set socket timeout on the response
            res.setTimeout(600000);
          });
        },
      },
    },
  },
})
