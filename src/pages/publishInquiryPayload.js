// 发布页字段白名单。PC 直发（DIRECT）一次提交完整表单：
// 不创建草稿、不传 draftId/version、不传 items[].resourceIds，图片只传已上传的持久 HTTPS URL。
const VEHICLE_KEYS = [
  'model', 'carBrandId', 'carBrandName', 'saleModelCode', 'saleModelName',
  'seriesId', 'seriesZh', 'seriesEn', 'epcModelCode', 'locationId', 'locationName',
  'vehicleType', 'engineType',
]
// POST /api/inquiries/picture-requirements 只接受这 6 个快照键，且 unknown(false)，不能整份透传。
const PICTURE_SNAPSHOT_KEYS = ['carBrandId', 'locationId', 'locationName', 'seriesId', 'seriesZh', 'seriesEn']

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

export function toDirectItems(rows) {
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

/** 图片要求查询：车辆/配件变化后重查，服务端在提交时会再复核一次。 */
export function toPictureRequirementsInput({ vin, snapshot, items }) {
  if (!snapshot?.carBrandId) throw new Error('请先完成当前 VIN 的车型识别')
  const vehicleSnapshot = {}
  for (const key of PICTURE_SNAPSHOT_KEYS) {
    if (typeof snapshot[key] === 'string' && snapshot[key].trim()) vehicleSnapshot[key] = snapshot[key].trim()
  }
  return {
    vin,
    vehicleSnapshot,
    items: items.map((row) => ({ requestId: row.requestId, ...(row.name.trim() ? { name: row.name.trim() } : {}) })),
  }
}

/**
 * PC DIRECT 完整发布体：服务端内部创建记录并直连 saveInquiry。
 * 不传 draftId/version/inquiryId/resourceIds，也不传裸上游字段。
 */
export function toDirectPublishInput({ vin, plateNo, claimNo, snapshot, items, address, isOpenInvoice, images = [] }) {
  if (typeof isOpenInvoice !== 'boolean') throw new Error('请选择是否需要发票')
  const contact = contactFromAddress(address)
  return {
    publishMode: 'DIRECT',
    source: 'PC',
    vin,
    vehicleSnapshot: snapshot,
    ...(plateNo ? { plateNo } : {}),
    ...(claimNo ? { claimNo } : {}),
    ...(images.length ? { inquiryAdditionalImages: images } : {}),
    items,
    contact,
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
