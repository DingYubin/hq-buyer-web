// 购物车端到端用例（buyer-cart.html 契约）
// 读取：GET /api/carts/{cartId}；写入：DELETE 单项（version 走 query）/ POST clear
// 勾选与已选金额是前端本地状态，服务端不持久化（契约如此）。
import { expect, test } from '@playwright/test'
import { amount, apiOk, money, openPage, requireBackend, seedCart, waitToastGone } from './support.js'

const detailOf = (request, cartId) => apiOk(request, `/api/carts/${cartId}?pageNum=1&pageSize=100`)

test.describe('购物车', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('明细：行字段、供应商分组、勾选与全选金额都与接口一致', async ({ page, request }) => {
    const seeded = await seedCart(request)
    const detail = await detailOf(request, seeded.cartId)
    expect(detail.list.length).toBe(1)
    const line = detail.list[0]

    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await expect(page.getByTestId('cart-layout')).toBeVisible()
    await expect(page.getByTestId('cart-group')).toHaveCount(1)
    await expect(page.getByTestId('cart-group').first()).toContainText(line.supplierName)
    await expect(page.getByTestId('cart-row')).toHaveCount(detail.total)

    const row = page.getByTestId('cart-row').first()
    await expect(row).toHaveAttribute('data-cart-item-id', line.cartItemId)
    await expect(row).toContainText(line.partName)
    await expect(row).toContainText(`OE ${line.oeNo}`)
    await expect(row).toContainText(line.qualityName)
    await expect(row).toContainText(money(line.unitPrice))
    await expect(row).toContainText(`× ${line.quantity}`)
    await expect(row.getByTestId('cart-row-amount')).toHaveText(money(line.amount))

    // 未勾选：已选件数 0、金额 ¥0.00、结算按钮禁用
    await expect(page.getByTestId('cart-checked-count')).toHaveText('0')
    await expect(page.getByTestId('cart-checked-total')).toHaveText('¥0.00')
    await expect(page.getByTestId('cart-checkout')).toBeDisabled()

    // 勾选单行：件数 1，金额 = 单价 × 数量（前端本地计算，与服务端行金额一致）
    await row.getByTestId('cart-row-check').check()
    await expect(page.getByTestId('cart-checked-count')).toHaveText('1')
    await expect(page.getByTestId('cart-checked-total')).toHaveText(money(line.amount))
    await expect(page.getByTestId('cart-checked-total')).toHaveText(
      money(Number(line.unitPrice) * line.quantity),
    )
    await expect(page.getByTestId('cart-checkout')).toBeEnabled()

    // 全选 / 取消全选
    await page.getByTestId('cart-select-all').uncheck()
    await expect(page.getByTestId('cart-checked-count')).toHaveText('0')
    await page.getByTestId('cart-select-all').check()
    await expect(page.getByTestId('cart-checked-count')).toHaveText(String(detail.list.length))
    await expect(page.getByTestId('cart-checked-total')).toHaveText(
      money(detail.list.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)),
    )
  })

  test('删除单项：DELETE 带 version，服务端行数减少且 version 递增', async ({ page, request }) => {
    const seeded = await seedCart(request)
    const before = await detailOf(request, seeded.cartId)
    expect(before.list.length).toBe(1)

    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await expect(page.getByTestId('cart-row')).toHaveCount(1)

    await page.getByTestId('cart-remove').first().click()
    await expect(page.getByTestId('toast')).toContainText('已删除该配件')
    await expect(page.getByTestId('cart-row')).toHaveCount(0)

    const after = await detailOf(request, seeded.cartId)
    expect(after.total).toBe(0)
    expect(after.list).toHaveLength(0)
    expect(after.version, 'DELETE 后购物车 version 递增').toBeGreaterThan(before.version)
    expect(after.totals.itemsAmount).toBe('0.00')
  })

  test('去结算：把勾选行的 cartItemIds 透传给确认订单页', async ({ page, request }) => {
    const seeded = await seedCart(request)
    const detail = await detailOf(request, seeded.cartId)
    const line = detail.list[0]

    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await page.getByTestId('cart-row-check').first().check()
    await page.getByTestId('cart-checkout').click()

    await expect(page).toHaveURL(/#\/order-confirm\?/)
    const query = new URLSearchParams(new URL(page.url()).hash.split('?')[1])
    expect(query.get('cartId')).toBe(seeded.cartId)
    expect(query.get('cartItemIds').split(',')).toEqual([line.cartItemId])
  })

  test('清空购物车：确认弹窗后服务端清零、页面回到空态', async ({ page, request }) => {
    const seeded = await seedCart(request)
    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await expect(page.getByTestId('cart-row')).toHaveCount(1)

    // 取消确认 → 不发请求
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByTestId('cart-clear').click()
    await expect(page.getByTestId('cart-row')).toHaveCount(1)

    // 确认清空 → POST /carts/{id}/clear
    await waitToastGone(page)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId('cart-clear').click()
    await expect(page.getByTestId('toast')).toContainText('购物车已清空')
    await expect(page.getByTestId('cart-row')).toHaveCount(0)
    await expect(page.getByTestId('cart-checked-count')).toHaveText('0')

    const after = await detailOf(request, seeded.cartId)
    expect(after.total).toBe(0)
    expect(after.totals.itemsAmount).toBe('0.00')
  })

  test('页面内跳转：返回报价结果入口回到询价单列表', async ({ page, request }) => {
    const seeded = await seedCart(request)
    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await page.getByTestId('cart-back-quote').click()
    await expect(page).toHaveURL(/#\/inquiries$/)
  })
})
