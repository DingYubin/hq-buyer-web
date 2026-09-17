// 工作台（首页）：只做真实数据汇总与入口，不承担业务写入。
// 数据来源：询价单列表（按状态分组计数）+ 购物车列表。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  CarFront,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  MapPin,
  PackageCheck,
  Plus,
  ShoppingCart,
  Truck,
} from 'lucide-react'
import { api } from '../api/client'
import { formatDateTime, inquiryStatusMeta } from '../lib/format'
import { Button, Card, ErrorBox, PageHead, Status } from '../components/ui'

const ACTIVE_STATUSES = ['PUBLISHED', 'QUOTING', 'PARTIALLY_QUOTED']

export default function DashboardPage({ onNavigate }) {
  /** 竞态保护：丢弃过期响应，避免旧汇总覆盖新结果。 */
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
      setState({
        loading: false,
        error: null,
        active,
        quoted,
        cart: carts.list?.[0] || null,
        recent: recent.list || [],
      })
    } catch (error) {
      setState({ loading: false, error, active: null, quoted: null, cart: null, recent: [] })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const cartCount = state.cart?.itemCount ?? 0

  return (
    <>
      <PageHead
        eyebrow="首页 / 工作台"
        title="明远汽服 · 采购工作台"
        description="报价、购物车、收货地址与下单全部走真实接口。"
        action={
          <Button data-testid="dashboard-publish" onClick={() => onNavigate('publish')}>
            <Plus size={17} />
            发布询价
          </Button>
        }
      />
      <ErrorBox error={state.error} onRetry={load} />
      <div className="hero-banner">
        <div>
          <span className="hero-kicker">华汽采购助手</span>
          <h2>
            让每一次采购
            <br />
            <strong>更简单、更透明</strong>
          </h2>
          <p>从发布询价到订单提交，全流程在线协作。</p>
          <Button variant="soft" onClick={() => onNavigate('publish')}>
            开始发布询价 <ChevronRight size={16} />
          </Button>
        </div>
        <div className="hero-art">
          <div className="art-circle" />
          <CarFront size={105} />
          <div className="float-card">
            <span>已报价询价单</span>
            <b>{state.loading ? '—' : (state.quoted?.total ?? 0)}</b>
            <small>可直接进入报价结果页选购</small>
          </div>
        </div>
      </div>
      <div className="stats-grid">
        <Stat
          label="进行中询价"
          value={state.loading ? '—' : String(state.active?.total ?? 0)}
          meta="待报价 / 报价中"
          tone="orange"
          icon={<ClipboardList />}
          testId="stat-active"
        />
        <Stat
          label="待处理报价"
          value={state.loading ? '—' : String(state.quoted?.total ?? 0)}
          meta="已报出，可选购"
          icon={<PackageCheck />}
          testId="stat-quoted"
        />
        <Stat
          label="购物车商品"
          value={state.loading ? '—' : String(cartCount)}
          meta={state.cart ? `购物车 v${state.cart.version}` : '暂无进行中购物车'}
          icon={<ShoppingCart />}
          testId="stat-cart"
        />
        <Stat
          label="待收货订单"
          value="—"
          meta="订单列表接口未开放"
          icon={<Truck />}
          testId="stat-orders"
        />
      </div>
      <div className="content-columns">
        <Card>
          <div className="card-head">
            <div>
              <h3>最近询价单</h3>
              <p>取自 GET /api/inquiries 最近 3 条</p>
            </div>
            <button className="link-btn" onClick={() => onNavigate('inquiries')}>
              查看全部 <ChevronRight size={15} />
            </button>
          </div>
          <div className="inquiry-mini-list" data-testid="dashboard-recent">
            {state.recent.map((row) => {
              const meta = inquiryStatusMeta(row.status)
              return (
                <div className="mini-row" key={row.inquiryId}>
                  <div className="mini-icon">
                    <CarFront size={18} />
                  </div>
                  <div className="mini-main">
                    <b>{row.vinMasked || row.inquiryNo}</b>
                    <span>
                      {row.inquiryNo} · {row.itemCount} 项配件
                    </span>
                  </div>
                  <div className="mini-meta">
                    <Status tone={meta.tone}>{meta.label}</Status>
                    <small>{formatDateTime(row.updatedAt)}</small>
                  </div>
                </div>
              )
            })}
            {!state.loading && state.recent.length === 0 && <div className="empty">还没有询价单，先去发布一个吧</div>}
          </div>
        </Card>
        <Card className="quick-card">
          <div className="card-head">
            <div>
              <h3>常用功能</h3>
              <p>快速进入工作流程</p>
            </div>
          </div>
          <div className="quick-grid">
            <Quick icon={<FilePlus2 />} label="发布询价" onClick={() => onNavigate('publish')} />
            <Quick icon={<PackageCheck />} label="查看报价" onClick={() => onNavigate('inquiries')} />
            <Quick icon={<ShoppingCart />} label="购物车" onClick={() => onNavigate('cart')} />
            <Quick icon={<MapPin />} label="收货地址" onClick={() => onNavigate('addresses')} />
          </div>
        </Card>
      </div>
    </>
  )
}

function Stat({ label, value, meta, tone, icon, testId }) {
  return (
    <div className="stat-card" data-testid={testId}>
      <div className={`stat-icon ${tone || ''}`}>{icon}</div>
      <span>{label}</span>
      <b className={tone || ''}>{value}</b>
      <small>{meta}</small>
    </div>
  )
}

function Quick({ icon, label, onClick }) {
  return (
    <button className="quick-item" onClick={onClick}>
      <span>{icon}</span>
      <b>{label}</b>
      <ChevronRight size={15} />
    </button>
  )
}
