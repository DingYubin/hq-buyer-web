import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 仅验收地区 UI：所有 API 必须由测试拦截，代理不可达，不接触真实地址/共享库。
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'regions.spec.js',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: join(tmpdir(), 'hq-buyer-web-regions-results'),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5185',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5185 --strictPort',
    url: 'http://127.0.0.1:5185',
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '/api', VITE_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
})
