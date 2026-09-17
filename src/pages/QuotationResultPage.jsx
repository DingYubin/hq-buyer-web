// 报价结果页（buyer-quotation-result.html）
// 读取：询价详情 + 需求项 + 报价列表（按配件分组）+ 已保存选择
// 写入：POST /api/inquiries/{id}/quotation-selection → 加入购物车
// UI：按商家比较 / 按配件比较两个 Tab + 一键选购 + 吸底汇总条
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, ChevronRight, PackageCheck, RefreshCw, X } from 'lucide-react'
import { api } from '../api/client'
import { amount, formatDateTime, inquiryStatusMeta, qualityNameOf, stockStatusMeta } from '../lib/format'
import { Button, Card, Empty, ErrorBox, PageHead, Status, useToast } from '../components/ui'

const UNAVAILABLE_TEXT = {
  INQUIRY_UNAVAILABLE: '询价单已撤回或过期，不可选购',
  QUOTE_RETRACTED: '商家已撤回报价',
  QUOTE_EXPIRED: '报价已过期',
  OUT_OF_STOCK: '商家库存不足',
  PRICE_CHANGED: '报价已更新，请重新选择',
  INSUFFICIENT_STOCK: '库存不足',
}

/** 未形成订单且可记录不采购原因的状态（与询价单列表口径一致）。 */
const REASON_STATUS = ['PUBLISHED', 'QUOTING', 'PARTIALLY_QUOTED', 'QUOTED']

const money = (value) => (value === null || value === undefined ? '—' : `¥${amount(value)}`)

export default function QuotationResultPage({ inquiryId, onNavigate }) {
  const notify = useToast()
  /** 竞态保护：StrictMode 下 effect 会跑两次，丢弃过期响应；用户已操作后不再用服务端结果覆盖本地选择。 */
  const loadSeq = useRef(0)
  const selectionTouched = useRef(false)
  const [state, setState] = useState({
    loading: true,
    error: null,
    inquiry: null,
    items: [],
    quotes: [],
    version: null,
    qualities: [],
  })
  const [selected, setSelected] = useState({})
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('PART')
  const [reason, setReason] = useState({ open: false, text: '', busy: false })

  const load = useCallback(async () => {
    if (!inquiryId) {
      setState((prev) => ({ ...prev, loading: false, error: new Error('缺少 inquiryId 参数') }))
      return
    }
    const seq = ++loadSeq.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const [inquiry, items, quotes, selection, qualities] = await Promise.all([
        api.getInquiry(inquiryId),
        api.getInquiryItems(inquiryId),
        api.listQuotations(inquiryId, { pageNum: 1, pageSize: 100, groupBy: 'PART', sort: 'MATCH' }),
        api.getQuotationSelection(inquiryId),
        api.listQualities(),
      ])
      if (seq !== loadSeq.current) return
      setState({
        loading: false,
        error: null,
        inquiry,
        items: items.items || [],
        quotes: quotes.list || [],
        version: quotes.version,
        qualities: qualities.items || [],
      })
      const restored = {}
      ;(selection.selections || []).forEach((row) => {
        if (row.unavailableReason) return
        const quote = (quotes.list || []).find((item) => item.quotationItemId === row.quotationItemId)
        restored[row.inquiryItemId] = {
          inquiryItemId: row.inquiryItemId,
          quotationItemId: row.quotationItemId,
          quotationVersion: row.quotationVersion,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          supplierName: quote?.anonymousSupplierName || '已选商家',
        }
      })
      if (!selectionTouched.current) setSelected(restored)
    } catch (error) {
      if (seq !== loadSeq.current) return
      setState((prev) => ({ ...prev, loading: false, error }))
    }
  }, [inquiryId])

  useEffect(() => {
    load()
  }, [load])

  const itemById = useMemo(() => new Map(state.items.map((item) => [item.inquiryItemId, item])), [state.items])
  const qualityByCode = useMemo(() => new Map(state.qualities.map((quality) => [quality.code, quality])), [state.qualities])

  /** 按配件分组：一个需求项下的全部报价行（默认 Tab）。 */
  const groups = useMemo(() => {
    const map = new Map()
    state.quotes.forEach((quote) => {
      if (!map.has(quote.inquiryItemId)) map.set(quote.inquiryItemId, [])
      map.get(quote.inquiryItemId).push(quote)
    })
    return [...map.entries()].map(([inquiryItemId, rows]) => ({
      inquiryItemId,
      item: itemById.get(inquiryItemId),
      rows,
    }))
  }, [state.quotes, itemById])

  /** 每个需求项可售的最低价报价，用于「一键低价选购」与漏选提示。 */
  const lowestByItem = useMemo(() => {
    const map = new Map()
    groups.forEach((group) => {
      const available = group.rows.filter((row) => !row.unavailableReason)
      if (!available.length) return
      map.set(
        group.inquiryItemId,
        available.reduce((best, row) => (Number(row.sellAmount) < Number(best.sellAmount) ? row : best)),
      )
    })
    return map
  }, [groups])

  /** 按商家分组：商家维度看到的报价行 + 报价覆盖度。 */
  const supplierGroups = useMemo(() => {
    const map = new Map()
    state.quotes.forEach((quote) => {
      const name = quote.anonymousSupplierName || '未知商家'
      if (!map.has(name)) map.set(name, { name, rows: [] })
      map.get(name).rows.push(quote)
    })
    const total = groups.length
    return [...map.values()]
      .map((supplier) => {
        const covered = new Set(
          supplier.rows.filter((row) => !row.unavailableReason).map((row) => row.inquiryItemId),
        )
        const wholeTotal = [...covered].reduce((sum, inquiryItemId) => {
          const rows = supplier.rows.filter((row) => row.inquiryItemId === inquiryItemId && !row.unavailableReason)
          const cheapest = rows.reduce((best, row) => (Number(row.sellAmount) < Number(best.sellAmount) ? row : best))
          return sum + Number(cheapest.sellAmount)
        }, 0)
        return { ...supplier, covered: covered.size, total, complete: total > 0 && covered.size === total, wholeTotal }
      })
      .sort((a, b) => Number(b.complete) - Number(a.complete) || a.wholeTotal - b.wholeTotal)
  }, [state.quotes, groups])

  const bestWholeSupplier = useMemo(() => {
    const complete = supplierGroups.filter((supplier) => supplier.complete)
    if (!complete.length) return null
    return complete.reduce((best, supplier) => (supplier.wholeTotal < best.wholeTotal ? supplier : best))
  }, [supplierGroups])

  const selectedList = useMemo(() => Object.values(selected), [selected])
  const selectedTotal = useMemo(
    () => selectedList.reduce((sum, row) => sum + Number(row.unitPrice) * row.quantity, 0),
    [selectedList],
  )
  const selectedQuantity = useMemo(
    () => selectedList.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    [selectedList],
  )
  const missingNames = useMemo(
    () => groups.filter((group) => !selected[group.inquiryItemId]).map((group) => group.item?.name || '配件'),
    [groups, selected],
  )

  const toSelection = (group, quote) => {
    const item = group.item
    const max = Math.min(quote.availableQuantity, item?.quantity ?? quote.requestedQuantity)
    return {
      inquiryItemId: group.inquiryItemId,
      quotationItemId: quote.quotationItemId,
      quotationVersion: quote.version,
      quantity: Math.max(1, Math.min(max, item?.quantity ?? 1)),
      unitPrice: quote.sellAmount,
      supplierName: quote.anonymousSupplierName,
    }
  }

  const choose = (group, quote) => {
    if (quote.unavailableReason) return
    selectionTouched.current = true
    setSelected((prev) => {
      const current = prev[group.inquiryItemId]
      if (current?.quotationItemId === quote.quotationItemId) {
        const next = { ...prev }
        delete next[group.inquiryItemId]
        return next
      }
      return { ...prev, [group.inquiryItemId]: toSelection(group, quote) }
    })
  }

  /** 一键低价选购：每个配件选当前可售最低价（允许跨商家拼单）。 */
  const selectLowestEachPart = () => {
    const next = {}
    groups.forEach((group) => {
      const lowest = lowestByItem.get(group.inquiryItemId)
      if (lowest) next[group.inquiryItemId] = toSelection(group, lowest)
    })
    if (!Object.keys(next).length) {
      notify('暂无可选购的报价')
      return
    }
    selectionTouched.current = true
    setSelected(next)
    notify(`已选择 ${Object.keys(next).length} 项最低价`)
  }

  /** 一键整单低价选购：在能报齐全部配件的商家中选总价最低的一家。 */
  const selectWholeSupplier = () => {
    if (!bestWholeSupplier) {
      notify('暂无商家可报齐全部配件，试试「一键低价选购」')
      return
    }
    const next = {}
    groups.forEach((group) => {
      const rows = bestWholeSupplier.rows.filter(
        (row) => row.inquiryItemId === group.inquiryItemId && !row.unavailableReason,
      )
      if (!rows.length) return
      const cheapest = rows.reduce((best, row) => (Number(row.sellAmount) < Number(best.sellAmount) ? row : best))
      next[group.inquiryItemId] = toSelection(group, cheapest)
    })
    selectionTouched.current = true
    setSelected(next)
    notify(`已选择 ${bestWholeSupplier.name} 整单 ${Object.keys(next).length} 项`)
  }

  const selectWhole = (supplier) => {
    const next = {}
    groups.forEach((group) => {
      const rows = supplier.rows.filter((row) => row.inquiryItemId === group.inquiryItemId && !row.unavailableReason)
      if (!rows.length) return
      const cheapest = rows.reduce((best, row) => (Number(row.sellAmount) < Number(best.sellAmount) ? row : best))
      next[group.inquiryItemId] = toSelection(group, cheapest)
    })
    selectionTouched.current = true
    setSelected(next)
    notify(`已选择 ${supplier.name} 的 ${Object.keys(next).length} 项报价`)
  }

  const saveAndAddToCart = async () => {
    if (!selectedList.length) {
      notify('请先选择报价')
      return
    }
    setBusy(true)
    try {
      await api.saveQuotationSelection(inquiryId, {
        version: state.version,
        selections: selectedList.map((row) => ({
          inquiryItemId: row.inquiryItemId,
          quotationItemId: row.quotationItemId,
          quotationVersion: row.quotationVersion,
          quantity: row.quantity,
        })),
      })
      const carts = await api.listCarts({ status: 'ACTIVE', pageNum: 1, pageSize: 1 })
      let cartId = carts.list?.[0]?.cartId
      if (!cartId) {
        const created = await api.createCart({ source: 'QUOTATION', inquiryIds: [inquiryId] })
        cartId = created.cartId
      }
      const added = await api.addCartItems(cartId, {
        items: selectedList.map((row) => ({
          inquiryItemId: row.inquiryItemId,
          quotationItemId: row.quotationItemId,
          quantity: row.quantity,
        })),
      })
      notify(`已加入购物车 ${added.addedCount} 项`)
      onNavigate(`cart?cartId=${cartId}`)
    } catch (error) {
      setState((prev) => ({ ...prev, error }))
    } finally {
      setBusy(false)
    }
  }

  const saveReason = async () => {
    const text = reason.text.trim()
    if (!text) {
      notify('请填写不采购原因')
      return
    }
    setReason((prev) => ({ ...prev, busy: true }))
    try {
      await api.saveNoPurchaseReason(inquiryId, { version: state.inquiry?.version, reason: text })
      notify('已记录不采购原因')
      setReason({ open: false, text: '', busy: false })
      await load()
    } catch (error) {
      setReason((prev) => ({ ...prev, busy: false }))
      setState((prev) => ({ ...prev, error }))
    }
  }

  const meta = inquiryStatusMeta(state.inquiry?.status)
  const inquiry = state.inquiry
  const canRecordReason =
    inquiry && REASON_STATUS.includes(inquiry.status) && !inquiry.noPurchaseReason && state.quotes.length >= 0

  const renderPartTab = () => (
    <div className="quote-list">
      {groups.map((group) => (
        <Card className="quote-card" key={group.inquiryItemId} data-testid="quote-group">
          <div className="quote-card-head">
            <div className="supplier-avatar">
              <PackageCheck size={17} />
            </div>
            <div>
              <b data-testid="quote-part-name">{group.item?.name || '配件'}</b>
              <span>
                OE {group.item?.oeCode || '—'} · 需求 {group.item?.quantity ?? '—'} 件 · 品质{' '}
                {(group.item?.qualityCodes || []).map((code) => qualityNameOf(qualityByCode.get(code))).join('、')}
              </span>
            </div>
            <strong>
              {group.rows.length}
              <small> 条报价</small>
            </strong>
          </div>
          <div className="quote-items">
            {group.rows.map((quote) => {
              const stock = stockStatusMeta(quote.stockStatus)
              const active = selected[group.inquiryItemId]?.quotationItemId === quote.quotationItemId
              const disabled = Boolean(quote.unavailableReason)
              return (
                <div
                  className={`quote-item ${active ? 'selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                  key={quote.quotationItemId}
                  data-testid="quote-row"
                  data-quotation-item-id={quote.quotationItemId}
                >
                  <div className="supplier-avatar">{quote.anonymousSupplierName.slice(-2)}</div>
                  <div>
                    <b>{quote.anonymousSupplierName}</b>
                    <span>
                      {qualityNameOf(qualityByCode.get(quote.qualityCode))} · 交期 {quote.leadTimeDays} 天 · 有效至{' '}
                      {formatDateTime(quote.validUntil)}
                    </span>
                  </div>
                  <Status tone={stock.tone}>{stock.label}</Status>
                  <strong>
                    {money(quote.sellAmount)}
                    <small> / 件</small>
                  </strong>
                  {disabled ? (
                    <span className="muted-count" data-testid="quote-unavailable">
                      {UNAVAILABLE_TEXT[quote.unavailableReason] || quote.unavailableReason}
                    </span>
                  ) : (
                    <button
                      className={active ? 'btn btn-selected' : 'btn btn-outline'}
                      data-testid="quote-select"
                      onClick={() => choose(group, quote)}
                    >
                      {active ? (
                        <>
                          <CheckCircle2 size={14} /> 已选
                        </>
                      ) : (
                        '选择'
                      )}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="quote-card-foot">
            <span>可售 {group.rows.reduce((max, row) => Math.max(max, row.availableQuantity), 0)} 件</span>
            <span>报价合计以服务端为准，购物车结算时会再次校验</span>
          </div>
        </Card>
      ))}
      {!state.loading && groups.length === 0 && (
        <Card>
          <Empty
            icon={<PackageCheck size={34} />}
            title="暂无报价"
            description="商家报价后会出现在这里，可稍后刷新。"
            action={
              <Button variant="outline" onClick={load} data-testid="quote-refresh">
                刷新报价
              </Button>
            }
          />
        </Card>
      )}
    </div>
  )

  const renderSupplierTab = () => (
    <div className="quote-list">
      {supplierGroups.map((supplier) => (
        <Card className="supplier-card" key={supplier.name} data-testid="supplier-group">
          <div className="supplier-card-head">
            <div className="supplier-avatar">{supplier.name.slice(-2)}</div>
            <div>
              <b>{supplier.name}</b>
              <span>
                {supplier.covered}/{supplier.total} 配件有报价
              </span>
            </div>
            {supplier.complete && supplier === bestWholeSupplier && <span className="best-tag">推荐整单采购</span>}
            <div className="supplier-card-actions">
              <strong>{money(supplier.wholeTotal)}</strong>
              <Button
                variant={supplier === bestWholeSupplier ? 'primary' : 'outline'}
                onClick={() => selectWhole(supplier)}
                disabled={!supplier.covered}
                data-testid="supplier-buy-all"
              >
                整单选购
              </Button>
            </div>
          </div>
          <table className="quote-table">
            <thead>
              <tr>
                <th>配件</th>
                <th>品质</th>
                <th>供货</th>
                <th>数量</th>
                <th>单价</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {supplier.rows.map((quote) => {
                const group = groups.find((row) => row.inquiryItemId === quote.inquiryItemId)
                const item = itemById.get(quote.inquiryItemId)
                const stock = stockStatusMeta(quote.stockStatus)
                const active = selected[quote.inquiryItemId]?.quotationItemId === quote.quotationItemId
                const disabled = Boolean(quote.unavailableReason)
                return (
                  <tr
                    key={quote.quotationItemId}
                    className={active ? 'selected' : ''}
                    data-testid="supplier-row"
                  >
                    <td>
                      <b>{item?.name || '配件'}</b>
                      <small>EPCOE: {item?.oeCode || '—'}</small>
                    </td>
                    <td>{qualityNameOf(qualityByCode.get(quote.qualityCode))}</td>
                    <td>
                      <Status tone={stock.tone}>{stock.label}</Status>
                    </td>
                    <td>{item?.quantity ?? '—'}</td>
                    <td className="supplier-price">{money(quote.sellAmount)}</td>
                    <td>
                      {disabled ? (
                        <span className="muted-count" data-testid="quote-unavailable">
                          {UNAVAILABLE_TEXT[quote.unavailableReason] || quote.unavailableReason}
                        </span>
                      ) : (
                        <button
                          className={active ? 'btn btn-selected btn-xs' : 'btn btn-outline btn-xs'}
                          data-testid="supplier-select"
                          onClick={() => group && choose(group, quote)}
                        >
                          {active ? '已选' : '选购'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="quote-card-foot">
            <span>交期与库存以商家报价为准</span>
            <span>{supplier.complete ? '可整单采购，也可按配件单选' : '未报齐全部配件，可按配件拼单'}</span>
          </div>
        </Card>
      ))}
      {!state.loading && supplierGroups.length === 0 && (
        <Card>
          <Empty
            icon={<PackageCheck size={34} />}
            title="暂无报价"
            description="商家报价后会出现在这里，可稍后刷新。"
            action={
              <Button variant="outline" onClick={load} data-testid="quote-refresh">
                刷新报价
              </Button>
            }
          />
        </Card>
      )}
    </div>
  )

  return (
    <>
      <PageHead
        eyebrow="采购中心 / 报价结果"
        title="报价结果"
        description="商家匿名报价，支持整单采购或跨商家拼单，选购后去结算提交订单。"
        action={
          <div className="quote-head-actions">
            <Button variant="outline" onClick={load} data-testid="quote-refresh-top">
              <RefreshCw size={15} /> 刷新报价
            </Button>
            <Button variant="outline" onClick={() => onNavigate('inquiries')} data-testid="quote-back">
              <ArrowLeft size={15} /> 返回询价单列表
            </Button>
          </div>
        }
      />
      <ErrorBox error={state.error} onRetry={load} />

      <Card className="quote-vehicle-card">
        <div className="qv-head">
          <div className="qv-title">
            {inquiry?.vehicleModelName && <b className="qv-model">{inquiry.vehicleModelName}</b>}
            <b data-testid="quote-inquiry-no">{inquiry?.inquiryNo || '—'}</b>
            <Status tone={meta.tone}>{meta.label}</Status>
            {supplierGroups.length > 0 && (
              <span className="qv-supplier-badge">
                报价完成 · {supplierGroups.length} 家商家已报价
              </span>
            )}
          </div>
          <div className="qv-deadline quote-deadline">
            <span>报价截止</span>
            <b data-testid="quote-deadline">{formatDateTime(inquiry?.quoteDeadlineAt)}</b>
          </div>
        </div>
        <div className="qv-meta">
          <span>
            VIN <b>{inquiry?.vinMasked || '—'}</b>
          </span>
          <span>
            车牌号 <b>{inquiry?.plateNo || '—'}</b>
          </span>
          <span>
            报案号 <b>{inquiry?.claimNo || '—'}</b>
          </span>
          <span>
            需求项 <b>{state.items.length}</b>
          </span>
          <span>
            报价行 <b data-testid="quote-total">{state.quotes.length}</b>
          </span>
        </div>
      </Card>

      {canRecordReason && (
        <div className="quote-reason-bar">
          <span>
            <b>未形成订单</b> 可记录不采购原因
          </span>
          <Button variant="outline" onClick={() => setReason({ open: true, text: '', busy: false })} data-testid="quote-reason">
            录入不采购原因
          </Button>
        </div>
      )}
      {inquiry?.noPurchaseReason && (
        <div className="quote-reason-bar recorded">
          <span>
            <b>已记录不采购原因</b> {inquiry.noPurchaseReason}
          </span>
        </div>
      )}

      <div className="quote-tabs-row">
        <div className="quote-tabs">
          <button
            className={tab === 'SUPPLIER' ? 'active' : ''}
            onClick={() => setTab('SUPPLIER')}
            data-testid="tab-by-supplier"
          >
            按商家比较
          </button>
          <button className={tab === 'PART' ? 'active' : ''} onClick={() => setTab('PART')} data-testid="tab-by-part">
            按配件比较
          </button>
        </div>
        <Button
          variant="accent-outline"
          onClick={tab === 'PART' ? selectLowestEachPart : selectWholeSupplier}
          disabled={!groups.length}
          data-testid="quick-buy"
        >
          {tab === 'PART' ? '一键低价选购' : '一键整单低价选购'}
        </Button>
      </div>

      {tab === 'PART' ? renderPartTab() : renderSupplierTab()}

      <div className="quote-buy-bar" data-testid="quote-buy-bar">
        <div className="qb-left">
          <b>
            询价选购 <span data-testid="selection-count">{selectedList.length}</span>/{groups.length} 项
          </b>
          <small>{missingNames.length ? `漏选：${missingNames.join('、')}` : groups.length ? '已选齐全部配件' : '尚未收到商家报价'}</small>
        </div>
        <div className="qb-right">
          <span className="qb-total">
            已选 <b>{selectedQuantity}</b> 件 · 合计 <strong data-testid="selection-total">{money(selectedTotal)}</strong>
          </span>
          <Button
            variant="outline"
            onClick={() => {
              selectionTouched.current = true
              setSelected({})
            }}
            disabled={!selectedList.length}
            data-testid="quote-clear"
          >
            清空
          </Button>
          <Button onClick={saveAndAddToCart} disabled={busy || !selectedList.length} data-testid="save-selection">
            {busy ? '处理中…' : '查看购物车'}
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {reason.open && (
        <div className="modal-backdrop">
          <div className="modal" data-testid="quote-reason-modal">
            <div className="modal-head">
              <div>
                <h3>录入不采购原因</h3>
                <p>记录后该询价单将标记为未形成订单，可在询价单列表查看。</p>
              </div>
              <button onClick={() => setReason({ open: false, text: '', busy: false })} aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <label>
                不采购原因
                <textarea
                  rows={4}
                  value={reason.text}
                  placeholder="如：报价高于心理价位 / 已从其他渠道采购"
                  onChange={(event) => setReason((prev) => ({ ...prev, text: event.target.value }))}
                  data-testid="quote-reason-input"
                />
              </label>
            </div>
            <div className="modal-foot">
              <Button variant="outline" onClick={() => setReason({ open: false, text: '', busy: false })}>
                取消
              </Button>
              <Button onClick={saveReason} disabled={reason.busy} data-testid="quote-reason-save">
                {reason.busy ? '提交中…' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
