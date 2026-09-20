import { defineConfig, devices } from '@playwright/test'

// 除 publish.spec.js 的隔离网络桩外，其余端到端测试连接真实接口：Web 5174 + 买方服务 3002。
// 仅验收发布页时请运行 npm run test:publish，使用独立端口及不可达的业务代理。
// Vite 把 /api 反向代理到 VITE_PROXY_TARGET（默认 http://localhost:3002）。
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    ...devices['Desktop Chrome'],
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_PROXY_TARGET: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3002' },
  },
})
