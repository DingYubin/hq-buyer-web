// 买方 PC 工作台入口：hash 路由（#/cart?cartId=x）+ 页面级状态。
// 契约页面：工作台 / 发布询价 / 询价单列表 / 报价结果 / 购物车 / 确认订单 / 收货地址。
// 所有数据都来自 hq-buyer-service 真实接口（Authorization: Bearer mock-buyer），前端不做金额计算。
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api/client'
import { AppShell, NAV_ITEMS } from './components/AppShell'
import { ToastProvider } from './components/ui'
import AddressPage from './pages/AddressPage'
import CartPage from './pages/CartPage'
import DashboardPage from './pages/DashboardPage'
import InquiryListPage from './pages/InquiryListPage'
import OrderConfirmPage from './pages/OrderConfirmPage'
import PublishInquiryPage from './pages/PublishInquiryPage'
import QuotationResultPage from './pages/QuotationResultPage'
import './styles.css'

const ROUTES = new Set(['dashboard', 'publish', 'inquiries', 'quotation-result', 'cart', 'order-confirm', 'addresses'])

/** 解析 location.hash：'#/cart?cartId=cart_1' → { path: 'cart', params: URLSearchParams } */
function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [path, search] = raw.split('?')
  const next = ROUTES.has(path) ? path : 'dashboard'
  return { path: next, params: new URLSearchParams(search || '') }
}

function App() {
  const [route, setRoute] = useState(parseHash)
  const [cartCount, setCartCount] = useState(0)

  const navigate = useCallback((target) => {
    const next = String(target || 'dashboard').replace(/^#?\/?/, '')
    if (`#/${next}` === window.location.hash) {
      setRoute(parseHash())
      return
    }
    window.location.hash = `#/${next}`
  }, [])

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // 购物车角标：跨页面（购物车 / 确认订单）都会改动购物车，所以按路由变化重新拉取。
  const refreshCartCount = useCallback(async () => {
    try {
      const carts = await api.listCarts({ status: 'ACTIVE', pageNum: 1, pageSize: 5 })
      let total = 0
      for (const cart of carts.list || []) {
        const detail = await api.getCart(cart.cartId, { pageNum: 1, pageSize: 100 })
        total += (detail.list || []).length
      }
      setCartCount(total)
    } catch {
      /* 角标失败不阻塞页面 */
    }
  }, [])

  useEffect(() => {
    if (route.path === 'cart') return
    refreshCartCount()
  }, [refreshCartCount, route.path])

  const cartItemIds = useMemo(
    () => (route.params.get('cartItemIds') || '').split(',').filter(Boolean),
    [route.params],
  )

  const topKey = route.path === 'order-confirm' ? 'cart' : route.path
  const activeNav = NAV_ITEMS.some((item) => item.key === topKey) ? topKey : 'dashboard'
  const pageKey = `${route.path}?${route.params.toString()}`

  const renderPage = () => {
    switch (route.path) {
      case 'publish':
        return (
          <PublishInquiryPage
            onNavigate={navigate}
            draftId={route.params.get('draftId') || undefined}
          />
        )
      case 'inquiries':
        return (
          <InquiryListPage
            onNavigate={navigate}
            keyword={route.params.get('keyword') || ''}
            highlight={route.params.get('highlight') || undefined}
          />
        )
      case 'quotation-result':
        return (
          <QuotationResultPage
            onNavigate={navigate}
            inquiryId={route.params.get('inquiryId') || undefined}
          />
        )
      case 'cart':
        return (
          <CartPage
            cartId={route.params.get('cartId') || undefined}
            onNavigate={navigate}
            onCartChange={setCartCount}
          />
        )
      case 'order-confirm':
        return (
          <OrderConfirmPage
            cartId={route.params.get('cartId') || undefined}
            cartItemIds={cartItemIds}
            onNavigate={navigate}
          />
        )
      case 'addresses':
        return <AddressPage onNavigate={navigate} />
      default:
        return <DashboardPage onNavigate={navigate} />
    }
  }

  return (
    <AppShell path={activeNav} onNavigate={navigate} cartCount={cartCount}>
      <div key={pageKey}>{renderPage()}</div>
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
)
