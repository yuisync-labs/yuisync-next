import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET || 'http://localhost:3090'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3080,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: true,
        ws: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            if (!process.env.VITE_DEV_API_PROXY_TARGET) return
            proxyReq.setHeader('origin', apiProxyTarget)
            proxyReq.setHeader('referer', `${apiProxyTarget}/`)
          })
          proxy.on('proxyReqWs', (proxyReq) => {
            if (!process.env.VITE_DEV_API_PROXY_TARGET) return
            proxyReq.setHeader('origin', apiProxyTarget)
          })
        },
      },
    },
  },
})
