// 工作台（首页）：只做真实数据汇总与入口，不承担业务写入。
// 数据来源：询价单列表（按状态分组计数）+ 购物车列表。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, ClipboardList, FilePlus2, PackageCheck, ShoppingCart, Truck } from 'lucide-react'
import { api } from '../api/client'
import { formatDateTime, inquiryStatusMeta } from '../lib/format'
import { Button, Card, ErrorBox, PageHead, Status } from '../components/ui'

const ACTIVE_STATUSES = ['PUBLISHED', 'QUOTING', 'PARTIALLY_QUOTED']

export default function DashboardPage({ onNavigate }) {
  const loadSeq = useRef(0)
  const [state, setState] = useState({ loading: true, error: null, active: null, quoted: null, cart: null, recent: [] })

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const [active, quoted, carts, recent] = await Promise.all([
        api.listInquiries({ pageNum: 1, pageSize: 1, status: ACTIVE_STATUSES }),
        api.listInquiries({ pageNum: 1, pageSize: 1, status: ['QUOTED'] }),
        api.listCarts({ status: 'ACTIVE', pageNum: 1, pageSize: 1 }),
        api.listInquiries({ pageNum: 1, pageSize: 3 }),
      ])
      if (seq !== loadSeq.current) return
      setState({ loading: false, error: null, active, quoted, cart: carts.list?.[0] || null, recent: recent.list || [] })
    } catch (error) {
      if (seq !== loadSeq.current) return
      setState({ loading: false, error, active: null, quoted: null, cart: null, recent: [] })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const cartCount = state.cart?.itemCount ?? 0

  return (
    <>
      <PageHead eyebrow="首页 / 工作台" title="早上好，明少" description="今天也高效完成采购任务吧。" />
      <ErrorBox error={state.error} onRetry={load} />

      <div className="stats-grid dashboard-stats">
        <Stat label="待处理询价" value={state.loading ? '—' : String(state.active?.total ?? 0)} meta="待报价 / 报价中" tone="orange" icon={<ClipboardList />} testId="stat-active" />
        <Stat label="待确认报价" value={state.loading ? '—' : String(state.quoted?.total ?? 0)} meta="已报出，可选购" icon={<PackageCheck />} testId="stat-quoted" />
        <Stat label="进行中订单" value="—" meta="订单列表接口未开放" icon={<Truck />} testId="stat-orders" />
        <Stat label="购物车商品" value={state.loading ? '—' : String(cartCount)} meta="已选报价配件" icon={<ShoppingCart />} testId="stat-cart" />
      </div>

      <Card className="quick-card dashboard-quick">
        <div className="card-head">
          <div><h3>常用功能</h3><p>快速进入工作流程</p></div>
        </div>
        <div className="quick-grid">
          <Quick testid="dashboard-publish" icon={<FilePlus2 />} label="发布询价" detail="上传配件清单" onClick={() => onNavigate('publish')} />
          <Quick icon={<PackageCheck />} label="查看报价" detail="对比供应商报价" onClick={() => onNavigate('inquiries')} />
          <Quick icon={<Truck />} label="订单跟踪" detail="查看履约进度" disabled />
          <Quick icon={<ClipboardList />} label="审批中心" detail="处理审批待办" disabled />
        </div>
      </Card>

      <Card className="recent-card">
        <div className="card-head">
          <div><h3>最近询价单</h3><p>实时读取最近 3 条询价记录</p></div>
          <button className="link-btn" onClick={() => onNavigate('inquiries')}>查看全部 <ChevronRight size={15} /></button>
        </div>
        <div className="inquiry-mini-list" data-testid="dashboard-recent">
          {state.recent.map((row) => {
            const meta = inquiryStatusMeta(row.status)
            return (
              <div className="mini-row" key={row.inquiryId}>
                <div className="mini-icon"><ClipboardList size={16} /></div>
                <div className="mini-main"><b>{row.inquiryNo}</b><span>{row.vinMasked || '未填写 VIN'} · {row.itemCount} 项配件</span></div>
                <div className="mini-meta"><Status tone={meta.tone}>{meta.label}</Status><small>{formatDateTime(row.updatedAt)}</small></div>
              </div>
            )
          })}
          {!state.loading && state.recent.length === 0 && <div className="empty">还没有询价单，先去发布一个吧</div>}
        </div>
      </Card>
    </>
  )
}

function Stat({ label, value, meta, tone, icon, testId }) {
  return <div className="stat-card" data-testid={testId}><div className={`stat-icon ${tone || ''}`}>{icon}</div><span>{label}</span><b className={tone || ''}>{value}</b><small>{meta}</small></div>
}

function Quick({ icon, label, detail, onClick, disabled = false, testid }) {
  return <button data-testid={testid} className={`quick-item ${disabled ? 'disabled' : ''}`} onClick={onClick} disabled={disabled}><span>{icon}</span><div><b>{label}</b><small>{detail}</small></div>{!disabled && <ChevronRight size={15} />}</button>
}
