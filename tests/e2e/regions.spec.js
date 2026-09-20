// 真实 React 页面 + 显式 API 网络桩；不代表共享库地址 CRUD / 真实授权通过。
// 专用配置：npx playwright test --config playwright.regions.config.js
import { expect, test } from '@playwright/test'

const node = (regionCode, regionName, regionLevel, parentCode, hasChildren = true) => ({ regionCode, regionName, regionLevel, parentCode, hasChildren })
const DICTIONARY = {
  '': [node('530000', '云南省', 'PROVINCE', null), node('510000', '四川省', 'PROVINCE', null), node('710000', '测试省级叶子', 'PROVINCE', null, false)],
  '530000': [node('530100', '昆明市', 'CITY', '530000')],
  '530100': [node('530111', '官渡区', 'DISTRICT', '530100')],
  '530111': [node('53011110', '矣六街道', 'STREET', '530111', false)],
  '510000': [node('510100', '成都市', 'CITY', '510000')],
  '510100': [node('510105', '青羊区', 'DISTRICT', '510100', false)],
}
const CODES = ['530000', '530100', '530111', '53011110']
const REGION_TEXT = '云南省 昆明市 官渡区 矣六街道'
const ADDRESS = {
  addressId: 'address_ui_only', label: 'UI测试门店', contact: { name: 'UI测试收货人', phone: '13900001111' },
  regionCodes: CODES, regionText: REGION_TEXT, detail: '测试路1号（网络桩）',
  version: 7, status: 'ACTIVE', syncStatus: 'SYNC_PENDING', isDefault: false,
}
const ok = (route, data) => route.fulfill({ json: { code: 0, message: 'ok', data } })
const emptyList = { list: [], total: 0, pageNum: 1, pageSize: 5 }

async function openAddresses(page, options = {}) {
  const requests = []
  const unexpected = []
  const runtimeErrors = []
  const consoleMessages = []
  const allowedStatuses = new Set()
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) consoleMessages.push(message.text())
  })
  const fail = (route, status, message) => {
    allowedStatuses.add(status)
    return route.fulfill({ status, json: { code: status * 100 + 1, message } })
  }
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const parent = url.searchParams.get('parentCode') || ''
    requests.push({ path: url.pathname, method, parent, body: request.postDataJSON(), headers: request.headers() })
    if (url.pathname === '/api/regions' && method === 'GET') {
      if (options.regions) return options.regions({ route, parent, fail, requests })
      return ok(route, { list: DICTIONARY[parent] || [] })
    }
    if (url.pathname === '/api/addresses' && method === 'GET') {
      return ok(route, { ...emptyList, list: options.addresses || [], total: options.addresses?.length || 0 })
    }
    if (url.pathname === '/api/carts' && method === 'GET') return ok(route, emptyList)
    if (url.pathname.startsWith('/api/addresses') && method !== 'GET' && options.write) return options.write({ route, fail, request })
    unexpected.push(`${method} ${url.pathname}`)
    return route.abort('blockedbyclient') // 未声明请求禁止穿透到服务端。
  })
  await page.goto('/#/addresses')
  await expect(page).toHaveURL(/\/#\/addresses$/)
  await expect(page).toHaveTitle('华汽 · 买方工作台')
  await expect(page.getByRole('heading', { name: '收货地址', exact: true })).toBeVisible()
  return {
    requests,
    writes: () => requests.filter((request) => request.method !== 'GET'),
    parents: () => requests.filter((request) => request.path === '/api/regions').map((request) => request.parent),
    healthy: async () => {
      expect(unexpected).toEqual([])
      expect(runtimeErrors).toEqual([])
      expect(consoleMessages.filter((message) => ![...allowedStatuses].some((status) => message.includes('Failed to load resource') && message.includes(`status of ${status}`)))).toEqual([])
      await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    },
  }
}

async function openCreate(page) {
  await page.getByTestId('address-create').click()
  await expect(page.getByTestId('address-modal')).toBeVisible()
}
async function selectPath(page, codes = CODES) {
  for (const [index, code] of codes.entries()) await page.getByTestId(`address-region-${index}`).selectOption(code)
  await expect(page.getByTestId('address-region-status')).not.toContainText('地区加载中')
}
async function fillContact(page) {
  await page.getByTestId('address-label').fill(ADDRESS.label)
  await page.getByTestId('address-contact-name').fill(ADDRESS.contact.name)
  await page.getByTestId('address-contact-phone').fill(ADDRESS.contact.phone)
  await page.getByTestId('address-detail').fill(ADDRESS.detail)
}

test('四级级联 / 叶子停止 / 自动名称编码 / 保存包体（网络桩，不落库）', async ({ page }, testInfo) => {
  const app = await openAddresses(page, { write: ({ route }) => ok(route, { addressId: 'ui_only', syncStatus: 'SYNC_PENDING' }) })
  await openCreate(page)
  await expect(page.getByTestId('address-save')).toBeDisabled()
  await fillContact(page)
  await selectPath(page)
  await expect(page.getByTestId('address-region-text')).toHaveValue(REGION_TEXT)
  await expect(page.getByTestId('address-region-codes')).toHaveValue(CODES.join(','))
  await expect(page.getByTestId('address-region-text')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('address-region-codes')).toHaveAttribute('readonly', '')
  expect(app.parents()).toEqual(['', '530000', '530100', '530111'])
  await page.getByTestId('address-region-picker').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('regions-desktop.png') })
  await page.getByTestId('address-save').click()
  await expect(page.getByTestId('address-modal')).toHaveCount(0)
  const [write] = app.writes()
  expect(write.method).toBe('POST')
  expect(write.body).toEqual({ label: ADDRESS.label, contact: ADDRESS.contact, regionCodes: CODES, regionText: REGION_TEXT, detail: ADDRESS.detail, isDefault: false })
  expect(write.headers['idempotency-key']).toBeTruthy()
  await app.healthy()
})

test('切换父级立即清空下级，迟到的旧响应不覆盖新地区', async ({ page }) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let requested
  const pending = new Promise((resolve) => { requested = resolve })
  const app = await openAddresses(page, { regions: async ({ route, parent }) => {
    if (parent === '530000') { requested(); await gate }
    return ok(route, { list: DICTIONARY[parent] || [] })
  } })
  await openCreate(page)
  await page.getByTestId('address-region-0').selectOption('530000')
  await pending
  await expect(page.getByTestId('address-save')).toBeDisabled()
  await page.getByTestId('address-region-0').selectOption('510000')
  await page.getByTestId('address-region-1').selectOption('510100')
  await expect(page.getByTestId('address-region-codes')).toHaveValue('510000,510100')
  const late = page.waitForResponse((response) => response.url().includes('parentCode=530000'))
  release()
  await (await late).finished()
  await expect(page.getByTestId('address-region-1')).toHaveValue('510100')
  await expect(page.getByTestId('address-region-1').locator('option')).not.toContainText(['昆明市'])
  await page.getByTestId('address-region-0').selectOption('710000')
  await expect(page.getByTestId('address-region-codes')).toHaveValue('710000')
  await expect(page.getByTestId('address-region-text')).toHaveValue('测试省级叶子')
  await expect(page.getByTestId('address-region-1')).toHaveCount(0)
  await expect(page.getByTestId('address-save')).toBeEnabled()
  expect(app.parents()).not.toContain('710000')
  expect(app.writes()).toEqual([])
  await app.healthy()
})

test('编辑回显四级及 version；地址写503保持弹窗，不显示成功', async ({ page }) => {
  const app = await openAddresses(page, { addresses: [ADDRESS], write: ({ route, fail }) => fail(route, 503, '地址写接口暂未实现') })
  await page.getByTestId('address-edit').click()
  await expect(page.getByTestId('address-region-3')).toHaveValue(CODES[3])
  await expect(page.getByTestId('address-save')).toBeEnabled()
  await page.getByTestId('address-detail').fill('修改后测试路2号')
  await page.getByTestId('address-save').click()
  await expect(page.getByTestId('toast')).toContainText('地址写接口暂未实现')
  await expect(page.getByTestId('address-modal')).toBeVisible()
  expect(app.writes()[0].method).toBe('PATCH')
  expect(app.writes()[0].body).toMatchObject({ version: 7, regionCodes: CODES, regionText: REGION_TEXT, detail: '修改后测试路2号' })
  await app.healthy()
})

test('允许只选至市，不强迫四级；清空父级清除全部子级', async ({ page }) => {
  const app = await openAddresses(page)
  await openCreate(page)
  await selectPath(page, CODES.slice(0, 2))
  await expect(page.getByTestId('address-save')).toBeEnabled()
  await expect(page.getByTestId('address-region-text')).toHaveValue('云南省 昆明市')
  await page.getByTestId('address-region-0').selectOption('')
  await expect(page.getByTestId('address-region-codes')).toHaveValue('')
  await expect(page.getByTestId('address-region-text')).toHaveValue('')
  await expect(page.getByTestId('address-region-1')).toHaveCount(0)
  await expect(page.getByTestId('address-save')).toBeDisabled()
  expect(app.writes()).toEqual([])
  await app.healthy()
})

test('403 明确提示且禁止保存；重试重新请求字典后可恢复选择', async ({ page }) => {
  let denied = true
  const app = await openAddresses(page, { regions: ({ route, parent, fail }) => denied ? fail(route, 403, 'ORG_ACCESS_DENIED') : ok(route, { list: DICTIONARY[parent] || [] }) })
  await openCreate(page)
  await expect(page.getByRole('alert')).toContainText('ORG_ACCESS_DENIED')
  await expect(page.getByTestId('address-save')).toBeDisabled()
  denied = false
  await page.getByTestId('address-region-retry').click()
  await selectPath(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('address-save')).toBeEnabled()
  expect(app.parents().filter((parent) => parent === '')).toHaveLength(2)
  expect(app.writes()).toEqual([])
  await app.healthy()
})

for (const [name, data, expected] of [
  ['字典为空', { list: [] }, '地区字典暂无数据'],
  ['响应异常', { unexpected: [] }, '地区字典返回格式异常'],
]) {
  test(`${name}：不退回手填、不允许保存`, async ({ page }) => {
    const app = await openAddresses(page, { regions: ({ route }) => ok(route, data) })
    await openCreate(page)
    await expect(page.getByRole('alert')).toContainText(expected)
    await expect(page.getByTestId('address-save')).toBeDisabled()
    await expect(page.getByTestId('address-region-codes')).toHaveAttribute('readonly', '')
    expect(app.writes()).toEqual([])
    await app.healthy()
  })
}

test('旧地址无效编码不静默替换，重选后清除错误下级', async ({ page }) => {
  const originalCodes = ['530000', '999999', '99999901']
  const app = await openAddresses(page, { addresses: [{ ...ADDRESS, regionCodes: originalCodes, regionText: '历史地区待核对' }] })
  await page.getByTestId('address-edit').click()
  await expect(page.getByRole('alert')).toContainText('999999 不在当前字典中')
  await expect(page.getByTestId('address-region-codes')).toHaveValue(originalCodes.join(','))
  await expect(page.getByTestId('address-region-text')).toHaveValue('历史地区待核对')
  await expect(page.getByTestId('address-save')).toBeDisabled()
  await page.getByTestId('address-region-1').selectOption('530100')
  await expect(page.getByTestId('address-region-codes')).toHaveValue('530000,530100')
  await expect(page.getByTestId('address-save')).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await app.healthy()
})

test('非逐级结构按实际 regionLevel 标注，不把街道叫作区', async ({ page }) => {
  const app = await openAddresses(page, { regions: ({ route, parent }) => ok(route, { list: parent === '530100' ? [node('53010010', '测试直管街道', 'STREET', '530100', false)] : DICTIONARY[parent] || [] }) })
  await openCreate(page)
  await selectPath(page, ['530000', '530100', '53010010'])
  await expect(page.getByTestId('address-region-2')).toHaveAttribute('aria-label', '街道 / 乡镇')
  await expect(page.getByTestId('address-region-text')).toHaveValue('云南省 昆明市 测试直管街道')
  expect(app.parents()).toEqual(['', '530000', '530100'])
  await app.healthy()
})

test('循环/同码覆盖的字典拒绝使用，不生成可保存地址', async ({ page }) => {
  const app = await openAddresses(page, { regions: ({ route, parent }) => ok(route, { list: parent === '530000' ? [node('530000', '错误同码城市', 'CITY', '530000')] : DICTIONARY[parent] || [] }) })
  await openCreate(page)
  await page.getByTestId('address-region-0').selectOption('530000')
  await expect(page.getByRole('alert')).toContainText('地区字典层级或编码异常')
  await expect(page.getByTestId('address-save')).toBeDisabled()
  expect(app.writes()).toEqual([])
  await app.healthy()
})

test('同一弹窗复用字典，重开弹窗刷新缓存', async ({ page }) => {
  const app = await openAddresses(page)
  await openCreate(page)
  await selectPath(page)
  await page.getByTestId('address-region-0').selectOption('510000')
  await expect(page.getByTestId('address-save')).toBeEnabled()
  await selectPath(page)
  expect(app.parents().filter((parent) => parent === '530000')).toHaveLength(1)
  await page.getByTestId('address-cancel').click()
  await openCreate(page)
  await expect(page.getByTestId('address-region-0')).toBeVisible()
  expect(app.parents().filter((parent) => parent === '')).toHaveLength(2)
  await app.healthy()
})

test('窄屏地址弹窗可滚动，地区选择与保存按钮不越界', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await openAddresses(page)
  await openCreate(page)
  await selectPath(page)
  await page.getByTestId('address-region-picker').scrollIntoViewIfNeeded()
  for (let index = 0; index < 4; index += 1) {
    const box = await page.getByTestId(`address-region-${index}`).boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
  await expect(page.getByTestId('address-save')).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('regions-narrow.png') })
  expect(app.writes()).toEqual([])
  await app.healthy()
})

test('选完四级再换省，原市区街道立即清空且加载期间不可保存', async ({ page }) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let childRequested
  const requestStarted = new Promise((resolve) => { childRequested = resolve })
  const app = await openAddresses(page, { regions: async ({ route, parent }) => {
    if (parent === '510000') { childRequested(); await gate }
    return ok(route, { list: DICTIONARY[parent] || [] })
  } })
  await openCreate(page)
  await selectPath(page)
  await page.getByTestId('address-region-0').selectOption('510000')
  await requestStarted
  await expect(page.getByTestId('address-region-codes')).toHaveValue('510000')
  await expect(page.getByTestId('address-region-text')).toHaveValue('四川省')
  await expect(page.getByTestId('address-region-3')).toHaveCount(0)
  await expect(page.getByTestId('address-save')).toBeDisabled()
  release()
  await expect(page.getByTestId('address-region-1')).toBeVisible()
  await expect(page.getByTestId('address-save')).toBeEnabled()
  await app.healthy()
})

test('hasChildren为真但下级空时禁用保存，重试后保留父级并恢复', async ({ page }) => {
  let empty = true
  const app = await openAddresses(page, { regions: ({ route, parent }) => ok(route, { list: empty && parent === '530000' ? [] : DICTIONARY[parent] || [] }) })
  await openCreate(page)
  await page.getByTestId('address-region-0').selectOption('530000')
  await expect(page.getByRole('alert')).toContainText('下级地区暂无数据')
  await expect(page.getByTestId('address-save')).toBeDisabled()
  empty = false
  await page.getByTestId('address-region-retry').click()
  await expect(page.getByTestId('address-region-0')).toHaveValue('530000')
  await page.getByTestId('address-region-1').selectOption('530100')
  await expect(page.getByTestId('address-save')).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await app.healthy()
})

test('历史地址超过四级时仍可重新选择，不陷入只有错误没有控件的死路', async ({ page }) => {
  const app = await openAddresses(page, { addresses: [{ ...ADDRESS, regionCodes: [...CODES, '99999999'] }] })
  await page.getByTestId('address-edit').click()
  await expect(page.getByRole('alert')).toContainText('超过四级')
  await expect(page.getByTestId('address-save')).toBeDisabled()
  await expect(page.getByTestId('address-region-0')).toBeVisible()
  await page.getByTestId('address-region-0').selectOption('710000')
  await expect(page.getByTestId('address-region-codes')).toHaveValue('710000')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('address-save')).toBeEnabled()
  await app.healthy()
})
