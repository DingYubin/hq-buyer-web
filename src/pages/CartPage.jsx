// 购物车（buyer-cart.html）
// 读取：GET /api/carts?status=ACTIVE → GET /api/carts/{cartId}
// 写入：删除单项（DELETE + version）/ 清空（POST /clear + version）
// 勾选与「已选 N 件 / 合计」是前端本地状态，服务端不持久化。
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ShoppingCart, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { amount, cartItemStatusMeta, invalidReasonText } from '../lib/format'
import { Button, Card, Empty, ErrorBox, PageHead, Status, useToast } from '../components/ui'

const money = (value) => `¥${amount(value)}`

export default function CartPage({ cartId, onNavigate, onCartChange }) {
  const notify = useToast()
  const [state, setState] = useState({ loading: true, error: null, cart: null })
  const [checked, setChecked] = useState({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      let id = cartId
      if (!id) {
        const carts = await api.listCarts({ status: 'ACTIVE', pageNum: 1, pageSize: 1 })
        id = carts.list?.[0]?.cartId
      }
      if (!id) {
        setState({ loading: false, error: null, cart: null })
        setChecked({})
        onCartChange?.(0)
        return
      }
      const cart = await api.getCart(id, { pageNum: 1, pageSize: 100 })
      setState({ loading: false, error: null, cart })
      setChecked((prev) => {
        const next = {}
        cart.list.forEach((row) => {
          if (row.itemStatus === 'NORMAL' && prev[row.cartItemId]) next[row.cartItemId] = true
        })
        return next
      })
      onCartChange?.(cart.list.length)
    } catch (error) {
      setState({ loading: false, error, cart: null })
    }
  }, [cartId, onCartChange])

  useEffect(() => {
    load()
  }, [load])

  const rows = state.cart?.list || []
  const groups = useMemo(() => {
    const map = new Map()
    rows.forEach((row) => {
      if (!map.has(row.supplierName)) map.set(row.supplierName, [])
      map.get(row.supplierName).push(row)
    })
    return [...map.entries()].map(([supplierName, list]) => ({
      supplierName,
      list,
      count: list.length,
    }))
  }, [rows])

  const selectableIds = rows.filter((row) => row.itemStatus === 'NORMAL').map((row) => row.cartItemId)
  const checkedIds = selectableIds.filter((id) => checked[id])
  const checkedRows = rows.filter((row) => checkedIds.includes(row.cartItemId))
  const checkedTotal = checkedRows.reduce((sum, row) => sum + Number(row.unitPrice) * row.quantity, 0)
  const allChecked = selectableIds.length > 0 && checkedIds.length === selectableIds.length

  const toggleAll = () => {
    if (allChecked) {
      setChecked({})
      return
    }
    const next = {}
    selectableIds.forEach((id) => {
      next[id] = true
    })
    setChecked(next)
  }

  const removeItem = async (row) => {
    setBusy(true)
    try {
      await api.deleteCartItem(state.cart.cartId, row.cartItemId, state.cart.version)
      notify('已删除该配件')
      await load()
    } catch (error) {
      setState((prev) => ({ ...prev, error }))
    } finally {
      setBusy(false)
    }
  }

  const clearCart = async () => {
    if (!window.confirm('确认清空购物车？清空后需要重新从报价结果页选购。')) return
    setBusy(true)
    try {
      await api.clearCart(state.cart.cartId, { scope: 'ALL', version: state.cart.version })
      notify('购物车已清空')
      await load()
    } catch (error) {
      setState((prev) => ({ ...prev, error }))
    } finally {
      setBusy(false)
    }
  }

  const checkout = () => {
    if (!checkedIds.length) return
    onNavigate(`order-confirm?cartId=${state.cart.cartId}&cartItemIds=${checkedIds.join(',')}`)
  }

  const invalidMap = useMemo(() => {
    const map = new Map()
    ;(state.cart?.validationIssues || []).forEach((issue) => map.set(issue.cartItemId, issue))
    return map
  }, [state.cart])

  return (
    <>
      <PageHead
        eyebrow="首页 / 查看报价 / 购物车"
        title="购物车"
        description="整单 / 拼单配件确认后去结算，填写收货、发票信息后提交订单。"
        action={
          <Button variant="ghost" onClick={() => onNavigate('inquiries')} data-testid="cart-back-quote">
            ← 返回报价结果
          </Button>
        }
      />
      <ErrorBox error={state.error} onRetry={load} />
      <div className="checkout-tip">
        <span className="tip-icon">
          <ShoppingCart size={17} />
        </span>
        <span>整单采购优先：单一商家可报齐全部配件时推荐整单采购，系统自动合并为一张订单；商家真实信息仅在卖家后台可见。</span>
      </div>
      {state.cart ? (
        <div className="cart-layout" data-testid="cart-layout">
          <Card>
            <div className="items-toolbar">
              <label className="select-label" style={{ margin: 0 }}>
                <input type="checkbox" data-testid="cart-select-all" checked={allChecked} onChange={toggleAll} /> 全选
              </label>
              <span>
                购物车版本 <b>v{state.cart.version}</b> · 状态 {state.cart.status}
              </span>
            </div>
            <div className="cart-table-head" aria-hidden="true">
              <span />
              <span>配件名称</span>
              <span>品质</span>
              <span>单价</span>
              <span>数量</span>
              <span>小计</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            <div className="cart-items">
              {groups.map((group) => (
                <div className="cart-group" key={group.supplierName} data-testid="cart-group">
                  <div className="cart-group-head">
                    <b>{group.supplierName}</b>
                    <span>{group.count} 件</span>
                  </div>
                  {group.list.map((row) => {
                    const status = cartItemStatusMeta(row.itemStatus)
                    const issue = invalidMap.get(row.cartItemId)
                    const disabled = row.itemStatus !== 'NORMAL'
                    return (
                      <div
                          className="cart-row"
                          key={row.cartItemId}
                          data-testid="cart-row"
                          data-cart-item-id={row.cartItemId}
                          data-item-status={row.itemStatus}
                        >
                        <input
                          type="checkbox"
                          data-testid="cart-row-check"
                          disabled={disabled}
                          checked={Boolean(checked[row.cartItemId])}
                          onChange={(event) =>
                            setChecked((prev) => ({ ...prev, [row.cartItemId]: event.target.checked }))
                          }
                        />
                        <div className="cart-product">
                          <div className="cart-thumb" aria-hidden="true">
                            <ShoppingCart size={16} />
                          </div>
                          <div className="cart-info">
                            <b>{row.partName}</b>
                            <span>OE {row.oeNo || '—'}</span>
                          </div>
                        </div>
                        <div className="cart-quality">
                          <span>{row.qualityName || '—'}</span>
                          {disabled && (
                            <small className="danger-link">
                              {invalidReasonText(row.invalidReason || issue?.reason, issue?.message)}
                            </small>
                          )}
                        </div>
                        <div className="cart-price">{money(row.unitPrice)}</div>
                        <div className="cart-qty">× {row.quantity}</div>
                        <div className="cart-price" data-testid="cart-row-amount">
                          {money(row.amount)}
                        </div>
                        {disabled && <span className="cart-status-note">{status.label}</span>}
                        <button
                          className="remove-btn danger-link"
                          data-testid="cart-remove"
                          disabled={disabled || busy}
                          onClick={() => removeItem(row)}
                          aria-label="删除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="cart-footer">
              <span>全量合计 {money(state.cart.totals.itemsAmount)}（服务端）</span>
              <button className="link-btn" onClick={clearCart} disabled={busy} data-testid="cart-clear">
                清空购物车
              </button>
            </div>
          </Card>
          <aside>
            <Card className="checkout-card">
              <h3>结算摘要</h3>
              <div className="cart-selection-summary">
                <span>已选 <b data-testid="cart-checked-count">{checkedRows.length}</b> 件，合计</span>
                <strong data-testid="cart-checked-total">{money(checkedTotal)}</strong>
              </div>
              <Button variant="ghost" onClick={clearCart} disabled={busy} data-testid="cart-clear-bottom">
                清空购物车
              </Button>
              <Button disabled={!checkedIds.length || busy} onClick={checkout} data-testid="cart-checkout">
                去结算 <ChevronRight size={16} />
              </Button>
              <small className="secure-note">提交订单前服务端会重新校验报价有效期与库存。</small>
            </Card>
            <div className="checkout-tip">
              <span>报价来自服务端快照，价格以结算时校验结果为准。</span>
            </div>
          </aside>
        </div>
      ) : (
        !state.loading && (
          <Card>
            <Empty
              icon={<ShoppingCart size={34} />}
              title="购物车为空"
              description="请先在报价结果页选购配件"
              action={
                <Button onClick={() => onNavigate('inquiries')} data-testid="cart-to-quote">
                  去查看报价
                </Button>
              }
            />
          </Card>
        )
      )}
    </>
  )
}
