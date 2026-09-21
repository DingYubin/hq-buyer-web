// 购物车端到端用例（buyer-cart.html 契约）
// 读取：GET /api/carts/{cartId}；写入：DELETE 单项（version 走 query）/ POST clear
// 勾选与已选金额是前端本地状态，服务端不持久化（契约如此）。
//
// 数据前提：同一买方组织只有一张 ACTIVE 购物车，历史用例下单后的行会以
// itemStatus=CONVERTED 长期保留（契约禁止删除）。因此所有断言只看 NORMAL 行，
// 非 NORMAL 行只用于校验「只读」表现。
import { expect, test } from '@playwright/test'
import { apiOk, money, openPage, remainingItemsAmount, requireBackend, seedCart, waitToastGone } from './support.js'

const detailOf = (request, cartId) => apiOk(request, `/api/carts/${cartId}?pageNum=1&pageSize=100`)
const normalRowsOf = (detail) => detail.list.filter((row) => row.itemStatus === 'NORMAL')
/** 页面上本次用例可操作的那一行（NORMAL）。 */
const normalRow = (page) => page.locator('[data-testid="cart-row"][data-item-status="NORMAL"]')
/** 历史遗留的只读行：CONVERTED / INVALID。 */
const lockedRow = (page) => page.locator('[data-testid="cart-row"]:not([data-item-status="NORMAL"])')

test.describe('购物车', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('明细：行字段、供应商分组、勾选与全选金额都与接口一致', async ({ page, request }) => {
    const seeded = await seedCart(request)
    const detail = await detailOf(request, seeded.cartId)
    const normal = normalRowsOf(detail)
    expect(normal.length, '本次种下的应恰好 1 行 NORMAL').toBe(1)
    const line = normal[0]

    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await expect(page.getByTestId('cart-layout')).toBeVisible()
    // 页面行数 = 接口 total（含历史 CONVERTED/INVALID 行）
    await expect(page.getByTestId('cart-row')).toHaveCount(detail.total)
    await expect(normalRow(page)).toHaveCount(1)
    // 供应商分组：NORMAL 行落在自己供应商的分组里
    await expect(page.getByTestId('cart-group').filter({ hasText: line.supplierName }).first()).toBeVisible()

    const row = normalRow(page).first()
    await expect(row).toHaveAttribute('data-cart-item-id', line.cartItemId)
    await expect(row).toContainText(line.partName)
    await expect(row).toContainText(`OE ${line.oeNo}`)
    await expect(row).toContainText(line.qualityName)
    await expect(row).toContainText(money(line.unitPrice))
    await expect(row).toContainText(`× ${line.quantity}`)
    await expect(row.getByTestId('cart-row-amount')).toHaveText(money(line.amount))

    // 非 NORMAL 行只读：勾选框与删除按钮都禁用（CONVERTED 是已转订单的审计行）
    for (const locked of await lockedRow(page).all()) {
      await expect(locked.getByTestId('cart-row-check')).toBeDisabled()
      await expect(locked.getByTestId('cart-remove')).toBeDisabled()
    }

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

    // 全选 / 取消全选：全选只覆盖 NORMAL 行
    await page.getByTestId('cart-select-all').uncheck()
    await expect(page.getByTestId('cart-checked-count')).toHaveText('0')
    await page.getByTestId('cart-select-all').check()
    await expect(page.getByTestId('cart-checked-count')).toHaveText(String(normal.length))
    await expect(page.getByTestId('cart-checked-total')).toHaveText(
      money(normal.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)),
    )
  })

  test('删除单项：DELETE 带 version，服务端行数减少且 version 递增', async ({ page, request }) => {
    const seeded = await seedCart(request)
    const before = await detailOf(request, seeded.cartId)
    expect(normalRowsOf(before).length).toBe(1)

    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await expect(normalRow(page)).toHaveCount(1)

    await normalRow(page).first().getByTestId('cart-remove').click()
    await expect(page.getByTestId('toast')).toContainText('已删除该配件')
    await expect(normalRow(page)).toHaveCount(0)

    const after = await detailOf(request, seeded.cartId)
    expect(normalRowsOf(after), 'NORMAL 行应被删掉').toHaveLength(0)
    expect(after.version, 'DELETE 后购物车 version 递增').toBeGreaterThan(before.version)
    // 全量合计只统计剩下的历史行（服务端口径：排除 INVALID，保留 CONVERTED）
    expect(after.totals.itemsAmount).toBe(remainingItemsAmount(after.list))
  })

  test('去结算：把勾选行的 cartItemIds 透传给确认订单页', async ({ page, request }) => {
    const seeded = await seedCart(request)
    const detail = await detailOf(request, seeded.cartId)
    const line = normalRowsOf(detail)[0]

    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await normalRow(page).first().getByTestId('cart-row-check').check()
    await page.getByTestId('cart-checkout').click()

    await expect(page).toHaveURL(/#\/order-confirm\?/)
    const query = new URLSearchParams(new URL(page.url()).hash.split('?')[1])
    expect(query.get('cartId')).toBe(seeded.cartId)
    expect(query.get('cartItemIds').split(',')).toEqual([line.cartItemId])
  })

  test('清空购物车：确认弹窗后服务端清零、页面回到空态', async ({ page, request }) => {
    const seeded = await seedCart(request)
    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await expect(normalRow(page)).toHaveCount(1)

    // 取消确认 → 不发请求
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByTestId('cart-clear-bottom').click()
    await expect(normalRow(page)).toHaveCount(1)

    // 确认清空 → POST /carts/{id}/clear
    await waitToastGone(page)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId('cart-clear-bottom').click()
    await expect(page.getByTestId('toast')).toContainText('购物车已清空')
    await expect(normalRow(page)).toHaveCount(0)
    await expect(page.getByTestId('cart-checked-count')).toHaveText('0')

    const after = await detailOf(request, seeded.cartId)
    expect(normalRowsOf(after), 'clear 后不应再有可结算行').toHaveLength(0)
    // CONVERTED 行按契约保留，全量合计只统计它们
    expect(after.totals.itemsAmount).toBe(remainingItemsAmount(after.list))
  })

  test('页面内跳转：返回报价结果入口回到询价单列表', async ({ page, request }) => {
    const seeded = await seedCart(request)
    await openPage(page, `cart?cartId=${seeded.cartId}`)
    await page.getByTestId('cart-back-quote').click()
    await expect(page).toHaveURL(/#\/inquiries$/)
  })
})
