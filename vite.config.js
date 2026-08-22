import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET || 'http://localhost:3090'

function proxyConfig({ ws = false } = {}) {
  return {
    target: apiProxyTarget,
    changeOrigin: true,
    secure: true,
    ws,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq) => {
        if (!process.env.VITE_DEV_API_PROXY_TARGET) return
        proxyReq.setHeader('origin', apiProxyTarget)
        proxyReq.setHeader('referer', `${apiProxyTarget}/`)
      })
      if (ws) {
        proxy.on('proxyReqWs', (proxyReq) => {
          if (!process.env.VITE_DEV_API_PROXY_TARGET) return
          proxyReq.setHeader('origin', apiProxyTarget)
        })
      }
    },
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3080,
    proxy: {
      '/api': proxyConfig({ ws: true }),
      '/health': proxyConfig(),
      '/ready': proxyConfig(),
    },
  },
})
