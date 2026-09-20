import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 发布页隔离验收：页面真实运行，所有 API 由测试拦截；代理指向不可用端口，禁止真实发单。
export default defineConfig({
  ...base,
  testMatch: 'publish.spec.js',
  outputDir: join(tmpdir(), 'hq-buyer-web-publish-results'),
  use: { ...base.use, baseURL: 'http://127.0.0.1:5184', serviceWorkers: 'block' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '/api', VITE_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
})
