// 发布询价（buyer-publish.html）：原型是单页表单 ——
// 车辆信息（VIN + 识别车型）→ 车牌号/报案号 → 录入配件信息（宽表格）→
// 品质要求（按整单批量设品质）→ 其他要求（开票 / 平台推荐）→ 联系方式（收货地址）→ 发布询价。
// 写入链路：POST /api/inquiries（publishMode=DIRECT），一次提交完整表单；PC 不创建草稿、不管理 version。
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { contactFromAddress, isPublishableVehicle, toDirectItems, toDirectPublishInput, toPictureRequirementsInput, toVehicleSnapshot } from './publishInquiryPayload'
import { api, newIdempotencyKey } from '../api/client'
import { Button, Card, ErrorBox, useToast } from '../components/ui'

const EMPTY_ITEM = () => ({
  requestId: `req_${newIdempotencyKey().slice(0, 8)}`,
  name: '',
  oeCode: '',
  remark: '',
  quantity: 1,
  qualityCodes: [],
})

const VIN_ERROR = 'VIN 需为 17 位大写字母数字，且不含 I/O/Q'

const PICTURE_TYPE_LABELS = {
  NAMEPLATE: '铭牌',
  HEADSTOCK: '车头',
  TAILSTOCK: '车尾',
  PARTSLIST: '工单/配件清单',
  NONE: '其他',
  HEADSTOCK_TAILSTOCK: '车头/车尾',
  HEADSTOCK_NAMEPLATE: '车头/铭牌',
  TAILSTOCK_NAMEPLATE: '车尾/铭牌',
  HEADSTOCK_TAILSTOCK_NAMEPLATE: '车头/车尾/铭牌',
}

/** 本单图片要求文案；图片上传入口未接通前如实说明，不伪造已上传。 */
function pictureRequirementText(requirements) {
  if (!requirements) return '车型识别后按接口返回本单需要的图片。'
  const types = new Set([
    ...(requirements.vehiclePictureTypeList || []),
    ...(requirements.partPictureDemands || []).flatMap((row) => row.pictureTypeList || []),
  ])
  if (!types.size) return '本单无需上传图片。'
  const labels = [...types].map((type) => PICTURE_TYPE_LABELS[type] || type)
  return `本单需上传：${labels.join('、')}。图片上传入口待接入，接入后需先上传成功再传 URL。`
}

export default function PublishInquiryPage({ onNavigate }) {
  const notify = useToast()
  const [qualities, setQualities] = useState([])
  const [pictureRequirements, setPictureRequirements] = useState(null)
  const [vin, setVin] = useState('')
  const [plateNo, setPlateNo] = useState('')
  const [claimNo, setClaimNo] = useState('')
  const [recognized, setRecognized] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [items, setItems] = useState(() => Array.from({ length: 4 }, (_, index) => ({ ...EMPTY_ITEM(), quantity: index === 0 ? 1 : '' })))
  const [addresses, setAddresses] = useState({ list: [], selected: '' })
  const [isOpenInvoice, setIsOpenInvoice] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [addressError, setAddressError] = useState(null)
  const [recognizing, setRecognizing] = useState(false)
  const vinRef = useRef('')
  const recognitionRef = useRef({ vin: '', sequence: 0 })
  const submitLock = useRef(false)
  /** 同一次提交（包体不变）复用同一个幂等键；包体变化视为新一次提交。 */
  const submissionRef = useRef({ signature: null, key: null })

  useEffect(() => {
    api
      .listQualities()
      .then((data) => {
        const list = data.items || []
        setQualities(list)
        setItems((rows) =>
          rows.map((row) => (row.qualityCodes.length || !list[0] ? row : { ...row, qualityCodes: [list[0].code] })),
        )
      })
      .catch(setError)
  }, [])

  useEffect(() => {
    api
      .listAddresses({ status: 'ACTIVE', pageNum: 1, pageSize: 100 })
      .then((data) => {
        const list = data.list || []
        const preferred = list.find((row) => row.isDefault) || list[0]
        setAddresses({ list, selected: preferred ? preferred.addressId : '' })
      })
      .catch((err) => {
        setAddressError(err)
        setAddresses({ list: [], selected: '' })
      })
  }, [])

  const vinValid = useMemo(() => /^[A-HJ-NPR-Z0-9]{17}$/.test(vin), [vin])
  /** 品质要求「按整单选品质」：勾选后批量应用到所有配件行。 */
  const batchQualities = useMemo(() => items[0]?.qualityCodes || [], [items])

  const recognize = async () => {
    const currentVin = vinRef.current
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(currentVin)) {
      if (currentVin) notify(VIN_ERROR)
      return
    }
    // onBlur + Enter/点击共用同一个识别，避免重复查询；失败可重试。
    if (recognitionRef.current.vin === currentVin) return
    const sequence = recognitionRef.current.sequence + 1
    recognitionRef.current = { vin: currentVin, sequence }
    setRecognizing(true)
    setError(null)
    try {
      const data = await api.recognizeVin(currentVin)
      if (vinRef.current !== currentVin || recognitionRef.current.sequence !== sequence) return
      const next = data.recognizeStatus === 'RECOGNIZED' ? toVehicleSnapshot(data.vehicleModel) : null
      setRecognized(data)
      setSnapshot(next)
      if (!isPublishableVehicle(next)) {
        recognitionRef.current.vin = ''
        notify('未获得完整可发布车型，请重新识别或联系平台')
      }
    } catch (err) {
      if (vinRef.current !== currentVin || recognitionRef.current.sequence !== sequence) return
      recognitionRef.current.vin = ''
      setError(err)
    } finally {
      if (recognitionRef.current.sequence === sequence) setRecognizing(false)
    }
  }

  const changeVin = (value) => {
    const next = value.trim().toUpperCase()
    if (vinRef.current === next) return
    vinRef.current = next
    recognitionRef.current = { vin: '', sequence: recognitionRef.current.sequence + 1 }
    setVin(next)
    setRecognized(null)
    setSnapshot(null)
    setRecognizing(false)
  }

  /** 图片要求：VIN 识别或配件变化后重查，提交时服务端会再复核一次（本版上传入口未接通）。 */
  useEffect(() => {
    if (!vinValid || !isPublishableVehicle(snapshot)) {
      setPictureRequirements(null)
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .getPictureRequirements(toPictureRequirementsInput({ vin, snapshot, items }))
        .then((data) => {
          if (!cancelled) setPictureRequirements(data)
        })
        .catch(() => {
          if (!cancelled) setPictureRequirements(null)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [items, snapshot, vin, vinValid])

  const publish = async () => {
    if (submitLock.current) return
    try {
      if (!vinValid) throw new Error(VIN_ERROR)
      if (recognizing || !isPublishableVehicle(snapshot)) throw new Error('请先完成当前 VIN 的车型识别')
      if (addressError) throw new Error('收货地址加载失败，请刷新重试')
      const address = addresses.list.find((row) => row.addressId === addresses.selected)
      const body = toDirectPublishInput({
        vin,
        plateNo: plateNo.trim(),
        claimNo: claimNo.trim(),
        snapshot,
        items: toDirectItems(items),
        address,
        isOpenInvoice,
      })
      submitLock.current = true
      setBusy('publish')
      setError(null)
      const signature = JSON.stringify(body)
      if (submissionRef.current.signature !== signature) {
        submissionRef.current = { signature, key: newIdempotencyKey() }
      }
      const result = await api.publishInquiry(body, submissionRef.current.key)
      notify(`询价已发布：${result.inquiryNo}`)
      onNavigate(`inquiries?highlight=${encodeURIComponent(result.inquiryId)}`)
    } catch (err) {
      setError(err)
    } finally {
      submitLock.current = false
      setBusy('')
    }
  }

  const patchItem = (requestId, patch) =>
    setItems((rows) => rows.map((row) => (row.requestId === requestId ? { ...row, ...patch } : row)))
  const toggleQuality = (code, checked, requestId) =>
    setItems((rows) =>
      rows.map((row) => {
        if (requestId && row.requestId !== requestId) return row
        const next = checked
          ? [...new Set([...row.qualityCodes, code])]
          : row.qualityCodes.filter((item) => item !== code)
        return { ...row, qualityCodes: next }
      }),
    )

  return (
    <>
      <div className="page-head"><div className="eyebrow">首页 / 发布询价</div></div>
      <ErrorBox error={error} />
      <ErrorBox error={addressError} />
      <Card className="form-card">
        <fieldset className="card-body publish-fields" disabled={Boolean(busy)}>
          <h3 className="section-title">车辆信息</h3>
          <div className="inquiry-vin">
            <label htmlFor="vinInput">VIN码</label>
            <input
              id="vinInput"
              data-testid="vin-input"
              value={vin}
              placeholder="请输入 17 位 VIN 码"
              onChange={(event) => changeVin(event.target.value)}
              onBlur={recognize}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); recognize() }
              }}
            />
            {recognizing && <span role="status">正在识别车型…</span>}
            {!recognizing && vinValid && !isPublishableVehicle(snapshot) && (
              <Button onClick={recognize} data-testid="recognize-vin">重新识别</Button>
            )}
            {recognized && (
              <span className="car-result" data-testid="vehicle-preview">
                {isPublishableVehicle(snapshot)
                  ? `${snapshot.carBrandName} ${snapshot.model || snapshot.saleModelName}`.trim()
                  : '未获得完整可发布车型，请重新识别'}
                {recognized.vinMasked ? ` · ${recognized.vinMasked}` : ''}
              </span>
            )}
          </div>
          <div className="form-grid" style={{ marginTop: 16 }}>
            <label>
              车牌号（选填）
              <input
                data-testid="publish-plate-no"
                value={plateNo}
                placeholder="请输入车牌号，保险事故报价更精准"
                onChange={(event) => setPlateNo(event.target.value.toUpperCase())}
              />
            </label>
            <label>
              报案号（选填）
              <input
                data-testid="publish-claim-no"
                value={claimNo}
                placeholder="请输入报案号，保险事故相关订单填写"
                onChange={(event) => setClaimNo(event.target.value)}
              />
            </label>
          </div>

          <h3 className="section-title" style={{ marginTop: 26 }}>
            录入配件信息
          </h3>
          <div className="parts parts-wide">
            <div className="parts-head inquiry-parts-head">
              <span>序号</span>
              <span><b className="required-mark">*</b> 配件信息</span>
              <span><b className="required-mark">*</b> 数量</span>
              <span>备注</span>
              <span>配件实物图片</span>
              <span>原厂零件号</span>
              <span>标准名称</span>
              <span>4S店参考价(¥)</span>
              <span>配件图</span>
              <span />
            </div>
            <button type="button" className="parts-work-order" disabled title="工单上传和 OCR 尚未接入，15M 原型上限待确认">
              <span className="work-order-plus">＋</span>
              <span><b>拖拽工单图片到这里，或点击上传</b><small>工单上传 / OCR 待接入；当前资源接口上限 10MB，原型 15M 待确认</small></span>
            </button>
            <div data-testid="publish-items">
              {items.map((item, index) => (
                <div className="part-line inquiry-part-line" key={item.requestId} data-testid="publish-item-row">
                  <span>{index + 1}</span>
                  <input
                    data-testid={`item-name-${index}`}
                    value={item.name}
                    placeholder="原厂零件号或配件名称"
                    onChange={(event) => patchItem(item.requestId, { name: event.target.value })}
                  />
                  <input
                    data-testid={`item-qty-${index}`}
                    value={item.quantity}
                    placeholder="数量"
                    onChange={(event) => patchItem(item.requestId, { quantity: event.target.value })}
                  />
                  <input
                    data-testid={`item-remark-${index}`}
                    value={item.remark}
                    placeholder="配件描述"
                    onChange={(event) => patchItem(item.requestId, { remark: event.target.value })}
                  />
                  <button
                    type="button"
                    className="upload-box"
                    data-testid={`item-photo-${index}`}
                    disabled
                    title="配件实物图片上传待接入"
                  >
                    <b>＋</b>
                    <small>待接入</small>
                  </button>
                  <input
                    data-testid={`item-oe-${index}`}
                    value={item.oeCode}
                    placeholder="原厂零件号"
                    onChange={(event) => patchItem(item.requestId, { oeCode: event.target.value })}
                  />
                  <input value="" placeholder="标准名称" readOnly title="配件标准化自动回填待接入" />
                  <span className="ref-price">-</span>
                  <span className="thumb">图</span>
                  <button
                    type="button"
                    className="remove"
                    aria-label="删除配件"
                    disabled={items.length === 1}
                    onClick={() => setItems((rows) => rows.filter((row) => row.requestId !== item.requestId))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="add-part"
            data-testid="add-item"
            onClick={() =>
              setItems((rows) => [
                ...rows,
                { ...EMPTY_ITEM(), qualityCodes: [...batchQualities] },
              ])
            }
          >
            <Plus size={13} /> 添加配件
          </button>
          <h3 className="section-title" style={{ marginTop: 26 }}>
            品质要求
          </h3>
          <div className="option-group">
            <label>
              <input type="radio" name="qualityScope" defaultChecked readOnly /> 按整单选品质
            </label>
          </div>
          <div className="option-group" data-testid="batch-quality">
            {qualities.map((quality) => (
              <label key={quality.code}>
                <input
                  type="checkbox"
                  checked={batchQualities.includes(quality.code)}
                  onChange={(event) => toggleQuality(quality.code, event.target.checked)}
                />
                {quality.name}
              </label>
            ))}
          </div>
          <small className="field-hint">勾选后应用到所有配件；品质名称与编码以平台字典为准。</small>
          <p className="field-hint" data-testid="picture-requirements">
            {pictureRequirementText(pictureRequirements)}
          </p>

          <h3 className="section-title" style={{ marginTop: 26 }}>
            其他要求
          </h3>
          <div className="option-group" data-testid="publish-invoice">
            <label>
              <input
                type="radio"
                name="invoice"
                data-testid="option-invoice-none"
                checked={!isOpenInvoice}
                onChange={() => setIsOpenInvoice(false)}
              />{' '}
              不需要发票
            </label>
            <label>
              <input
                type="radio"
                name="invoice"
                data-testid="option-invoice-open"
                checked={isOpenInvoice}
                onChange={() => setIsOpenInvoice(true)}
              />{' '}
              需要发票
            </label>
            <label>
              <input type="radio" name="seller" defaultChecked readOnly /> 平台推荐
            </label>
          </div>
          <small className="field-hint">
            开票选择随 publishOptions.isOpenInvoice 提交；「指定商家」需先有可报价供应商（storeIds），待接口开放后启用。
          </small>

          <h3 className="section-title" style={{ marginTop: 26 }}>
            联系方式
          </h3>
          <div className="form-grid">
            <label className="wide">
              收货地址
              <select
                data-testid="publish-address"
                value={addresses.selected}
                onChange={(event) => setAddresses({ ...addresses, selected: event.target.value })}
              >
                {!addresses.list.length && <option value="">暂无收货地址，请先新增</option>}
                {addresses.list.map((row) => (
                  <option key={row.addressId} value={row.addressId}>
                    {`${row.contact?.name || ''} ${row.contact?.phone || ''} ${row.regionText || ''} ${row.detail || ''}`.trim()}
                  </option>
                ))}
              </select>
              <button type="button" className="manage-address" onClick={() => onNavigate('addresses')}>
                管理收货地址
              </button>
            </label>
          </div>

          <div className="form-actions inquiry-actions">
            <Button onClick={publish} disabled={Boolean(busy)} data-testid="step-publish">
              {busy === 'publish' ? '发布中…' : '发布询价'}
            </Button>
          </div>
        </fieldset>
      </Card>
    </>
  )
}
