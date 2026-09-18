// 工作台（首页）端到端用例：只读汇总，数据全部来自真实接口。
// 统计卡取询价单总数 / 购物车商品数；订单数因订单列表接口未开放固定展示「—」。
import { expect, test } from '@playwright/test'
import { apiOk, openPage, requireBackend } from './support.js'

const countInquiries = (request, status) => {
  const search = new URLSearchParams({ pageNum: '1', pageSize: '1' })
  status.forEach((item) => search.append('status[]', item))
  return apiOk(request, `/api/inquiries?${search.toString()}`)
}

test.describe('工作台', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('统计卡与最近询价单取自接口，发布询价入口可跳转', async ({ page, request }) => {
    const active = await countInquiries(request, ['PUBLISHED', 'QUOTING', 'PARTIALLY_QUOTED'])
    const quoted = await countInquiries(request, ['QUOTED'])
    const carts = await apiOk(request, '/api/carts?status=ACTIVE&pageNum=1&pageSize=1')
    const recent = await apiOk(request, '/api/inquiries?pageNum=1&pageSize=3')

    await openPage(page, 'dashboard')

    await expect(page.getByTestId('stat-active')).toContainText(String(active.total))
    await expect(page.getByTestId('stat-active')).toContainText('待处理询价')
    await expect(page.getByTestId('stat-quoted')).toContainText(String(quoted.total))
    await expect(page.getByTestId('stat-cart')).toContainText(String(carts.list[0]?.itemCount ?? 0))
    // 订单列表接口尚未开放：卡片固定展示占位符，不允许前端臆造数据
    await expect(page.getByTestId('stat-orders')).toContainText('—')

    await expect(page.getByTestId('dashboard-recent').locator('.mini-row')).toHaveCount(recent.list.length)
    if (recent.list.length > 0) {
      const first = recent.list[0]
      const row = page.getByTestId('dashboard-recent').locator('.mini-row').first()
      await expect(row).toContainText(first.inquiryNo)
      await expect(row).toContainText(`${first.itemCount} 项配件`)
    }

    await page.getByTestId('dashboard-publish').click()
    await expect(page).toHaveURL(/#\/publish$/)
  })

  test('外壳导航：购物车角标取 ACTIVE 行数合计，顶栏用户菜单可进收货地址', async ({ page, request }) => {
    const carts = await apiOk(request, '/api/carts?status=ACTIVE&pageNum=1&pageSize=5')
    let expected = 0
    for (const cart of carts.list || []) {
      const detail = await apiOk(request, `/api/carts/${cart.cartId}?pageNum=1&pageSize=100`)
      expected += detail.list.length
    }

    await openPage(page, 'dashboard')
    if (expected > 0) {
      await expect(page.getByTestId('nav-cart-badge')).toHaveText(String(expected))
    } else {
      await expect(page.getByTestId('nav-cart-badge')).toHaveCount(0)
    }

    // 收货地址不在六项侧栏里（原型如此），入口在顶栏用户菜单「收货地址管理」。
    await page.getByTestId('user-chip').click()
    await expect(page.getByTestId('user-menu')).toBeVisible()
    await page.getByTestId('user-menu-addresses').click()
    await expect(page).toHaveURL(/#\/addresses$/)
    await expect(page.getByTestId('address-table')).toBeVisible()
  })
})
