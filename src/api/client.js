// 买方端（PC / App 共用）API 封装。
// 契约来源：hq_spc/docs/frontend-api-html/buyer-{publish,inquiry-list,quotation-result,cart,order-confirm,address}.html
// 统一包体：成功 { code: 0, message: 'ok', data }；失败仅 { code, message }，
// 失败 code = HTTP 状态码 × 100 + 业务编号（40911 版本冲突 / 41001 预览失效 / 42230 校验失败…）。
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

const MOCK_USER_KEY = 'hq-buyer.mock-user'

export const MOCK_USERS = [
  { value: 'mock-buyer', label: '买方组织（mock-buyer）' },
  { value: 'mock-other-org', label: '其它买方组织（mock-other-org）' },
]

function readStoredMockUser() {
  try {
    return window.localStorage.getItem(MOCK_USER_KEY) || 'mock-buyer'
  } catch {
    return 'mock-buyer'
  }
}

let mockUser = typeof window === 'undefined' ? 'mock-buyer' : readStoredMockUser()

export function setMockUser(next) {
  mockUser = next
  try {
    window.localStorage.setItem(MOCK_USER_KEY, next)
  } catch {
    /* ignore */
  }
}

export function getMockUser() {
  return mockUser
}

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

// 幂等键：写操作建议携带；长度 8–128，字符集 [A-Za-z0-9._:-]
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// 数组参数按契约输出为 status[]=A&status[]=B
export function buildQuery(params) {
  if (!params) return ''
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null || item === '') return
        search.append(`${key}[]`, item)
      })
      return
    }
    search.append(key, value)
  })
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

async function request(path, { method = 'GET', body, params, idempotencyKey, headers } = {}) {
  const finalHeaders = {
    Accept: 'application/json',
    // 非生产联调身份：readHeaders 契约要求 Authorization 必填
    Authorization: `Bearer ${mockUser}`,
    ...(headers || {}),
  }
  if (idempotencyKey) finalHeaders['Idempotency-Key'] = idempotencyKey
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}${buildQuery(params)}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'omit',
  })

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!response.ok || (payload && payload.code !== 0)) {
    const code = payload?.code ?? response.status * 100
    throw new ApiError(payload?.message || `请求失败（HTTP ${response.status}）`, code, response.status)
  }
  return payload ? payload.data : null
}

export const api = {
  // ---------- 发布询价（buyer-publish.html） ----------
  recognizeVin: (vin) => request(`/vehicles/vin/${encodeURIComponent(vin)}`),
  listQualities: () => request('/master-data/qualities'),
  createDraft: (body, key = newIdempotencyKey()) =>
    request('/inquiry-drafts', { method: 'POST', body, idempotencyKey: key }),
  getDraft: (draftId) => request(`/inquiry-drafts/${draftId}`),
  patchDraft: (draftId, body, key = newIdempotencyKey()) =>
    request(`/inquiry-drafts/${draftId}`, { method: 'PATCH', body, idempotencyKey: key }),
  saveDraftItems: (draftId, body, key = newIdempotencyKey()) =>
    request(`/inquiry-drafts/${draftId}/items`, { method: 'PUT', body, idempotencyKey: key }),
  addDraftItems: (draftId, body, key = newIdempotencyKey()) =>
    request(`/inquiry-drafts/${draftId}/items`, { method: 'POST', body, idempotencyKey: key }),
  mergePreview: (draftId, body, key = newIdempotencyKey()) =>
    request(`/inquiry-drafts/${draftId}/merge-preview`, { method: 'POST', body, idempotencyKey: key }),
  getDraftAppendOptions: (draftId) => request(`/inquiry-drafts/${draftId}/append-options`),
  appendDraftResources: (draftId, body, key = newIdempotencyKey()) =>
    request(`/inquiry-drafts/${draftId}/resources`, { method: 'POST', body, idempotencyKey: key }),
  replaceDraftResources: (draftId, body, key = newIdempotencyKey()) =>
    request(`/inquiry-drafts/${draftId}/resources`, { method: 'PUT', body, idempotencyKey: key }),
  createUploadIntent: (body, key = newIdempotencyKey()) =>
    request('/resources/upload-intents', { method: 'POST', body, idempotencyKey: key }),
  completeUpload: (uploadId, body, key = newIdempotencyKey()) =>
    request(`/resources/${uploadId}/complete`, { method: 'POST', body, idempotencyKey: key }),
  publishInquiry: (body, key = newIdempotencyKey()) =>
    request('/inquiries', { method: 'POST', body, idempotencyKey: key }),

  // ---------- 询价单列表 / 详情（buyer-inquiry-list.html） ----------
  listInquiries: (params) => request('/inquiries', { params }),
  getInquiry: (inquiryId) => request(`/inquiries/${inquiryId}`),
  getInquiryItems: (inquiryId) => request(`/inquiries/${inquiryId}/items`),
  getAppendPolicy: (inquiryId) => request(`/inquiries/${inquiryId}/append-policy`),
  appendItems: (inquiryId, body, key = newIdempotencyKey()) =>
    request(`/inquiries/${inquiryId}/append-items`, { method: 'POST', body, idempotencyKey: key }),
  appendQualities: (inquiryId, body, key = newIdempotencyKey()) =>
    request(`/inquiries/${inquiryId}/append-qualities`, { method: 'POST', body, idempotencyKey: key }),
  withdrawInquiry: (inquiryId, body, key = newIdempotencyKey()) =>
    request(`/inquiries/${inquiryId}/withdraw`, { method: 'POST', body, idempotencyKey: key }),
  saveNoPurchaseReason: (inquiryId, body, key = newIdempotencyKey()) =>
    request(`/inquiries/${inquiryId}/no-purchase-reason`, { method: 'PUT', body, idempotencyKey: key }),

  // ---------- 报价结果（buyer-quotation-result.html） ----------
  listQuotations: (inquiryId, params) => request(`/inquiries/${inquiryId}/quotations`, { params }),
  getQuotationSelection: (inquiryId) => request(`/inquiries/${inquiryId}/quotation-selection`),
  saveQuotationSelection: (inquiryId, body, key = newIdempotencyKey()) =>
    request(`/inquiries/${inquiryId}/quotation-selection`, { method: 'POST', body, idempotencyKey: key }),

  // ---------- 购物车（buyer-cart.html） ----------
  listCarts: (params) => request('/carts', { params }),
  getCart: (cartId, params) => request(`/carts/${cartId}`, { params }),
  createCart: (body = { source: 'QUOTATION' }, key = newIdempotencyKey()) =>
    request('/carts', { method: 'POST', body, idempotencyKey: key }),
  addCartItems: (cartId, body, key = newIdempotencyKey()) =>
    request(`/carts/${cartId}/items`, { method: 'POST', body, idempotencyKey: key }),
  updateCartItem: (cartId, cartItemId, body, key = newIdempotencyKey()) =>
    request(`/carts/${cartId}/items/${cartItemId}`, { method: 'PATCH', body, idempotencyKey: key }),
  deleteCartItem: (cartId, cartItemId, version, key = newIdempotencyKey()) =>
    request(`/carts/${cartId}/items/${cartItemId}`, {
      method: 'DELETE',
      params: { version },
      idempotencyKey: key,
    }),
  mergeCarts: (cartId, body, key = newIdempotencyKey()) =>
    request(`/carts/${cartId}/merge`, { method: 'POST', body, idempotencyKey: key }),
  bindCartInquiry: (cartId, body, key = newIdempotencyKey()) =>
    request(`/carts/${cartId}/bind-inquiry`, { method: 'POST', body, idempotencyKey: key }),
  clearCart: (cartId, body, key = newIdempotencyKey()) =>
    request(`/carts/${cartId}/clear`, { method: 'POST', body, idempotencyKey: key }),

  // ---------- 确认订单（buyer-order-confirm.html） ----------
  previewOrder: (body, key = newIdempotencyKey()) =>
    request('/orders/preview', { method: 'POST', body, idempotencyKey: key }),
  submitOrder: (body, key = newIdempotencyKey()) =>
    request('/orders', { method: 'POST', body, idempotencyKey: key }),
  saveInvoiceDefault: (body, key = newIdempotencyKey()) =>
    request('/users/me/invoice-default', { method: 'PUT', body, idempotencyKey: key }),

  // ---------- 收货地址（buyer-address.html） ----------
  listAddresses: (params) => request('/addresses', { params }),
  createAddress: (body, key = newIdempotencyKey()) =>
    request('/addresses', { method: 'POST', body, idempotencyKey: key }),
  updateAddress: (addressId, body, key = newIdempotencyKey()) =>
    request(`/addresses/${addressId}`, { method: 'PATCH', body, idempotencyKey: key }),
  setDefaultAddress: (addressId, body, key = newIdempotencyKey()) =>
    request(`/addresses/${addressId}/default`, { method: 'POST', body, idempotencyKey: key }),
  deleteAddress: (addressId, version, key = newIdempotencyKey()) =>
    request(`/addresses/${addressId}`, { method: 'DELETE', params: { version }, idempotencyKey: key }),
  getAddressSync: (addressId) => request(`/addresses/${addressId}/sync`),
  triggerAddressSync: (addressId, body, key = newIdempotencyKey()) =>
    request(`/addresses/${addressId}/sync`, { method: 'POST', body, idempotencyKey: key }),
}

// 资源上传需要 sha256（后端按 64 位十六进制校验）
export async function sha256Hex(file) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
