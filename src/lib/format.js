// 展示格式化与枚举文案。枚举取值全部来自冻结契约，前端只做展示映射。

const pad = (value) => String(value).padStart(2, '0')

/** 金额：契约统一两位小数字符串，前端只做展示格式化，不参与计算。 */
export function money(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function amount(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  return number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 询价单状态（服务端枚举 → 页面文案）。 */
export const INQUIRY_STATUS = {
  DRAFT: { label: '草稿', tone: 'gray' },
  PUBLISHED: { label: '待报价', tone: 'blue' },
  QUOTING: { label: '报价中', tone: 'orange' },
  PARTIALLY_QUOTED: { label: '部分报价', tone: 'orange' },
  QUOTED: { label: '已报价', tone: 'green' },
  WITHDRAWN: { label: '已撤回', tone: 'gray' },
  EXPIRED: { label: '已过期', tone: 'gray' },
  ORDERED: { label: '已下单', tone: 'green' },
}

export function inquiryStatusMeta(status) {
  return INQUIRY_STATUS[status] || { label: status || '—', tone: 'gray' }
}

/** 报价行库存状态。 */
export const STOCK_STATUS = {
  AVAILABLE: { label: '现货', tone: 'green' },
  PARTIAL: { label: '部分现货', tone: 'orange' },
  OUT_OF_STOCK: { label: '缺货', tone: 'gray' },
}

export function stockStatusMeta(status) {
  return STOCK_STATUS[status] || { label: status || '—', tone: 'gray' }
}

/** 购物车行状态：INVALID 置灰、CONVERTED 已转订单不可删。 */
export const CART_ITEM_STATUS = {
  NORMAL: { label: '可结算', tone: 'green' },
  INVALID: { label: '已失效', tone: 'orange' },
  CONVERTED: { label: '已转订单', tone: 'gray' },
}

export function cartItemStatusMeta(status) {
  return CART_ITEM_STATUS[status] || { label: status || '—', tone: 'gray' }
}

/** 地址同步状态。 */
export const SYNC_STATUS = {
  SYNC_PENDING: { label: '同步中', tone: 'orange' },
  SYNCED: { label: '已同步', tone: 'green' },
  SYNC_FAILED: { label: '同步失败', tone: 'red' },
}

export function syncStatusMeta(status) {
  return SYNC_STATUS[status] || { label: status || '—', tone: 'gray' }
}

/** 地址可用状态。 */
export const ADDRESS_STATUS = {
  ACTIVE: { label: '正常', tone: 'green' },
  INACTIVE: { label: '已停用', tone: 'gray' },
}

export function addressStatusMeta(status) {
  return ADDRESS_STATUS[status] || { label: status || '—', tone: 'gray' }
}

/** 发票类型。NONE 时抬头 / 税号允许为空。 */
export const INVOICE_TYPE = {
  NONE: '不需要发票',
  VAT_SPECIAL: '增值税专用发票',
  NORMAL: '增值税普通发票',
}

export const INVOICE_TYPE_OPTIONS = [
  { value: 'VAT_SPECIAL', label: INVOICE_TYPE.VAT_SPECIAL },
  { value: 'NORMAL', label: INVOICE_TYPE.NORMAL },
  { value: 'NONE', label: INVOICE_TYPE.NONE },
]

/** 配送方式 / 配送时间（仅 App 原型有区块，PC 走默认值）。 */
export const DELIVERY_MODE = { EXPRESS: '快递配送', SELF_PICKUP: '到店自提' }
export const DELIVERY_MODE_OPTIONS = [
  { value: 'EXPRESS', label: DELIVERY_MODE.EXPRESS },
  { value: 'SELF_PICKUP', label: DELIVERY_MODE.SELF_PICKUP },
]

export const DELIVERY_TIME = { ANY: '不限时间', WORKDAY: '工作日', WEEKEND: '周末' }
export const DELIVERY_TIME_OPTIONS = [
  { value: 'ANY', label: DELIVERY_TIME.ANY },
  { value: 'WORKDAY', label: DELIVERY_TIME.WORKDAY },
  { value: 'WEEKEND', label: DELIVERY_TIME.WEEKEND },
]

/** 购物车失效原因（validationIssues[].reason）。 */
export const CART_INVALID_REASON = {
  PRICE_CHANGED: '商家已更新报价，请回报价结果页重新确认',
  QUOTE_EXPIRED: '报价已过期，请回报价结果页重新确认',
  OUT_OF_STOCK: '商家库存不足，请调整数量或更换供应商',
  RELATION_NOT_AVAILABLE: '渠道关系已失效，请更换供应商',
  ADDRESS_INCOMPLETE: '收货地址不完整，请先维护收货地址',
  ITEM_CONVERTED: '该行已生成订单，不可再修改',
}

export function invalidReasonText(reason, fallback) {
  if (!reason) return fallback || ''
  return CART_INVALID_REASON[reason] || fallback || reason
}

/** 品质字典兜底文案（服务端未返回 qualityName 时按 code 兜底）。 */
export function qualityNameOf(quality) {
  return quality?.name || quality?.code || '—'
}
