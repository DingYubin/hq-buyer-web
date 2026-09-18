// PC 买方工作台外壳：顶栏 + 左侧导航 + 内容区。
// 导航项与契约页面一一对应；确认订单页不在导航里，只能由购物车「去结算」进入。
import React, { useState } from 'react'
import {
  Bell,
  ClipboardList,
  ChevronRight,
  FilePlus2,
  Home,
  LogOut,
  MapPin,
  Menu,
  PackageCheck,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react'

export const NAV_ITEMS = [
  { key: 'dashboard', label: '工作台', icon: Home },
  { key: 'publish', label: '发布询价', icon: FilePlus2 },
  { key: 'inquiries', label: '查看报价', icon: ClipboardList },
  { key: 'orders', label: '订单跟踪', icon: PackageCheck, disabled: true },
  { key: 'aftersale', label: '售后明细', icon: ShoppingCart, disabled: true },
  { key: 'approve', label: '审批中心', icon: MapPin, disabled: true, badge: 3 },
]

export function AppShell({ path, onNavigate, cartCount = 0, children }) {
  const [mobileNav, setMobileNav] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const [keyword, setKeyword] = useState('')
  const go = (target) => {
    setMobileNav(false)
    setUserMenu(false)
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
          <span>华汽配件直供</span>
        </div>
        <div className="top-search">
          <Search size={17} />
          <input
            data-testid="top-search"
            value={keyword}
            placeholder="搜索询价单、订单或配件名称"
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && search()}
          />
        </div>
        <div className="top-actions">
          <button className="icon-btn" aria-label="通知">
            <Bell size={19} />
            <i>3</i>
          </button>
          {/* 顶栏用户菜单：原型里收货地址入口在这里，侧栏保持六项。 */}
          <div className="user-chip-wrap">
            <button
              type="button"
              className="user-chip"
              data-testid="user-chip"
              title="当前登录用户：明少"
              aria-expanded={userMenu}
              onClick={() => setUserMenu((open) => !open)}
            >
              <span className="avatar">李</span>
              <span className="user-copy"><b>明少</b></span>
              <ChevronRight size={16} />
            </button>
            {userMenu && (
              <div className="user-menu" data-testid="user-menu">
                <button data-testid="user-menu-addresses" onClick={() => go('addresses')}>
                  <MapPin size={15} />
                  <span>收货地址管理</span>
                </button>
                <button data-testid="user-menu-account" disabled>
                  <Settings size={15} />
                  <span>账号设置</span>
                </button>
                <button className="logout" data-testid="user-menu-logout" disabled>
                  <LogOut size={15} />
                  <span>退出登录</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="layout">
        <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
          <div className="sidebar-top">
            <span>买家工作台</span>
            <button className="close-menu" onClick={() => setMobileNav(false)} aria-label="收起菜单">
              <X size={18} />
            </button>
          </div>
          <nav>
            {NAV_ITEMS.map(({ key, label, icon: Icon, disabled, badge }) => (
              <button
                key={key}
                data-testid={`nav-${key}`}
                className={`${path === key ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => !disabled && go(key)}
                disabled={disabled}
              >
                <Icon size={18} />
                <span>{label}</span>
                {key === 'approve' && <em>{badge}</em>}
              </button>
            ))}
            <div className="sidebar-subnav">
              <button data-testid="nav-quotation-result" className={path === 'quotation-result' ? 'active' : ''} onClick={() => go('quotation-result')}>
                <PackageCheck size={18} />
                <span>报价结果</span>
              </button>
              <button data-testid="nav-cart" className={path === 'cart' ? 'active' : ''} onClick={() => go('cart')}>
                <ShoppingCart size={18} />
                <span>购物车</span>
                {cartCount > 0 && <em data-testid="nav-cart-badge">{cartCount}</em>}
              </button>
              <button data-testid="nav-addresses" className={path === 'addresses' ? 'active' : ''} onClick={() => go('addresses')}>
                <MapPin size={18} />
                <span>收货地址</span>
              </button>
            </div>
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
