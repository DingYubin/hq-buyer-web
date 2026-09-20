// 新 PC 原型：真实页面 + 全部 API 网络桩，不是后端落库/真实 saveInquiry 测试。
import { expect, test } from '@playwright/test'

const VIN = 'LSGAA53D6NA108268'
const OTHER_VIN = 'LSGAA53D6NA108269'
const MODEL = { model: '测试车型', carBrandId: 'TEST_BRAND', carBrandName: '测试品牌', saleModelCode: 'TEST_MODEL', seriesId: 'SERIES_1', brandLogo: 'display-only', energyType: '汽油' }
const ADDRESSES = [
  { addressId: 'addr_1', status: 'ACTIVE', isDefault: true, contact: { name: '测试收货人甲', phone: '13800138000' }, regionText: '测试省 测试市', detail: '测试路1号' },
  { addressId: 'addr_2', status: 'ACTIVE', isDefault: false, contact: { name: '测试收货人乙', phone: '13900139000' }, regionText: '测试省 测试市', detail: '测试路2号' },
]
const ok = (route, data) => route.fulfill({ json: { code: 0, message: 'ok', data } })
const emptyList = { list: [], pageNum: 1, pageSize: 20, total: 0 }

async function mockApi(page, options = {}) {
  const requests = []
  const unexpected = []
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = request.postDataJSON()
    requests.push({ path, method, body, headers: request.headers() })
    if (path === '/api/master-data/qualities') return ok(route, { items: [{ code: 'ORIGINAL_BRAND', name: '原厂' }, { code: 'OTHER_BRAND', name: '其他' }] })
    if (path === '/api/addresses') {
      if (options.addressFailure) return route.fulfill({ status: 503, json: { code: 50301, message: '地址加载失败' } })
      return ok(route, { ...emptyList, list: options.addresses ?? ADDRESSES, total: (options.addresses ?? ADDRESSES).length })
    }
    if (path === '/api/carts' || (path === '/api/inquiries' && method === 'GET')) return ok(route, emptyList)
    if (path.startsWith('/api/vehicles/vin/')) {
      if (options.recognize) return options.recognize(route, path.split('/').at(-1))
      return ok(route, { recognizeStatus: 'RECOGNIZED', vehicleModel: MODEL })
    }
    if (path === '/api/inquiry-drafts' && method === 'POST') return ok(route, { draftId: 'draft_test', version: 1 })
    if (path === '/api/inquiry-drafts/draft_test' && method === 'PATCH') return ok(route, { draftId: 'draft_test', version: body.version + 1 })
    if (path === '/api/inquiry-drafts/draft_test/items' && method === 'PUT') return ok(route, { version: body.version + 1 })
    if (path === '/api/inquiries' && method === 'POST') {
      if (options.publish) return options.publish(route)
      return ok(route, { inquiryId: 'inq_test', inquiryNo: 'TEST_ONLY', status: 'PUBLISHED' })
    }
    unexpected.push(`${method} ${path}`)
    return route.abort('blockedbyclient') // 绝不 fallback/continue 到真实服务
  })
  await page.goto('/#/publish')
  await expect(page.getByTestId('batch-quality').getByText('原厂', { exact: true })).toBeVisible()
  return {
    requests,
    writes: () => requests.filter((r) => r.method !== 'GET'),
    assertHealthy: async () => {
      expect(unexpected).toEqual([])
      expect(pageErrors).toEqual([])
      await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    },
  }
}

async function fillVehicle(page) {
  await page.getByTestId('vin-input').fill(VIN)
  await page.getByTestId('vin-input').press('Tab')
  await expect(page.getByTestId('vehicle-preview')).toContainText(MODEL.model)
}
async function fillForm(page) {
  await fillVehicle(page)
  await page.getByTestId('item-name-0').fill('前刹车片')
  await expect(page.getByTestId('publish-address')).toHaveValue('addr_1')
}

// 所有用例只验证 UI 和前端请求边界；独立配置的代理也不可触达业务服务。
test.describe('发布询价 · 隔离 UI/请求契约', () => {
  test('初始化四空行，仅地址联系方式；禁用未接通的上传入口', async ({ page }, info) => {
    const state = await mockApi(page)
    await expect(page.getByTestId('publish-item-row')).toHaveCount(4)
    for (let i = 0; i < 4; i++) {
      await expect(page.getByTestId(`item-name-${i}`)).toHaveValue('')
      await expect(page.getByTestId(`item-oe-${i}`)).toHaveValue('')
      await expect(page.getByTestId(`item-qty-${i}`)).toHaveValue(i === 0 ? '1' : '')
    }
    await expect(page.getByTestId('vin-input')).toHaveValue('')
    await expect(page.getByTestId('publish-contact-name')).toHaveCount(0)
    await expect(page.getByTestId('option-invoice-open')).toBeChecked()
    await expect(page.getByTestId('item-photo-0')).toBeDisabled()
    await expect(page.locator('.parts-work-order')).toBeDisabled()
    expect(state.writes()).toEqual([])
    await page.screenshot({ path: info.outputPath('publish-initial.png'), fullPage: true })
    await state.assertHealthy()
  })

  for (const invoice of [true, false]) test(`隐式草稿→发布：选中地址带 contact；isOpenInvoice=${invoice}`, async ({ page }, info) => {
    const state = await mockApi(page)
    await fillForm(page)
    await page.getByTestId('publish-plate-no').fill('云A12345')
    await page.getByTestId('publish-claim-no').fill('TEST_CLAIM')
    await page.getByTestId('publish-address').selectOption('addr_2')
    if (!invoice) await page.getByTestId('option-invoice-none').check()
    await page.getByTestId('item-oe-0').fill(' a0004202404 ')
    await page.getByTestId('item-name-1').fill('后刹车片')
    await page.getByTestId('item-qty-1').fill('2')
    await page.getByTestId('batch-quality').getByRole('checkbox', { name: '其他', exact: true }).check()
    await page.getByTestId('add-item').click()
    await expect(page.getByTestId('publish-item-row')).toHaveCount(5)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: info.outputPath('publish-filled.png'), fullPage: true })
    await page.getByTestId('step-publish').click()
    await expect(page).toHaveURL(/#\/inquiries\?highlight=inq_test$/)
    const [draft, publish] = state.writes()
    expect(state.writes()).toHaveLength(2)
    expect(draft.path).toBe('/api/inquiry-drafts')
    const { brandLogo, energyType, ...snapshot } = MODEL
    expect(draft.body).toEqual({ source: 'PC', vin: VIN, vehicleSnapshot: snapshot, plateNo: '云A12345', claimNo: 'TEST_CLAIM', items: [
      { requestId: expect.any(String), name: '前刹车片', quantity: 1, oeCode: 'A0004202404', qualityCodes: ['ORIGINAL_BRAND', 'OTHER_BRAND'], resourceIds: [] },
      { requestId: expect.any(String), name: '后刹车片', quantity: 2, qualityCodes: ['ORIGINAL_BRAND', 'OTHER_BRAND'], resourceIds: [] },
    ] })
    expect(publish.path).toBe('/api/inquiries')
    expect(publish.body).toEqual({ draftId: 'draft_test', version: 1, contact: ADDRESSES[1].contact, addressId: 'addr_2', publishOptions: {
      quotedType: 'SYSTEM', isOpenInvoice: invoice, isAnonymous: true, noReplacement: false, storeIds: [],
    } })
    expect(publish.headers['idempotency-key']).toMatch(/^[\w-]{8,128}$/)
    await state.assertHealthy()
  })

  for (const width of [1280, 1440]) test(`桌面 ${width}px：配件十列对齐，宽表仅容器内滚动`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const state = await mockApi(page)
    const head = page.locator('.inquiry-parts-head')
    const row = page.getByTestId('publish-item-row').first()
    await expect(head).toHaveCSS('display', 'grid')
    await expect(row).toHaveCSS('display', 'grid')
    for (let column = 0; column < 10; column++) {
      const headerBox = await head.locator(':scope > *').nth(column).boundingBox()
      const cellBox = await row.locator(':scope > *').nth(column).boundingBox()
      expect(Math.abs(headerBox.x - cellBox.x)).toBeLessThan(2)
    }
    expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(120)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await state.assertHealthy()
  })

  test('仅有 saleModelName 时车型回显与草稿发布校验一致', async ({ page }) => {
    const vehicleModel = { carBrandId: 'TEST', carBrandName: '测试品牌', saleModelName: '销售车型兜底' }
    const state = await mockApi(page, { recognize: (route) => ok(route, { recognizeStatus: 'RECOGNIZED', vehicleModel }) })
    await page.getByTestId('vin-input').fill(VIN)
    await page.getByTestId('vin-input').press('Enter')
    await expect(page.getByTestId('vehicle-preview')).toContainText('销售车型兜底')
    await page.getByTestId('item-name-0').fill('前刹车片')
    await page.getByTestId('step-publish').click()
    await expect(page).toHaveURL(/#\/inquiries\?highlight=inq_test/)
    expect(state.writes()[0].body.vehicleSnapshot).toEqual(vehicleModel)
    await state.assertHealthy()
  })

  for (const quantity of ['0', '-1', '1.5', '201', '']) test(`数量 ${quantity || '空'} 不可静默变成 1`, async ({ page }) => {
    const state = await mockApi(page)
    await fillForm(page)
    await page.getByTestId('item-qty-0').fill(quantity)
    await page.getByTestId('step-publish').click()
    await expect(page.getByTestId('error-box')).toContainText('数量需为 1–200 的整数')
    expect(state.writes()).toEqual([])
    await state.assertHealthy()
  })

  test('空配件和清空品质均拦截，不补测试配件/默认品质', async ({ page }) => {
    const state = await mockApi(page)
    await fillVehicle(page)
    await page.getByTestId('step-publish').click()
    await expect(page.getByTestId('error-box')).toContainText('请至少填写一个配件')
    await page.getByTestId('item-name-0').fill('前刹车片')
    await page.getByTestId('batch-quality').getByRole('checkbox', { name: '原厂', exact: true }).uncheck()
    await page.getByTestId('step-publish').click()
    await expect(page.getByTestId('error-box')).toContainText('请至少选择一种品质')
    expect(state.writes()).toEqual([])
    await state.assertHealthy()
  })

  for (const [label, options, message] of [
    ['无地址', { addresses: [] }, '请选择收货地址'],
    ['地址联系方式缺失', { addresses: [{ ...ADDRESSES[0], contact: { name: '', phone: '' } }] }, '所选收货地址缺少有效联系人'],
    ['地址加载失败', { addressFailure: true }, '收货地址加载失败'],
  ]) test(`${label}：不发写请求`, async ({ page }) => {
    const state = await mockApi(page, options)
    await fillVehicle(page)
    await page.getByTestId('item-name-0').fill('前刹车片')
    await page.getByTestId('step-publish').click()
    await expect(page.getByTestId('error-box').first()).toContainText(message)
    expect(state.writes()).toEqual([])
    await state.assertHealthy()
  })

  test('非法 VIN 和不完整车型不能发布', async ({ page }) => {
    const state = await mockApi(page, { recognize: (route) => ok(route, { recognizeStatus: 'RECOGNIZED', vehicleModel: { model: '缺少品牌' } }) })
    await page.getByTestId('vin-input').fill('ABC123')
    await page.getByTestId('step-publish').click()
    await expect(page.getByTestId('error-box')).toContainText('VIN 需为 17 位')
    await page.getByTestId('vin-input').fill(VIN)
    await page.getByTestId('vin-input').press('Enter')
    await expect(page.getByTestId('vehicle-preview')).toContainText('未获得完整可发布车型，请重新识别')
    await page.getByTestId('step-publish').click()
    await expect(page.getByTestId('error-box')).toContainText('请先完成当前 VIN 的车型识别')
    expect(state.writes()).toEqual([])
    await state.assertHealthy()
  })

  test('VIN 改变清空旧车型；旧识别晚返回不覆盖新 VIN', async ({ page }) => {
    let oldRoute
    const state = await mockApi(page, { recognize: async (route, vin) => {
      if (vin === VIN) { oldRoute = route; return }
      return ok(route, { recognizeStatus: 'RECOGNIZED', vehicleModel: { ...MODEL, model: '新车型' } })
    } })
    await page.getByTestId('vin-input').fill(VIN)
    await page.getByTestId('vin-input').press('Enter')
    await expect.poll(() => Boolean(oldRoute)).toBe(true)
    await page.getByTestId('vin-input').fill(OTHER_VIN)
    await expect(page.getByTestId('vehicle-preview')).toHaveCount(0)
    await page.getByTestId('vin-input').press('Enter')
    await expect(page.getByTestId('vehicle-preview')).toContainText('新车型')
    await ok(oldRoute, { recognizeStatus: 'RECOGNIZED', vehicleModel: { ...MODEL, model: '旧车型' } })
    await expect(page.getByTestId('vehicle-preview')).toContainText('新车型')
    await page.getByTestId('item-name-0').fill('前刹车片')
    await page.getByTestId('step-publish').click()
    await expect(page).toHaveURL(/highlight=inq_test/)
    expect(state.writes()[0].body.vehicleSnapshot.model).toBe('新车型')
    expect(state.writes()[0].body.vin).toBe(OTHER_VIN)
    await state.assertHealthy()
  })

  test('发布中禁止重复点击/修改；失败保留输入，修改后顺序更新版本', async ({ page }) => {
    let publishRoute
    const state = await mockApi(page, { publish: (route) => { publishRoute = route } })
    await fillForm(page)
    await page.getByTestId('step-publish').click()
    await expect.poll(() => Boolean(publishRoute)).toBe(true)
    await expect(page.getByTestId('step-publish')).toBeDisabled()
    await expect(page.getByTestId('vin-input')).toBeDisabled()
    await expect(page.getByTestId('publish-address')).toBeDisabled()
    await publishRoute.fulfill({ status: 422, json: { code: 42248, message: '测试发布失败' } })
    await expect(page.getByTestId('error-box')).toContainText('测试发布失败')
    await expect(page).toHaveURL(/#\/publish$/)
    await expect(page.getByTestId('item-name-0')).toHaveValue('前刹车片')
    await page.getByTestId('publish-plate-no').fill('云A12345')
    await page.getByTestId('item-qty-0').fill('2')
    publishRoute = undefined
    await page.getByTestId('step-publish').click()
    await expect.poll(() => Boolean(publishRoute)).toBe(true)
    const writes = state.writes()
    expect(writes.map((r) => r.method)).toEqual(['POST', 'POST', 'PATCH', 'PUT', 'POST'])
    expect(writes[2].body.version).toBe(1)
    expect(writes[3].body.version).toBe(2)
    expect(writes[4].body.version).toBe(3)
    await ok(publishRoute, { inquiryId: 'inq_test', inquiryNo: 'TEST_ONLY', status: 'PUBLISHED' })
    await expect(page).toHaveURL(/highlight=inq_test/)
    await state.assertHealthy()
  })
})
