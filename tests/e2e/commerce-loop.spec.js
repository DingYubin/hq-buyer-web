// 买家交易闭环端到端验收（真实 buyer + seller 进程 + 隔离内存 Mongo，外部报价来源为本地 HTTP 桩）：
// 报价结果 → 选报价 → 加购 → 购物车 → 确认订单 → 提交 → 卖家后管可见。
//
// 前置：在 hq-buyer-service 执行 `npm run dev:commerce-stack`，
// 该脚本会落盘联调描述文件（默认 /tmp/hq-local-commerce-stack.json），
// 再把 Vite 的 /api 代理指向描述文件里的 buyerUrl：
//   VITE_PROXY_TARGET=http://127.0.0.1:<buyerPort> npm run test:e2e -- tests/e2e/commerce-loop.spec.js
// 身份沿用联调约定：买家 Bearer mock-buyer（= 底层 userLoginId/companyId），卖家 Bearer mock-seller-hq。
// 数据隔离：每个用例独占描述文件 inquiries[] 里的一张询价单（提交会消耗报价配额与询价单状态）。
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const DESCRIPTOR_PATH = process.env.COMMERCE_STACK_DESCRIPTOR || '/tmp/hq-local-commerce-stack.json'
const SELLER_HEADERS = { authorization: 'Bearer mock-seller-hq', 'x-mock-user': 'mock-seller-hq' }

let stack

/** 描述文件由 hq-buyer-service 的 dev:commerce-stack 写入；缺失说明联调栈没起来。 */
function readDescriptor() {
  try {
    return JSON.parse(readFileSync(DESCRIPTOR_PATH, 'utf8'))
  } catch (error) {
    throw new Error(
      `交易闭环联调栈未就绪：无法读取 ${DESCRIPTOR_PATH}（${error.message}）。` +
        '请先在 hq-buyer-service 执行 npm run dev:commerce-stack，再用描述文件里的 buyerUrl 作为 VITE_PROXY_TARGET。',
    )
  }
}

const cartIdOf = (page) => {
  const matched = /cartId=([^&]+)/.exec(page.url())
  expect(matched, 'URL 应带 cartId').toBeTruthy()
  return decodeURIComponent(matched[1])
}

/** 报价结果页勾选唯一报价行 → 加入购物车，停在购物车页。 */
async function addQuoteToCart(page, inquiryId) {
  await page.goto(`/#/quotation-result?inquiryId=${inquiryId}`)
  await expect(page.getByTestId('quote-total')).toHaveText('1')
  await page.getByTestId('tab-by-part').click()
  const row = page.getByTestId('quote-row')
  await expect(row).toHaveCount(1)
  await row.getByTestId('quote-select').click()
  await expect(page.getByTestId('selection-count')).toHaveText('1')
  await page.getByTestId('save-selection').click()
  await expect(page).toHaveURL(/#\/cart\?cartId=/, { timeout: 30_000 })
  await expect(page.getByTestId('cart-layout')).toBeVisible()
  return cartIdOf(page)
}

/**
 * 购物车勾选本次用例的可结算行 → 去结算，停在确认订单页，返回被勾选的 cartItemId。
 * 同一组织的 ACTIVE 车是共享的：历史用例下单留下的 CONVERTED 行不可勾选，必须按状态过滤。
 */
async function checkout(page) {
  const rows = page.locator('[data-testid="cart-row"][data-item-status="NORMAL"]')
  await expect(rows).not.toHaveCount(0)
  const row = rows.first()
  const cartItemId = await row.getAttribute('data-cart-item-id')
  expect(cartItemId, '购物车行应带 cartItemId').toBeTruthy()
  await row.getByTestId('cart-row-check').check()
  await expect(page.getByTestId('cart-checkout')).toBeEnabled()
  await page.getByTestId('cart-checkout').click()
  await expect(page).toHaveURL(/#\/order-confirm\?cartId=/, { timeout: 30_000 })
  return cartItemId
}

/** 填平必填项并等待服务端预览金额（前端不自行算钱）。 */
async function fillAndPreview(page) {
  await page.getByTestId('invoice-title').fill('本地联调自动化测试有限公司')
  await expect(page.getByTestId('totals-grand-total')).not.toHaveText('—', { timeout: 30_000 })
  await expect(page.getByTestId('order-submit')).toBeEnabled()
  return (await page.getByTestId('order-grand-total').textContent()).trim()
}

/** 卖家后管订单列表（真实 seller 服务；未审批的单据按契约不下发）。 */
async function sellerOrders(request) {
  const placedFrom = new Date(Date.now() - 3600_000).toISOString()
  const placedTo = new Date(Date.now() + 3600_000).toISOString()
  const response = await request.fetch(
    `${stack.sellerUrl}/api/supplier/orders?placedFrom=${placedFrom}&placedTo=${placedTo}`,
    { headers: SELLER_HEADERS },
  )
  const payload = await response.json()
  expect(response.status(), JSON.stringify(payload)).toBe(200)
  expect(payload.code).toBe(0)
  return payload.data.list
}

/** 买家侧直连接口（走 Vite 代理 = 页面同一条链路）。 */
async function buyerApi(request, path, { headers = {}, ...options } = {}) {
  const response = await request.fetch(path, {
    ...options,
    headers: { Authorization: 'Bearer mock-buyer', ...headers },
  })
  const payload = await response.json()
  expect(response.status(), JSON.stringify(payload)).toBe(200)
  expect(payload.code).toBe(0)
  return payload.data
}

/** 点击「提交订单」并返回该次 POST /api/orders 的响应（不匹配 /orders/preview）。 */
function submitOrder(page) {
  return Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/orders$/.test(new URL(response.url()).pathname),
      { timeout: 30_000 },
    ),
    page.getByTestId('order-submit').click(),
  ])
}

test.describe('买家交易闭环（真实服务 + 隔离 Mongo）', () => {
  test.beforeAll(() => {
    stack = readDescriptor()
    for (const key of ['buyerUrl', 'sellerUrl', 'inquiryId', 'userId', 'defaultAddressId'])
      expect(stack[key], `描述文件缺少 ${key}`).toBeTruthy()
    // 单询价单的旧描述文件仍可读：回退成同一张单（用例间会互相消耗，仅用于快速排查）。
    stack.inquiries = stack.inquiries?.length ? stack.inquiries : [{ inquiryId: stack.inquiryId }]
  })

  /**
   * 领一张用例独占的询价单。提交会消耗报价配额与询价单状态，用例之间不能共用；
   * 常驻栈用控制面按需补发（反复跑测试不用重启栈），没有控制面时按描述文件顺序取。
   */
  let fallbackSlot = 0
  async function claimInquiry(request) {
    if (!stack.controlUrl) return stack.inquiries[fallbackSlot++ % stack.inquiries.length]
    const response = await request.fetch(`${stack.controlUrl}/inquiries`, { method: 'POST' })
    const payload = await response.json()
    expect(response.status(), JSON.stringify(payload)).toBe(200)
    expect(payload.data?.inquiryId, '控制面应返回新询价单').toBeTruthy()
    return payload.data
  }

  test('报价结果 → 购物车 → 确认订单 → 提交：订单落到卖家库并出现在卖家后管', async ({
    page,
    request,
  }) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })

    const cartId = await addQuoteToCart(page, (await claimInquiry(request)).inquiryId)
    const checkedItemId = await checkout(page)
    const previewTotal = await fillAndPreview(page)

    const [submitted] = await submitOrder(page)
    expect(submitted.status()).toBe(200)
    await expect(page.getByTestId('order-success')).toBeVisible({ timeout: 30_000 })
    const orderNo = (await page.getByTestId('order-success-no').textContent()).trim()
    expect(orderNo).toMatch(/^HQO\d{8}[0-9A-F]{16}$/)
    // 提交后的金额必须等于服务端预览结果，前端不做二次计算。
    await expect(page.getByTestId('order-success-total')).toHaveText(previewTotal)

    // 买家库：本次提交的行转为已转订单，不再可结算（共享车里可能存在其他用例的历史行）。
    const cart = await buyerApi(request, `/api/carts/${cartId}?pageNum=1&pageSize=100`)
    const submittedRows = cart.list.filter((row) => row.cartItemId === checkedItemId)
    expect(submittedRows, `购物车应仍能读到 ${checkedItemId}`).toHaveLength(1)
    expect(submittedRows[0].itemStatus).toBe('CONVERTED')

    // 卖家库：订单可查，且展示状态为待发货。
    const rows = await sellerOrders(request)
    const matched = rows.filter((row) => row.orderNo === orderNo)
    expect(matched, `卖家后管应能查到 ${orderNo}`).toHaveLength(1)
    expect(matched[0].status).toBe('PENDING_SHIPMENT')
    // 卖家列表的展示字段是 statusLabel（statusName 是卖家详情 DTO 的字段，列表不返回）。
    expect(matched[0].statusLabel).toBe('待发货')

    expect(pageErrors, `页面不应有 JS/控制台错误：${pageErrors.join(' | ')}`).toEqual([])
  })

  test('提交中断后重试：同一份包体复用同一个幂等键，订单只落一单', async ({
    page,
    request,
  }) => {
    const keys = []
    let interrupted = false
    await page.route('**/api/orders', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      keys.push(route.request().headers()['idempotency-key'])
      if (!interrupted) {
        interrupted = true
        return route.abort('failed')
      }
      return route.continue()
    })

    await addQuoteToCart(page, (await claimInquiry(request)).inquiryId)
    await checkout(page)
    await fillAndPreview(page)

    // 第一次提交在网络层失败：用户看到错误、仍停留在确认页。
    await page.getByTestId('order-submit').click()
    await expect(page.getByTestId('error-box')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('order-success')).toHaveCount(0)

    // 第二次提交（包体未变）：必须复用同一个幂等键，服务端只落一单。
    const [retried] = await submitOrder(page)
    expect(retried.status()).toBe(200)
    await expect(page.getByTestId('order-success')).toBeVisible({ timeout: 30_000 })
    const orderNo = (await page.getByTestId('order-success-no').textContent()).trim()

    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
    expect(keys[1], '同一包体重试必须复用幂等键').toBe(keys[0])

    const matched = (await sellerOrders(request)).filter((row) => row.orderNo === orderNo)
    expect(matched, '同键重试不应产生第二张订单').toHaveLength(1)
  })

  test('预览后购物车被其他端改动：提交被拒（40911）并引导回购物车，不落单', async ({
    page,
    request,
  }) => {
    const cartId = await addQuoteToCart(page, (await claimInquiry(request)).inquiryId)
    await checkout(page)
    await fillAndPreview(page)

    // 预览之后在服务端清空购物车（版本 +1）：页面手里的 version/previewToken 变成过期快照。
    const before = await buyerApi(request, `/api/carts/${cartId}?pageNum=1&pageSize=100`)
    await buyerApi(request, `/api/carts/${cartId}/clear`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mock-buyer',
        'Content-Type': 'application/json',
        'Idempotency-Key': `ui-drift-${Date.now()}`,
      },
      data: { scope: 'ALL', version: before.version },
    })
    const after = await buyerApi(request, `/api/carts/${cartId}?pageNum=1&pageSize=100`)
    expect(after.version).toBeGreaterThan(before.version)

    const ordersBefore = (await sellerOrders(request)).length
    const [rejected] = await submitOrder(page)
    // 契约（buyer-order-confirm.html）：版本比对失败返回 409 + 40911，页面不得出现提交成功。
    expect(rejected.status()).toBe(409)
    expect((await rejected.json()).code).toBe(40911)
    await expect(page.getByTestId('order-success')).toHaveCount(0)
    // 页面按契约回读购物车：勾选行已消失 → 提示改动并禁用提交（不回退成旧快照下单）。
    await expect(page.getByTestId('order-cart-changed')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('order-submit')).toBeDisabled()
    expect(await sellerOrders(request), '版本冲突不得落单').toHaveLength(ordersBefore)
  })
})
