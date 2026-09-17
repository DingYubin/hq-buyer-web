// 端到端测试公共工具：直连真实后端（/api 由 Vite 代理到 http://localhost:3002），不做任何 mock。
// 身份：买家 Bearer mock-buyer；内部报价注入用 Bearer mock-hq（quotation:ingest 权限）。
import { expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

export const BUYER = { Authorization: 'Bearer mock-buyer' }
export const HQ = { Authorization: 'Bearer mock-hq' }

export const QUALITY_CODE = 'MOCK_ORIGINAL'
export const CHANNEL_ORG_ID = 'mock-channel'
export const CONTACT = { name: '况承泽', phone: '13058093388' }

export const INQUIRY_STATUS_LABEL = {
  DRAFT: '草稿',
  PUBLISHED: '待报价',
  QUOTING: '报价中',
  PARTIALLY_QUOTED: '部分报价',
  QUOTED: '已报价',
  WITHDRAWN: '已撤回',
  EXPIRED: '已过期',
  ORDERED: '已下单',
}

export const SYNC_STATUS_LABEL = {
  SYNC_PENDING: '同步中',
  SYNCED: '已同步',
  SYNC_FAILED: '同步失败',
}

export const CART_ITEM_STATUS_LABEL = { NORMAL: '可结算', INVALID: '已失效', CONVERTED: '已转订单' }

export const INQUIRY_COLUMNS = ['询价单号', '状态', '配件数', 'VIN', '车牌号', '报案号', '询价时间', '报价截止', '操作']
export const ADDRESS_COLUMNS = ['收货人', '所在地区', '详细地址', '手机号', '固定号码', '同步状态', '操作']
export const INQUIRY_TABS = ['全部', '待报价', '报价中', '已报价', '已下单', '已撤回/过期']
export const ADDRESS_TABS = ['正常', '已停用', '全部']

export const newKey = () => randomUUID()
const compact = () => randomUUID().replace(/-/g, '')

/** 17 位合法 VIN：不含 I/O/Q，避免各用例互相撞单。 */
export function randomVin() {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
  let vin = 'LSG'
  for (let i = 0; i < 14; i += 1) vin += alphabet[Math.floor(Math.random() * alphabet.length)]
  return vin
}

/** 与前端 src/lib/format.js 完全一致的金额格式，用于断言页面文案。 */
export function amount(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  return number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const money = (value) => `¥${amount(value)}`

const pad = (value) => String(value).padStart(2, '0')

/** 与页面一致：UTC → 本地 YYYY-MM-DD HH:mm。 */
export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 统一请求封装：返回状态码 + 原始包体，便于断言 { code, message } / { code, message, data }
export async function api(request, path, { method = 'GET', headers = BUYER, data, idempotencyKey } = {}) {
  const finalHeaders = { ...headers }
  if (idempotencyKey) finalHeaders['Idempotency-Key'] = idempotencyKey
  if (data !== undefined) finalHeaders['Content-Type'] = 'application/json'
  const response = await request.fetch(path, { method, headers: finalHeaders, data })
  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  return { response, status: response.status(), payload, text }
}

// 成功响应：HTTP 2xx 且 code=0，返回 data
export async function apiOk(request, path, options = {}) {
  const method = options.method || 'GET'
  const result = await api(request, path, options)
  expect(
    result.response.ok(),
    `${method} ${path} 期望 HTTP 2xx，实际 HTTP ${result.status}：${result.text.slice(0, 300)}`,
  ).toBeTruthy()
  expect(result.payload?.code, `${method} ${path} 期望 code=0，实际 ${result.text.slice(0, 300)}`).toBe(0)
  return result.payload.data
}

// 失败响应：按契约只返回 { code, message }，且不含 data
export async function apiFail(request, path, expectedCode, options = {}) {
  const result = await api(request, path, options)
  expect(
    result.payload?.code,
    `${options.method || 'GET'} ${path} 期望 code=${expectedCode}，实际 HTTP ${result.status}：${result.text.slice(0, 300)}`,
  ).toBe(expectedCode)
  expect(result.payload).not.toHaveProperty('data')
  return result.payload
}

// 后端 3002 未启动时给出明确报错，而不是一堆看不懂的超时
export async function requireBackend(request) {
  let result
  try {
    result = await api(request, '/api/inquiries?pageNum=1&pageSize=1')
  } catch (error) {
    throw new Error(
      `买方后端不可达：/api 代理目标 http://localhost:3002 连接失败（${error.message}）。` +
        '请先启动 hq-buyer-service 再执行 npm run test:e2e。',
    )
  }
  if (!result.response.ok() || result.payload?.code !== 0) {
    throw new Error(
      `买方后端未就绪：GET /api/inquiries 返回 HTTP ${result.status}，包体 ${result.text.slice(0, 300)}。` +
        '请先启动 hq-buyer-service（端口 3002）再执行 npm run test:e2e。',
    )
  }
}

export async function openPage(page, route) {
  await page.goto(`/#/${route}`)
  await expect(page.locator('#root')).not.toBeEmpty()
}

/** 断言页面元素的 DOM 顺序（字段顺序 = 页面展示顺序）。 */
export async function expectTestIdOrder(container, orderedTestIds) {
  const actual = await container.evaluate((node) =>
    Array.from(node.querySelectorAll('[data-testid]')).map((el) => el.dataset.testid),
  )
  const indexes = orderedTestIds.map((id) => {
    const index = actual.indexOf(id)
    expect(index, `页面缺少 data-testid=${id}`).toBeGreaterThanOrEqual(0)
    return index
  })
  const sorted = [...indexes].sort((a, b) => a - b)
  expect(indexes, `字段顺序不符合契约：期望 ${orderedTestIds.join(' → ')}，实际 ${actual.join(' → ')}`).toEqual(sorted)
}

/** toast 断言前先等它消失，避免上一条提示干扰下一条。 */
export async function waitToastGone(page) {
  await expect(page.getByTestId('toast')).toHaveCount(0)
}

/**
 * 造一条「已发布」询价单：建草稿 → 存配件 → 发布。返回后续链路需要的 id。
 * 全部走真实接口（POST /api/inquiry-drafts → PUT items → POST /api/inquiries）。
 */
export async function seedPublishedInquiry(request, overrides = {}) {
  const vin = overrides.vin || randomVin()
  const itemName = overrides.itemName || '前保险杠'
  const oeCode = overrides.oeCode || '51117379491'
  const quantity = overrides.quantity || 1

  const draft = await apiOk(request, '/api/inquiry-drafts', {
    method: 'POST',
    headers: BUYER,
    idempotencyKey: newKey(),
    data: { source: 'PC', vin, contact: CONTACT, items: [] },
  })
  const draftId = draft.inquiryId || draft.draftId

  const saved = await apiOk(request, `/api/inquiry-drafts/${draftId}/items`, {
    method: 'PUT',
    headers: BUYER,
    idempotencyKey: newKey(),
    data: {
      version: draft.version,
      items: [
        {
          requestId: `req_${compact().slice(0, 12)}`,
          name: itemName,
          oeCode,
          quantity,
          qualityCodes: [QUALITY_CODE],
          resourceIds: [],
        },
      ],
    },
  })
  const inquiryItemId = saved.acceptedItems[0].inquiryItemId

  const published = await apiOk(request, '/api/inquiries', {
    method: 'POST',
    headers: BUYER,
    idempotencyKey: newKey(),
    data: {
      draftId,
      version: saved.version,
      contact: CONTACT,
      publishOptions: {
        quotedType: 'SYSTEM',
        isAnonymous: true,
        noReplacement: false,
        selectedChannelOrgIds: [],
      },
    },
  })

  return {
    vin,
    itemName,
    oeCode,
    quantity,
    draftId,
    inquiryId: published.inquiryId,
    inquiryNo: published.inquiryNo,
    inquiryItemId,
    inquiryVersion: published.version,
  }
}

/**
 * 造一条「已报价」询价单：发布后由 mock-hq 通过内部接口注入报价。
 * 返回报价结果 / 购物车 / 订单链路需要的全部 id。
 */
export async function seedQuotedInquiry(request, overrides = {}) {
  const base = await seedPublishedInquiry(request, overrides)
  const sellAmount = overrides.sellAmount || '1200.00'
  const availableQuantity = overrides.availableQuantity || 5

  const quotationId = `qt_${compact().slice(0, 16)}`
  const quotationItemId = `qi_${compact().slice(0, 16)}`
  const ingested = await apiOk(request, '/api/internal/inquiry-quotation-results', {
    method: 'POST',
    headers: HQ, // 内部接口：必须 mock-hq，channelOrgId 必须是绑定关系里的渠道组织
    data: {
      eventId: `evt_${compact().slice(0, 16)}`,
      inquiryId: base.inquiryId,
      channelOrgId: CHANNEL_ORG_ID,
      quotationId,
      revision: 1,
      supplierRef: 'sup_1',
      status: 'VALID',
      validUntil: '2026-12-31T00:00:00Z',
      items: [
        {
          quotationItemId,
          inquiryItemId: base.inquiryItemId,
          qualityCode: QUALITY_CODE,
          sellAmount,
          currency: 'CNY',
          availableQuantity,
          stockStatus: 'AVAILABLE',
          leadTimeDays: 2,
        },
      ],
    },
  })

  return {
    ...base,
    sellAmount,
    availableQuantity,
    quotationId,
    quotationItemId,
    inquiryVersion: ingested.version,
  }
}

/**
 * 造一个「恰好 1 行」的 ACTIVE 购物车（基于新造的已报价询价单）。
 *
 * 买方组织在同一时刻只有一张 ACTIVE 车（uq_carts_buyer_owner_active），
 * 重复 `POST /api/carts` 会复用同一张车，因此这里先按 version 清空，
 * 保证用例断言行数时不受历史遗留行影响。
 */
export async function seedCart(request, overrides = {}) {
  const quote = await seedQuotedInquiry(request, overrides)
  const created = await apiOk(request, '/api/carts', {
    method: 'POST',
    headers: BUYER,
    idempotencyKey: newKey(),
    data: { source: 'QUOTATION', inquiryIds: [quote.inquiryId] },
  })
  const beforeClear = await apiOk(request, `/api/carts/${created.cartId}?pageNum=1&pageSize=100`)
  if ((beforeClear.list || []).length > 0) {
    await apiOk(request, `/api/carts/${created.cartId}/clear`, {
      method: 'POST',
      headers: BUYER,
      idempotencyKey: newKey(),
      data: { scope: 'ALL', version: beforeClear.version },
    })
  }
  const added = await apiOk(request, `/api/carts/${created.cartId}/items`, {
    method: 'POST',
    headers: BUYER,
    idempotencyKey: newKey(),
    data: {
      items: [{ inquiryItemId: quote.inquiryItemId, quotationItemId: quote.quotationItemId, quantity: quote.quantity }],
    },
  })
  const detail = await apiOk(request, `/api/carts/${created.cartId}?pageNum=1&pageSize=100`)
  return { ...quote, cartId: created.cartId, cartVersion: detail.version, addedCount: added.addedCount, detail }
}
