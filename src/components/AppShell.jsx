// PC 买方工作台外壳：顶栏 + 左侧导航 + 内容区。
// 导航项与契约页面一一对应；确认订单页不在导航里，只能由购物车「去结算」进入。
import React, { useState } from 'react'
import {
  Bell,
  ClipboardList,
  ChevronRight,
  FilePlus2,
  Home,
  MapPin,
  Menu,
  PackageCheck,
  Search,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react'
import { getMockUser } from '../api/client'

export const NAV_ITEMS = [
  { key: 'dashboard', label: '工作台', icon: Home },
  { key: 'publish', label: '发布询价', icon: FilePlus2 },
  { key: 'inquiries', label: '我的询价单', icon: ClipboardList },
  { key: 'quotation-result', label: '报价结果', icon: PackageCheck },
  { key: 'cart', label: '购物车', icon: ShoppingCart },
  { key: 'addresses', label: '收货地址', icon: MapPin },
]

export function AppShell({ path, onNavigate, cartCount = 0, children }) {
  const [mobileNav, setMobileNav] = useState(false)
  const [keyword, setKeyword] = useState('')
  const go = (target) => {
    setMobileNav(false)
    onNavigate(target)
  }
  const search = () => {
    if (!keyword.trim()) return
    go(`inquiries?keyword=${encodeURIComponent(keyword.trim())}`)
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="打开菜单">
          <Menu size={20} />
        </button>
        <div className="brand">
          <span className="brand-mark">华</span>
          <span>
            华汽<span className="brand-dot">·</span>买方工作台
          </span>
        </div>
        <div className="top-search">
          <Search size={17} />
          <input
            data-testid="top-search"
            value={keyword}
            placeholder="搜索询价单号（精确匹配）"
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && search()}
          />
        </div>
        <div className="top-actions">
          <button className="icon-btn" aria-label="通知">
            <Bell size={19} />
          </button>
          <div className="user-chip" title="联调身份：Authorization: Bearer mock-buyer">
            <span className="avatar">明</span>
            <span className="user-copy">
              <b>明远汽服</b>
              <small>{getMockUser()}</small>
            </span>
            <ChevronRight size={16} />
          </div>
        </div>
      </header>
      <div className="layout">
        <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
          <div className="sidebar-top">
            <span>工作空间</span>
            <button className="close-menu" onClick={() => setMobileNav(false)} aria-label="收起菜单">
              <X size={18} />
            </button>
          </div>
          <nav>
            {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                data-testid={`nav-${key}`}
                className={path === key ? 'active' : ''}
                onClick={() => go(key)}
              >
                <Icon size={18} />
                <span>{label}</span>
                {key === 'cart' && cartCount > 0 && <em data-testid="nav-cart-badge">{cartCount}</em>}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="support-icon">
              <Sparkles size={17} />
            </div>
            <div>
              <b>需要帮助？</b>
              <small>查看接口与操作指引</small>
            </div>
          </div>
        </aside>
        {mobileNav && <div className="nav-overlay" onClick={() => setMobileNav(false)} />}
        <main className="main-content">{children}</main>
      </div>
    </div>
  )
}
