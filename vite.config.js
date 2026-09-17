import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 买家端 PC 工作台：5174（卖家端占用 5173），接口统一走 /api 反向代理到 hq-buyer-service。
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:3002'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5174,
  },
})
