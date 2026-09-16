const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const endpoint = (path) => `${API_BASE}${path}`

async function request(path, options = {}) {
  const response = await fetch(endpoint(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || `请求失败（${response.status}）`)
  return payload.data ?? payload
}

export const api = {
  listInquiries: (params = {}) => request(`/inquiries?${new URLSearchParams(params)}`),
  getInquiry: (id) => request(`/inquiries/${id}`),
  getInquiryItems: (id) => request(`/inquiries/${id}/items`),
  getQuotations: (id) => request(`/inquiries/${id}/quotations`),
  createDraft: (body) => request('/inquiry-drafts', { method: 'POST', body: JSON.stringify(body) }),
  addDraftItems: (id, body) => request(`/inquiry-drafts/${id}/items`, { method: 'POST', body: JSON.stringify(body) }),
  mergePreview: (id, body) => request(`/inquiry-drafts/${id}/merge-preview`, { method: 'POST', body: JSON.stringify(body) }),
  publishInquiry: (body) => request('/inquiries', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) }),
  withdrawInquiry: (id, reason) => request(`/inquiries/${id}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) }),
  listAddresses: () => request('/addresses'),
  createAddress: (body) => request('/addresses', { method: 'POST', body: JSON.stringify(body) }),
  updateAddress: (id, body) => request(`/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAddress: (id) => request(`/addresses/${id}`, { method: 'DELETE' }),
  setDefaultAddress: (id) => request(`/addresses/${id}/default`, { method: 'POST', body: JSON.stringify({}) }),
  listCarts: () => request('/carts'),
  getCart: (id) => request(`/carts/${id}`),
  saveQuotationSelection: (id, body) => request(`/inquiries/${id}/quotation-selection`, { method: 'POST', body: JSON.stringify(body) }),
  addCartItems: (id, body) => request(`/carts/${id}/items`, { method: 'POST', body: JSON.stringify(body) }),
  updateCartItem: (cartId, itemId, body) => request(`/carts/${cartId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCartItem: (cartId, itemId) => request(`/carts/${cartId}/items/${itemId}`, { method: 'DELETE' }),
  previewOrder: (body) => request('/orders/preview', { method: 'POST', body: JSON.stringify(body) }),
}

export const mock = {
  inquiries: [
    { id: 'inq_01', no: 'HQI202609150001', car: '2022款 宝马 3系', vin: 'LSG***8A3', items: '前保险杠、左前大灯、机盖', itemCount: 3, quotations: 4, status: '报价中', statusTone: 'orange', publishedAt: '2026-09-15 09:32', deadline: '2026-09-17 18:00' },
    { id: 'inq_02', no: 'HQI202609140018', car: '2021款 奥迪 A6L', vin: 'LFV***2P9', items: '右前门、后视镜总成', itemCount: 2, quotations: 2, status: '待报价', statusTone: 'blue', publishedAt: '2026-09-14 16:08', deadline: '2026-09-16 18:00' },
    { id: 'inq_03', no: 'HQI202609120006', car: '2023款 丰田 凯美瑞', vin: 'LVG***7K1', items: '水箱框架、散热器', itemCount: 2, quotations: 5, status: '已完成', statusTone: 'green', publishedAt: '2026-09-12 10:20', deadline: '2026-09-14 18:00' },
    { id: 'inq_04', no: 'HQI202609090021', car: '2020款 大众 迈腾', vin: 'LFV***9C2', items: '左后尾灯、后保险杠', itemCount: 2, quotations: 0, status: '已撤回', statusTone: 'gray', publishedAt: '2026-09-09 11:47', deadline: '—' },
  ],
  quotations: [
    { id: 'quo_01', supplier: '优选供应商 A', delivery: '现货 · 1-2天', total: 1860, items: [{ id: 'quo_item_01', name: '前保险杠', oe: '51117379491', quality: '原厂', price: 1280, stock: 2 }, { id: 'quo_item_02', name: '左前大灯', oe: '63117263231', quality: '品牌件', price: 580, stock: 4 }] },
    { id: 'quo_02', supplier: '优选供应商 B', delivery: '调货 · 3-5天', total: 1620, items: [{ id: 'quo_item_03', name: '前保险杠', oe: '51117379491', quality: '拆车件', price: 920, stock: 1 }, { id: 'quo_item_04', name: '左前大灯', oe: '63117263231', quality: '品牌件', price: 700, stock: 2 }] },
    { id: 'quo_03', supplier: '优选供应商 C', delivery: '现货 · 2-3天', total: 2040, items: [{ id: 'quo_item_05', name: '前保险杠', oe: '51117379491', quality: '原厂', price: 1400, stock: 1 }, { id: 'quo_item_06', name: '左前大灯', oe: '63117263231', quality: '原厂', price: 640, stock: 1 }] },
  ],
  addresses: [
    { id: 'addr_01', name: '上海明远汽车服务有限公司', contact: '张明', phone: '138****2201', region: '上海市·闵行区', detail: '颛兴东路 1288 号华汽仓配中心', isDefault: true, syncStatus: '已同步' },
    { id: 'addr_02', name: '苏州明远汽车服务有限公司', contact: '李娜', phone: '139****6712', region: '江苏省·苏州市·虎丘区', detail: '滨河路 899 号', isDefault: false, syncStatus: '待同步' },
  ],
  cart: { id: 'cart_01', version: 3, items: [{ id: 'cart_item_01', quotationItemId: 'quo_item_01', supplier: '优选供应商 A', name: '前保险杠', quality: '原厂', price: 1280, quantity: 1 }, { id: 'cart_item_02', quotationItemId: 'quo_item_02', supplier: '优选供应商 A', name: '左前大灯', quality: '品牌件', price: 580, quantity: 1 }] },
}
