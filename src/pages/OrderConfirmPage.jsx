// 确认订单（buyer-order-confirm.html）
// 读取：购物车明细（取 version）+ 收货地址列表
// 写入：POST /api/orders/preview（服务端算钱）→ POST /api/orders（原样回传 previewToken）
// 前端不下单金额：页面所有金额都展示预览接口返回值。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, FileText, MapPin, Truck } from 'lucide-react'
import { api, newIdempotencyKey } from '../api/client'
import { amount, formatDateTime } from '../lib/format'
import { Button, Card, Empty, ErrorBox, Field, PageHead, Status, errorText, useToast } from '../components/ui'

const money = (value) => (value === null || value === undefined ? '—' : `¥${amount(value)}`)

// 提交成功后的中文状态文案；未知状态原样展示，不编造流程。
const ORDER_STATUS_LABEL = {
  PENDING_APPROVAL: '待审批',
  APPROVED: '已通过',
  PENDING_SHIPMENT: '待发货',
  SHIPPED: '已发货',
  CLOSED: '已结案',
}

const INVOICE_OPTIONS = [
  { value: 'NORMAL', label: '增值税普通发票' },
  { value: 'VAT_SPECIAL', label: '增值税专用发票' },
  { value: 'NONE', label: '不需要发票' },
]

/**
 * 管理费率按契约固定两位小数字符串（示例 "5.00"）；
 * 用户输入 "12.5" 时补零再提交，避免服务端按金额口径拒绝（42251）。
 */
function normalizeRate(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return raw
  if (/^\d+$/.test(raw)) return `${raw}.00`
  if (/^\d+\.\d$/.test(raw)) return `${raw}0`
  return raw
}

export default function OrderConfirmPage({ cartId, cartItemIds = [], onNavigate }) {
  const notify = useToast()
  const [cart, setCart] = useState(null)
  const [addresses, setAddresses] = useState([])
  const [addressId, setAddressId] = useState('')
  const [contact, setContact] = useState({ name: '', phone: '' })
  const [invoice, setInvoice] = useState({ invoiceType: 'NORMAL', title: '', taxNo: '' })
  const [deliveryMode] = useState('EXPRESS')
  const [deliveryTime] = useState('ANY')
  const [serviceFee, setServiceFee] = useState({ enabled: false, rate: '5.00', remark: '' })
  const [remark, setRemark] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [order, setOrder] = useState(null)
  const [previewedBody, setPreviewedBody] = useState('')
  // 购物车被其他端 / 其他 Tab 改动（40911）后勾选行已消失：停止预览并引导用户回购物车。
  const [cartChanged, setCartChanged] = useState(false)
  const requestId = useRef(0)
  // 同一份提交包体（含 previewToken）复用同一个幂等键：网络重试不会重复下单；
  // 包体变化必须换新键，否则服务端会按 40910 拒绝。
  const submitKey = useRef({ signature: '', key: '' })

  const load = useCallback(async () => {
    if (!cartId || !cartItemIds.length) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [cartData, addressData] = await Promise.all([
        api.getCart(cartId, { pageNum: 1, pageSize: 100 }),
        api.listAddresses({ status: 'ACTIVE', pageNum: 1, pageSize: 50 }),
      ])
      setCart(cartData)
      setAddresses(addressData.list || [])
      const preferred = (addressData.list || []).find((row) => row.isDefault) || (addressData.list || [])[0]
      if (preferred) {
        setAddressId(preferred.addressId)
        setContact(preferred.contact)
      }
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [cartId, cartItemIds.length])

  useEffect(() => {
    load()
  }, [load])

  const currentAddress = useMemo(
    () => addresses.find((row) => row.addressId === addressId) || null,
    [addresses, addressId],
  )

  // preview.items 是扁平数组（每行带 supplierName），按供应商聚合后展示。
  const itemGroups = useMemo(() => {
    const groups = []
    const index = new Map()
    ;(preview?.items || []).forEach((row) => {
      const key = row.supplierName || '未知供应商'
      if (!index.has(key)) {
        const group = { supplierName: key, itemCount: 0, amount: 0, list: [] }
        index.set(key, group)
        groups.push(group)
      }
      const group = index.get(key)
      group.list.push(row)
      group.itemCount += Number(row.quantity || 1)
      group.amount += Number(row.amount || 0)
    })
    return groups
  }, [preview])

  const invoiceValid = useMemo(() => {
    if (invoice.invoiceType === 'NONE') return true
    if (!invoice.title.trim()) return false
    if (invoice.invoiceType === 'VAT_SPECIAL' && !invoice.taxNo.trim()) return false
    return true
  }, [invoice])

  const contactValid = /^1[3-9]\d{9}$/.test(contact.phone) && Boolean(contact.name.trim())

  const body = useCallback(
    () => ({
      cartId,
      cartItemIds,
      shippingAddressId: addressId,
      invoice: {
        invoiceType: invoice.invoiceType,
        ...(invoice.invoiceType === 'NONE' ? {} : { title: invoice.title.trim() }),
        ...(invoice.taxNo.trim() ? { taxNo: invoice.taxNo.trim() } : {}),
      },
      contact,
      deliveryMode,
      deliveryTime,
      serviceFeeRequest: {
        enabled: serviceFee.enabled,
        ...(serviceFee.enabled ? { rate: normalizeRate(serviceFee.rate) } : {}),
        ...(serviceFee.remark ? { remark: serviceFee.remark } : {}),
      },
      ...(remark ? { remark } : {}),
      version: cart.version,
    }),
    [addressId, cart, cartId, cartItemIds, contact, deliveryMode, deliveryTime, invoice, remark, serviceFee],
  )

  // 预览的事实源是「服务端对这份包体的计算结果」；包体指纹保留下来判定预览是否已过期。
  const bodyJson = useMemo(() => (cart ? JSON.stringify(body()) : ''), [body, cart])

  const previewNow = useCallback(async () => {
    if (!cart || !addressId || !invoiceValid || !contactValid || cartChanged) return
    const id = ++requestId.current
    const requestBody = bodyJson
    setPreviewing(true)
    try {
      const data = await api.previewOrder(JSON.parse(requestBody))
      if (id === requestId.current) {
        setPreview(data)
        setPreviewedBody(requestBody)
        setError(null)
      }
    } catch (err) {
      if (id === requestId.current) setError(err)
    } finally {
      if (id === requestId.current) setPreviewing(false)
    }
  }, [addressId, bodyJson, cart, cartChanged, contactValid, invoiceValid])

  // 地址 / 发票 / 配送 / 管理费变化 → 重新预览（服务端才是金额事实源）。
  useEffect(() => {
    const timer = window.setTimeout(() => previewNow(), 350)
    return () => window.clearTimeout(timer)
  }, [previewNow])

  // 预览落后于当前包体（正在重算或还没算完）时禁止提交，避免拿旧 previewToken 赌服务端 41001。
  const previewStale = Boolean(preview) && previewedBody !== bodyJson

  const submit = async () => {
    if (!preview?.previewToken || previewStale) {
      notify('请先完成订单预览')
      return
    }
    const payload = { ...body(), previewToken: preview.previewToken }
    const signature = JSON.stringify(payload)
    if (submitKey.current.signature !== signature)
      submitKey.current = { signature, key: newIdempotencyKey() }
    setSubmitting(true)
    try {
      const result = await api.submitOrder(payload, submitKey.current.key)
      setOrder(result)
      notify(`订单已提交：${result.orderNo}`)
    } catch (err) {
      if (err?.code === 41001) {
        // 服务端判定绑定信息已变化：凭据作废，立刻重算并让用户再确认一次。
        setPreview(null)
        setPreviewedBody('')
        notify('预览已过期，正在重新计算金额')
        await previewNow()
      } else if (err?.code === 40911) {
        // 购物车被其他端 / 其他 Tab 改动：保留已填信息 → 回读购物车 → 按最新数据重算金额。
        setPreview(null)
        setPreviewedBody('')
        try {
          const fresh = await api.getCart(cartId, { pageNum: 1, pageSize: 100 })
          const alive = new Set((fresh.list || []).map((row) => row.cartItemId))
          setCart(fresh)
          if (cartItemIds.some((id) => !alive.has(id))) {
            // 勾选行已不在购物车：不再按旧勾选预览，交给用户重新确认。
            setCartChanged(true)
            notify('购物车已被其他端修改，请返回购物车重新确认')
          } else {
            notify('购物车已更新，金额已按最新数据重新计算，请确认后再次提交')
          }
        } catch (refreshError) {
          setError(refreshError)
        }
      } else {
        setError(err)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (order) {
    return (
      <>
        <PageHead eyebrow="首页 / 查看报价 / 结算" title="订单已提交" description="订单已提交，等待总部审批，线上无需支付。" />
        <Card className="confirm-card" data-testid="order-success">
          <div className="confirm-block">
            <span>订单号</span>
            <b data-testid="order-success-no">{order.orderNo}</b>
            <small data-testid="order-success-status">
              订单状态 {ORDER_STATUS_LABEL[order.status] || order.status} · 审批任务 {order.approvalTaskCount} 个
            </small>
          </div>
          <div className="confirm-block">
            <span>供应商</span>
            <b>{(order.supplierSummary || []).map((row) => row.supplierName).join('、') || '—'}</b>
            <small>{(order.supplierSummary || []).map((row) => `${row.supplierName} ${row.itemCount} 件 ${money(row.amount)}`).join(' · ')}</small>
          </div>
          <div className="confirm-block">
            <span>订单金额</span>
            <b data-testid="order-success-total">{money(order.totals?.grandTotal)}</b>
            <small>商品金额 {money(order.totals?.goods)} · 币种 {order.totals?.currency}</small>
          </div>
          <div className="form-footer">
            <Button variant="ghost" onClick={() => onNavigate('inquiries')} data-testid="order-back-quote">
              返回报价列表
            </Button>
            <Button onClick={() => onNavigate('cart')} data-testid="order-view-cart">
              查看购物车
            </Button>
          </div>
        </Card>
      </>
    )
  }

  if (!cartId || !cartItemIds.length) {
    return (
      <>
        <PageHead eyebrow="首页 / 查看报价 / 结算" title="确认订单" description="请先在购物车勾选要提交的配件。" />
        <Card>
          <Empty
            icon={<Truck size={34} />}
            title="没有可提交的配件"
            description="请先在购物车勾选要提交的配件"
            action={
              <Button onClick={() => onNavigate('cart')} data-testid="order-to-cart">
                返回购物车
              </Button>
            }
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHead
        eyebrow="首页 / 查看报价 / 结算"
        title="确认订单"
        description="确认收货地址、发票信息后提交订单，提交后进入总部审批。"
        action={
          <Button variant="ghost" onClick={() => onNavigate(`cart?cartId=${cartId}`)} data-testid="order-back">
            ← 返回购物车
          </Button>
        }
      />
      <ErrorBox error={error} onRetry={previewNow} />
      {cartChanged && (
        <Card className="confirm-card" data-testid="order-cart-changed">
          <span>购物车已被其他端修改</span>
          <small>勾选的配件已不在购物车，请返回购物车重新勾选后再结算（已填写的地址、发票、备注不会被清空）。</small>
          <Button onClick={() => onNavigate(`cart?cartId=${cartId}`)} data-testid="order-cart-changed-back">
            返回购物车
          </Button>
        </Card>
      )}
      <Card className="confirm-card">
        <div className="confirm-block" data-testid="order-address-block">
          <span>收货地址</span>
          <b>收货信息</b>
          <small>默认选中默认地址，切换后重新计算运费与金额。</small>
          <div className="address-list">
            {addresses.slice(0, 3).map((row) => {
              return (
                <label
                  className={`address-option ${row.addressId === addressId ? 'active' : ''}`}
                  key={row.addressId}
                  data-testid="order-address-option"
                  data-address-id={row.addressId}
                >
                  <input
                    type="radio"
                    name="shipping-address"
                    checked={row.addressId === addressId}
                    onChange={() => {
                      setAddressId(row.addressId)
                      setContact(row.contact)
                    }}
                  />
                  <div>
                    <b>{row.label}</b>
                    <span>
                      {row.contact.name} · {row.contact.phone}
                    </span>
                    <small>
                      {row.regionText} {row.detail}
                    </small>
                  </div>
                </label>
              )
            })}
            {addresses.length === 0 && (
              <Empty
                icon={<MapPin size={30} />}
                title="还没有收货地址"
                description="提交订单前需要先维护收货地址"
                action={
                  <Button onClick={() => onNavigate('addresses')} data-testid="order-to-address">
                    去新增地址
                  </Button>
                }
              />
            )}
          </div>
          <button className="link-btn" onClick={() => onNavigate('addresses')} data-testid="order-manage-address">
            管理收货地址 <ChevronRight size={14} />
          </button>
        </div>

        <div className="confirm-block" data-testid="order-vehicle-block">
          <span>车辆信息</span>
          {preview?.vehicle ? (
            <>
              <b>{preview.vehicle.vehicleModel || '—'}</b>
              <div className="confirm-line">
                <span>VIN 码</span>
                <small data-testid="order-vehicle-vin">{preview.vehicle.vin || '—'}</small>
              </div>
              <div className="confirm-line">
                <span>车牌号 / 报案号</span>
                <small>
                  {preview.vehicle.plateNo || '—'} / {preview.vehicle.claimNo || '—'}
                </small>
              </div>
            </>
          ) : (
            <small>预览返回后展示车辆快照</small>
          )}
        </div>

        <div className="confirm-block" data-testid="order-invoice-block">
          <span>发票信息</span>
          <b>发票类型</b>
          <div className="tabs" data-testid="invoice-type">
            {INVOICE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={invoice.invoiceType === option.value ? 'active' : ''}
                onClick={() => setInvoice({ ...invoice, invoiceType: option.value })}
                data-testid={`invoice-type-${option.value}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {invoice.invoiceType !== 'NONE' && (
            <Field label="发票抬头" required>
              <input
                data-testid="invoice-title"
                value={invoice.title}
                placeholder="请输入发票抬头"
                onChange={(event) => setInvoice({ ...invoice, title: event.target.value })}
              />
            </Field>
          )}
          {invoice.invoiceType === 'VAT_SPECIAL' && (
            <Field label="税号" required>
              <input
                data-testid="invoice-tax-no"
                value={invoice.taxNo}
                placeholder="请输入税号"
                onChange={(event) => setInvoice({ ...invoice, taxNo: event.target.value })}
              />
            </Field>
          )}
        </div>

        <div className="confirm-block" data-testid="order-items-block">
          <span>商品清单</span>
          {itemGroups.map((group) => (
            <div className="cart-group" key={group.supplierName} data-testid="order-item-group">
              <div className="cart-group-head">
                <b>{group.supplierName}</b>
                <span>
                  {group.itemCount} 件 · {money(group.amount)}
                </span>
              </div>
              {group.list.map((row) => (
                <div className="confirm-line" key={row.cartItemId} data-testid="order-item-row">
                  <span>
                    {row.partName}
                    <small> OE {row.oeNo || '—'} · {row.qualityName}</small>
                  </span>
                  <small>
                    {money(row.unitPrice)} × {row.quantity} = {money(row.amount)}
                  </small>
                </div>
              ))}
            </div>
          ))}
          {!preview && <small>{previewing ? '正在计算…' : '等待预览结果'}</small>}
        </div>

        <div className="confirm-block" data-testid="order-totals-block">
          <span>合计</span>
          <div className="summary-line">
            <span>商品总额</span>
            <b data-testid="totals-goods">{money(preview?.totals?.goods)}</b>
          </div>
          <div className="summary-line">
            <span>运费合计</span>
            <b data-testid="totals-freight">{money(preview?.totals?.freight)}</b>
          </div>
          <div className="summary-line">
            <span>优惠合计</span>
            <b data-testid="totals-discount">{money(preview?.totals?.discount)}</b>
          </div>
          <div className="summary-line total">
            <span>应付总额</span>
            <b data-testid="totals-grand-total">{money(preview?.totals?.grandTotal)}</b>
          </div>
          <small>应付总额 = 商品总额 + 运费 - 优惠；管理费申请单独展示、不计入货款。</small>
        </div>

        <div className="confirm-block" data-testid="order-service-fee-block">
          <span>管理费申请（保险公司人员按需使用）</span>
          <label className="select-label">
            <input
              type="checkbox"
              data-testid="service-fee-toggle"
              checked={serviceFee.enabled}
              onChange={(event) => setServiceFee({ ...serviceFee, enabled: event.target.checked })}
            />{' '}
            随本订单一并提报
          </label>
          {serviceFee.enabled && (
            <>
              <div className="summary-line">
                <span>订单金额</span>
                <b>{money(preview?.serviceFeeRequest?.orderAmount)}</b>
              </div>
              <Field label="管理费率（%）" required>
                <input
                  data-testid="service-fee-rate"
                  value={serviceFee.rate}
                  onChange={(event) => setServiceFee({ ...serviceFee, rate: event.target.value })}
                />
              </Field>
              <div className="summary-line">
                <span>管理费金额（服务端计算）</span>
                <b data-testid="service-fee-amount">{money(preview?.serviceFeeRequest?.amount)}</b>
              </div>
              <Field label="申请说明">
                <input
                  data-testid="service-fee-remark"
                  value={serviceFee.remark}
                  placeholder="现场定损协调、配件跟进服务等"
                  onChange={(event) => setServiceFee({ ...serviceFee, remark: event.target.value })}
                />
              </Field>
            </>
          )}
        </div>

        <div className="confirm-block" data-testid="order-remark-block">
          <span>订单备注</span>
          <input
            data-testid="order-remark"
            value={remark}
            maxLength={200}
            placeholder="选填，给商家留言（≤200 字）"
            onChange={(event) => setRemark(event.target.value)}
          />
        </div>

        <div className="form-footer">
          <div className="selection-total">
            <span>共 {cartItemIds.length} 件商品 · 收货人 {currentAddress?.contact?.name || contact.name || '—'}</span>
            <b data-testid="order-grand-total">{money(preview?.totals?.grandTotal)}</b>
          </div>
          <Button variant="ghost" onClick={() => onNavigate(`cart?cartId=${cartId}`)}>
            返回购物车
          </Button>
          <Button
            onClick={submit}
            disabled={
              !preview || previewStale || submitting || previewing || cartChanged || !invoiceValid || !contactValid
            }
            data-testid="order-submit"
          >
            {submitting ? '提交中…' : '提交订单'}
            <ChevronRight size={16} />
          </Button>
        </div>
        <small className="secure-note">
          预览凭证 {preview?.previewToken ? `${preview.previewToken.slice(0, 10)}…` : '—'} · 有效至{' '}
          {formatDateTime(preview?.expiresAt)} · 审批 {preview?.approvalRequired ? '需要' : '不需要'}
        </small>
      </Card>
    </>
  )
}
