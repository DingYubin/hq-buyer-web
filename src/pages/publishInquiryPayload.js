// 发布页字段白名单。草稿表单与 POST /api/inquiries 是两个契约，不透传上游 DTO。
const VEHICLE_KEYS = [
  'model', 'carBrandId', 'carBrandName', 'saleModelCode', 'saleModelName',
  'seriesId', 'seriesZh', 'seriesEn', 'epcModelCode', 'locationId', 'locationName',
  'vehicleType', 'engineType',
]

export function toVehicleSnapshot(model) {
  if (!model) return null
  const snapshot = {}
  for (const key of VEHICLE_KEYS) {
    if (typeof model[key] === 'string' && model[key].trim()) snapshot[key] = model[key].trim()
  }
  return Object.keys(snapshot).length ? snapshot : null
}

export function isPublishableVehicle(snapshot) {
  return Boolean(snapshot?.carBrandId && snapshot?.carBrandName && (snapshot?.model || snapshot?.saleModelName))
}

export function toDraftItems(rows) {
  // 只有完全空白的占位行可忽略；有备注/OE却缺少配件名称时不能静默丢失。
  const filled = rows.filter((row) => row.name.trim() || row.oeCode.trim() || row.remark.trim())
  if (!filled.length) throw new Error('请至少填写一个配件')
  if (filled.length > 200) throw new Error('配件最多 200 项')
  return filled.map((row, index) => {
    const name = row.name.trim()
    if (!name || name.length > 200) throw new Error(`第 ${index + 1} 项配件信息需填写 1–200 个字符`)
    const quantity = Number(row.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
      throw new Error(`第 ${index + 1} 项配件数量需为 1–200 的整数`)
    }
    if (!row.qualityCodes.length) throw new Error('请至少选择一种品质')
    return {
      requestId: row.requestId,
      name,
      quantity,
      ...(row.oeCode.trim() ? { oeCode: row.oeCode.trim().toUpperCase() } : {}),
      qualityCodes: [...row.qualityCodes],
      ...(row.remark.trim() ? { remark: row.remark.trim() } : {}),
      resourceIds: [],
    }
  })
}

export function contactFromAddress(address) {
  if (!address?.addressId) throw new Error('请选择收货地址；暂无地址时请先管理收货地址')
  if (address.status && address.status !== 'ACTIVE') throw new Error('收货地址已停用，请重新选择')
  const name = address.contact?.name?.trim()
  const phone = address.contact?.phone?.trim()
  if (!name || name.length > 100 || !/^1[3-9]\d{9}$/.test(phone || '')) {
    throw new Error('所选收货地址缺少有效联系人或 11 位手机号，请先管理收货地址')
  }
  return { name, phone }
}

export function toPublishInput(draft, address, isOpenInvoice) {
  if (!draft?.draftId || !Number.isSafeInteger(draft.version) || draft.version < 1) {
    throw new Error('草稿版本无效，请重新加载后再发布')
  }
  if (typeof isOpenInvoice !== 'boolean') throw new Error('请选择是否需要发票')
  return {
    draftId: draft.draftId,
    version: draft.version,
    contact: contactFromAddress(address),
    addressId: address.addressId,
    publishOptions: {
      quotedType: 'SYSTEM',
      isOpenInvoice,
      isAnonymous: true,
      noReplacement: false,
      storeIds: [],
    },
  }
}
