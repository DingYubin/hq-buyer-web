// 端到端测试公共工具：直连真实后端（/api 由 Vite 代理到联调栈 buyerUrl），不做任何 mock。
// 身份：买家 Bearer mock-buyer（= 联调栈里的底层 userLoginId/companyId）。
import { expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

export const BUYER = { Authorization: 'Bearer mock-buyer' }

/** 品质字典 code：design20 主数据只登记 ORIGINAL_BRAND（展示名「原厂」）。 */
export const QUALITY_CODE = 'ORIGINAL_BRAND'
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

export const INQUIRY_COLUMNS = ['询价单号', '车辆信息 / VIN', '车牌号', '报案号', '配件信息', '发布时间', '状态', '操作']
export const ADDRESS_COLUMNS = ['收货人', '所在地区', '详细地址', '手机号', '固定号码', '操作']
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

/** 本地联调白名单内的图片 URL：DIRECT 发布要求带齐图片要求接口列出的车辆照片。 */
export const DIRECT_VIN_PICTURE = 'https://mobile.example.com/vin/test/success/vin.jpg'
export const DIRECT_NAMEPLATE_PICTURE = 'https://upload.example.com/test/agentBuy/nameplate.jpg'

/** DIRECT 发布要求地址已绑定上游（syncState.externalBindingRef），这里取当前组织的默认地址。 */
export async function defaultAddress(request) {
  const data = await apiOk(request, '/api/addresses?pageNum=1&pageSize=100&status=ACTIVE')
  const address = (data.list || []).find((row) => row.isDefault) || (data.list || [])[0]
  if (!address) throw new Error('联调栈没有可用收货地址，无法发布 DIRECT 询价')
  return address
}

/** 识别车型后只保留 DIRECT 快照白名单字段（brandLogo/energyType 等展示字段服务端不接受）。 */
function toVehicleSnapshot(vehicleModel = {}) {
  const keep = [
    'model', 'carBrandId', 'carBrandName', 'saleModelCode', 'saleModelName',
    'seriesId', 'seriesZh', 'seriesEn', 'epcModelCode', 'locationId', 'locationName',
  ]
  const snapshot = {}
  for (const key of keep) {
    if (typeof vehicleModel[key] === 'string' && vehicleModel[key].trim()) {
      snapshot[key] = vehicleModel[key].trim()
    }
  }
  return snapshot
}

/**
 * 造一条「已发布」询价单：识别 VIN → 单次 POST /api/inquiries 直发（publishMode=DIRECT）。
 * 与前端发布页共用同一条契约；旧草稿链（/api/inquiry-drafts）在 design20 已不开放。
 */
export async function seedPublishedInquiry(request, overrides = {}) {
  const vin = overrides.vin || randomVin()
  const itemName = overrides.itemName || '前保险杠'
  const oeCode = overrides.oeCode || '51117379491'
  const quantity = overrides.quantity || 1
  const requestId = `req_${compact().slice(0, 12)}`

  const [recognition, address] = await Promise.all([
    apiOk(request, `/api/vehicles/vin/${vin}`),
    defaultAddress(request),
  ])
  expect(recognition.recognizeStatus, `VIN ${vin} 应能识别出车型`).toBe('RECOGNIZED')
  const vehicleSnapshot = toVehicleSnapshot(recognition.vehicleModel)

  const published = await apiOk(request, '/api/inquiries', {
    method: 'POST',
    headers: BUYER,
    idempotencyKey: newKey(),
    data: {
      publishMode: 'DIRECT',
      source: 'PC',
      vin,
      vehicleSnapshot,
      vinPicture: DIRECT_VIN_PICTURE,
      inquiryAdditionalImages: [
        { mediaType: 'PICTURE', typeId: 'NAMEPLATE', url: DIRECT_NAMEPLATE_PICTURE },
      ],
      items: [{ requestId, name: itemName, oeCode, quantity, qualityCodes: [QUALITY_CODE] }],
      contact: CONTACT,
      addressId: address.addressId,
      publishOptions: { quotedType: 'SYSTEM', isOpenInvoice: true },
    },
  })

  // 发布响应只有单号与版本；配件 ID（报价选择 / 购物车按它对齐）在详情接口里。
  const detail = await apiOk(request, `/api/inquiries/${published.inquiryId}`)
  const inquiryItemId = detail.items?.[0]?.inquiryItemId
  expect(inquiryItemId, '发布后的询价详情应返回配件行').toBeTruthy()

  return {
    vin,
    itemName,
    oeCode,
    quantity,
    itemCount: 1, // seedPublishedInquiry 固定写入 1 行配件
    vehicleSnapshot,
    inquiryId: published.inquiryId,
    inquiryNo: published.inquiryNo,
    inquiryItemId,
    inquiryVersion: detail.version,
  }
}

/**
 * 造一条「已报价」询价单：发布后由卖家服务定时拉取外部报价源聚合进报价投影，
 * 买方只读 GET /api/inquiries/{id}/quotations（不调用内部注入接口，也不自造报价）。
 */
export async function seedQuotedInquiry(request, overrides = {}) {
  const base = await seedPublishedInquiry(request, overrides)
  const timeoutAt = Date.now() + 20_000
  let line = null
  let version = base.inquiryVersion
  while (!line && Date.now() < timeoutAt) {
    const data = await apiOk(
      request,
      `/api/inquiries/${base.inquiryId}/quotations?pageNum=1&pageSize=100&groupBy=PART&sort=MATCH`,
    )
    line = (data.list || [])[0] || null
    version = data.version ?? version
    if (!line) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  expect(line, `询价 ${base.inquiryNo} 在 20s 内没有被同步出报价（卖家拉取链路）`).toBeTruthy()

  return {
    ...base,
    sellAmount: line.sellAmount,
    availableQuantity: line.availableQuantity,
    quotationId: line.quotationId,
    quotationItemId: line.quotationItemId,
    inquiryItemId: line.inquiryItemId ?? base.inquiryItemId,
    inquiryVersion: version,
  }
}

/**
 * 造一个「恰好 1 行可结算（NORMAL）」的 ACTIVE 购物车（基于新造的已报价询价单）。
 *
 * 买方组织在同一时刻只有一张 ACTIVE 车（uq_carts_buyer_owner_active），
 * 重复 `POST /api/carts` 会复用同一张车；而已经生成订单的行（itemStatus=CONVERTED）
 * 按契约不可删除，会长期留在车里（历史用例下单后的正常结果）。
 * 因此这里先清掉历史 NORMAL 行，再断言时只看 NORMAL 行：
 * 返回的 normalRows/line 就是本次用例可操作的唯一一行。
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
  if ((beforeClear.list || []).some((row) => row.itemStatus === 'NORMAL')) {
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
  const normalRows = detail.list.filter((row) => row.itemStatus === 'NORMAL')
  const lockedRows = detail.list.filter((row) => row.itemStatus !== 'NORMAL')
  expect(normalRows.length, `加购后应有且仅有 1 行 NORMAL，实际 ${detail.list.map((row) => row.itemStatus).join('/')}`).toBe(1)
  return {
    ...quote,
    cartId: created.cartId,
    cartVersion: detail.version,
    addedCount: added.addedCount,
    detail,
    normalRows,
    lockedRows,
    line: normalRows[0],
  }
}

/** 行金额合计（服务端口径：排除 INVALID 行，CONVERTED 行仍计入全量合计）。 */
export function remainingItemsAmount(rows) {
  const total = rows.filter((row) => !row.invalidReason).reduce((sum, row) => sum + Number(row.unitPrice) * row.quantity, 0)
  return total.toFixed(2)
}
