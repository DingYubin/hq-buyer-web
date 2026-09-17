// 发布询价（buyer-publish.html）：原型是单页表单 ——
// 车辆信息（VIN + 识别车型）→ 车牌号/报案号 → 录入配件信息（宽表格）→
// 品质要求（按整单批量设品质）→ 其他要求 → 联系方式（收货地址）→ 发布询价。
// 写入链路：POST /api/inquiry-drafts（含配件）→ PATCH 草稿 → PUT 草稿配件 → POST /api/inquiries
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, newIdempotencyKey } from '../api/client'
import { Button, Card, ErrorBox, PageHead, useToast } from '../components/ui'

const EMPTY_ITEM = () => ({
  requestId: `req_${newIdempotencyKey().slice(0, 8)}`,
  name: '',
  oeCode: '',
  remark: '',
  quantity: 1,
  qualityCodes: [],
})

const VIN_ERROR = 'VIN 需为 17 位大写字母数字，且不含 I/O/Q'

export default function PublishInquiryPage({ onNavigate, draftId }) {
  const notify = useToast()
  const [qualities, setQualities] = useState([])
  const [draft, setDraft] = useState(draftId ? { draftId, version: null } : null)
  const [vin, setVin] = useState('')
  const [plateNo, setPlateNo] = useState('')
  const [claimNo, setClaimNo] = useState('')
  const [recognized, setRecognized] = useState(null)
  const [items, setItems] = useState([{ ...EMPTY_ITEM(), name: '前保险杠', oeCode: '51117379491', quantity: 1 }])
  const [contact, setContact] = useState({ name: '', phone: '' })
  const [addresses, setAddresses] = useState({ list: [], selected: '' })
  const [options, setOptions] = useState({ isAnonymous: true, noReplacement: false })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  /** 服务端最近一次落库的内容签名：内容未变时不重复写，避免空推 version。 */
  const savedRef = useRef({ form: null, items: null })

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
      .listAddresses({ pageNum: 1, pageSize: 50 })
      .then((data) => {
        const list = data.list || []
        const preferred = list.find((row) => row.isDefault) || list[0]
        setAddresses({ list, selected: preferred ? preferred.addressId : '' })
      })
      .catch(() => setAddresses({ list: [], selected: '' }))
  }, [])

  const qualityLabel = useCallback(
    (code) => qualities.find((quality) => quality.code === code)?.name || code,
    [qualities],
  )

  const vinValid = useMemo(() => /^[A-HJ-NPR-Z0-9]{17}$/.test(vin), [vin])
  const filledItems = useMemo(() => items.filter((item) => item.name.trim()), [items])
  /** 品质要求「按整单选品质」：勾选后批量应用到所有配件行，行内仍可单独调整。 */
  const batchQualities = useMemo(() => items[0]?.qualityCodes || [], [items])

  const recognize = async () => {
    if (!vinValid) {
      notify(VIN_ERROR)
      return
    }
    setError(null)
    try {
      const data = await api.recognizeVin(vin)
      setRecognized(data)
      notify(data.recognizeStatus === 'RECOGNIZED' ? '车型识别成功' : '未匹配到识别记录，可直接手动填写')
    } catch (err) {
      setError(err)
    }
  }

  const itemPayload = useCallback(
    () =>
      items
        .filter((item) => item.name.trim())
        .map((item) => ({
          requestId: item.requestId,
          name: item.name.trim(),
          ...(item.oeCode ? { oeCode: item.oeCode.trim().toUpperCase() } : {}),
          quantity: Number(item.quantity) || 1,
          qualityCodes: item.qualityCodes.length ? item.qualityCodes : qualities[0] ? [qualities[0].code] : [],
          resourceIds: [],
          ...(item.remark ? { remark: item.remark.trim() } : {}),
        })),
    [items, qualities],
  )

  /**
   * 落库（幂等友好）：首次创建草稿即带上配件，之后只在内容变化时 PATCH / PUT。
   * 返回最新 { draftId, version }，调用方不需要自己维护 version。
   */
  const persistDraft = useCallback(
    async ({ requireItems = false } = {}) => {
      if (!vinValid) {
        notify(VIN_ERROR)
        return null
      }
      const payloadItems = itemPayload()
      if (requireItems && !payloadItems.length) {
        notify('请至少填写一个配件')
        return null
      }
      const formSig = JSON.stringify({
        vin,
        plateNo: plateNo.trim(),
        claimNo: claimNo.trim(),
        contactName: contact.name.trim(),
        contactPhone: contact.phone.trim(),
      })
      const itemsSig = JSON.stringify(payloadItems)
      if (!draft?.draftId) {
        const created = await api.createDraft({
          source: 'PC',
          vin,
          ...(plateNo.trim() ? { plateNo: plateNo.trim() } : {}),
          ...(claimNo.trim() ? { claimNo: claimNo.trim() } : {}),
          items: payloadItems,
        })
        const next = { draftId: created.draftId || created.inquiryId, version: created.version }
        savedRef.current = { form: formSig, items: itemsSig }
        setDraft(next)
        return next
      }
      let current = { draftId: draft.draftId, version: draft.version }
      if (savedRef.current.form !== formSig) {
        const patched = await api.patchDraft(current.draftId, {
          version: current.version,
          vin,
          plateNo: plateNo.trim() || null,
          claimNo: claimNo.trim() || null,
        })
        current = { draftId: current.draftId, version: patched.version ?? current.version }
        savedRef.current.form = formSig
        setDraft(current)
      }
      if (savedRef.current.items !== itemsSig) {
        const saved = await api.saveDraftItems(current.draftId, { version: current.version, items: payloadItems })
        current = { draftId: current.draftId, version: saved.version ?? current.version }
        savedRef.current.items = itemsSig
        setDraft(current)
      }
      return current
    },
    [claimNo, contact.name, contact.phone, draft, itemPayload, plateNo, vin, vinValid, notify],
  )

  const saveDraft = async () => {
    if (busy) return
    setBusy('draft')
    setError(null)
    try {
      const saved = await persistDraft({ requireItems: true })
      if (saved) notify('草稿已保存，中途换端可继续编辑')
    } catch (err) {
      setError(err)
    } finally {
      setBusy('')
    }
  }

  const publish = async () => {
    if (busy) return
    if (!contact.name.trim() || !/^1[3-9]\d{9}$/.test(contact.phone)) {
      notify('请填写联系人和 11 位手机号')
      return
    }
    setBusy('publish')
    setError(null)
    try {
      const current = await persistDraft({ requireItems: true })
      if (!current) return
      const result = await api.publishInquiry({
        draftId: current.draftId,
        version: current.version,
        contact: { name: contact.name.trim(), phone: contact.phone.trim() },
        publishOptions: {
          quotedType: 'SYSTEM',
          isAnonymous: options.isAnonymous,
          noReplacement: options.noReplacement,
          selectedChannelOrgIds: [],
        },
      })
      notify(`询价已发布：${result.inquiryNo}`)
      onNavigate(`inquiries?highlight=${encodeURIComponent(result.inquiryId)}`)
    } catch (err) {
      setError(err)
    } finally {
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
      <PageHead
        eyebrow="首页 / 发布询价"
        title="发布询价"
        description="填写车辆、配件和品质要求，提交后平台将为您匹配供应商。"
        action={
          <div className="draft-state" data-testid="draft-state">
            <span className="dot-live" />
            {draft?.draftId ? `草稿 ${draft.draftId} · v${draft.version}` : '草稿未创建'}
          </div>
        }
      />
      <ErrorBox error={error} />
      <Card className="form-card">
        <div className="card-body">
          <h3 className="section-title">车辆信息</h3>
          <div className="inquiry-vin">
            <label htmlFor="vinInput">VIN码</label>
            <input
              id="vinInput"
              data-testid="vin-input"
              value={vin}
              placeholder="请输入 17 位 VIN 码"
              onChange={(event) => setVin(event.target.value.toUpperCase())}
            />
            <Button onClick={recognize} data-testid="recognize-vin">
              识别车型
            </Button>
            {recognized && (
              <span className="car-result" data-testid="vehicle-preview">
                {recognized.vehicleModel?.model
                  ? `${recognized.vehicleModel.carBrandName || ''} ${recognized.vehicleModel.model}`.trim()
                  : '未识别到车型，可继续手动填写'}
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
              <span>配件名称</span>
              <span>数量</span>
              <span>备注</span>
              <span>配件实物图片</span>
              <span>原厂零件号</span>
              <span>标准名称</span>
              <span>4S参考价(¥)</span>
              <span>配件图</span>
              <span />
            </div>
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
                    onClick={() => notify('配件实物图片上传待接入草稿资源接口（本期未纳入）')}
                  >
                    <b>＋</b>
                    <small>拖拽工单图片到这里</small>
                  </button>
                  <input
                    data-testid={`item-oe-${index}`}
                    value={item.oeCode}
                    placeholder="原厂零件号"
                    onChange={(event) => patchItem(item.requestId, { oeCode: event.target.value })}
                  />
                  <input value="" placeholder="标准名称" readOnly title="标准名称由平台配件库回填，本期接口未返回" />
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
                { ...EMPTY_ITEM(), qualityCodes: qualities[0] ? [qualities[0].code] : [] },
              ])
            }
          >
            <Plus size={13} /> 添加配件
          </button>
          <div className="parts-quality">
            {items.map((item, index) => (
              <label key={item.requestId} className="parts-quality-row">
                <span>{index + 1}. {item.name || '未命名配件'}</span>
                <select
                  data-testid={`item-quality-${index}`}
                  value={item.qualityCodes[0] || ''}
                  onChange={(event) =>
                    patchItem(item.requestId, { qualityCodes: event.target.value ? [event.target.value] : [] })
                  }
                >
                  <option value="">选择品质</option>
                  {qualities.map((quality) => (
                    <option key={quality.code} value={quality.code}>
                      {quality.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

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
          <small className="field-hint">勾选后批量应用到所有配件行，行内选择框可再单独调整。</small>

          <h3 className="section-title" style={{ marginTop: 26 }}>
            其他要求
          </h3>
          <div className="option-group">
            <label>
              <input type="radio" name="invoice" disabled /> 不需要发票
            </label>
            <label>
              <input type="radio" name="invoice" disabled defaultChecked /> 需要发票
            </label>
            <label>
              <input type="radio" name="seller" disabled defaultChecked /> 平台推荐
            </label>
          </div>
          <small className="field-hint">发票与推荐方式尚未纳入本期发布契约，接口补充后开放。</small>

          <h3 className="section-title" style={{ marginTop: 26 }}>
            联系方式
          </h3>
          <div className="form-grid">
            <label>
              联系人
              <input
                data-testid="publish-contact-name"
                value={contact.name}
                placeholder="请输入联系人姓名"
                onChange={(event) => setContact({ ...contact, name: event.target.value })}
              />
            </label>
            <label>
              联系电话
              <input
                data-testid="publish-contact-phone"
                value={contact.phone}
                placeholder="11 位手机号"
                onChange={(event) => setContact({ ...contact, phone: event.target.value })}
              />
            </label>
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
                    {`${row.receiverName} ${row.receiverPhone} ${row.regionText || ''} ${row.detail || ''}`.trim()}
                  </option>
                ))}
              </select>
              <a className="manage-address" onClick={() => onNavigate('address')}>
                管理收货地址
              </a>
            </label>
          </div>

          <div className="quality-box" data-testid="publish-summary">
            <div>
              <b>发布摘要</b>
            </div>
            <div className="confirm-line">
              <span>VIN</span>
              <small>{vin || '—'}</small>
            </div>
            <div className="confirm-line">
              <span>车牌 / 报案号</span>
              <small>{plateNo || '—'} / {claimNo || '—'}</small>
            </div>
            <div className="confirm-line">
              <span>配件</span>
              <small>
                {filledItems.length
                  ? filledItems
                      .map((item) => `${item.name}×${item.quantity}（${qualityLabel(item.qualityCodes[0])}）`)
                      .join('、')
                  : '—'}
              </small>
            </div>
            <label className="select-label">
              <input
                type="checkbox"
                data-testid="option-anonymous"
                checked={options.isAnonymous}
                onChange={(event) => setOptions({ ...options, isAnonymous: event.target.checked })}
              />{' '}
              对商家匿名（买方信息不展示给供应商）
            </label>
            <label className="select-label">
              <input
                type="checkbox"
                data-testid="option-no-replacement"
                checked={options.noReplacement}
                onChange={(event) => setOptions({ ...options, noReplacement: event.target.checked })}
              />{' '}
              不接受替代件
            </label>
          </div>

          <div className="form-actions inquiry-actions">
            <Button
              variant="outline"
              onClick={saveDraft}
              disabled={Boolean(busy)}
              data-testid="step-next"
            >
              {busy === 'draft' ? '保存中…' : '保存草稿'}
            </Button>
            <Button onClick={publish} disabled={Boolean(busy)} data-testid="step-publish">
              {busy === 'publish' ? '发布中…' : '发布询价'}
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}
