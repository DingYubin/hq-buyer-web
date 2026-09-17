// 确认订单端到端用例（buyer-order-confirm.html 契约）
// 读取：购物车明细（取 version）+ GET /api/addresses?status=ACTIVE
// 写入：POST /api/orders/preview（服务端算钱）→ POST /api/orders（原样回传 previewToken）
import { expect, test } from '@playwright/test'
import { apiOk, money, openPage, requireBackend, seedCart } from './support.js'

const INVOICE_TITLE = '昆明明远汽车服务有限公司'

const detailOf = (request, cartId) => apiOk(request, `/api/carts/${cartId}?pageNum=1&pageSize=100`)
const activeAddresses = (request) => apiOk(request, '/api/addresses?status=ACTIVE&pageNum=1&pageSize=50')
const previewOrder = (request, body) => apiOk(request, '/api/orders/preview', { method: 'POST', data: body })

test.describe('确认订单', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('预览金额取自服务端，管理费只提报不计入合计，提交后落单', async ({ page, request }) => {
    const seeded = await seedCart(request)
    const cart = await detailOf(request, seeded.cartId)
    const line = cart.list[0]
    const addresses = await activeAddresses(request)
    const address = addresses.list.find((row) => row.isDefault) || addresses.list[0]
    expect(address, '提交订单前需要存在 ACTIVE 收货地址').toBeTruthy()

    await openPage(page, `order-confirm?cartId=${seeded.cartId}&cartItemIds=${line.cartItemId}`)

    // 默认选中默认地址（含同步状态与联系方式）
    const option = page.getByTestId('order-address-option').filter({ hasText: address.contact.name })
    await expect(option).toHaveClass(/active/)
    await expect(option).toContainText(address.contact.phone)
    await expect(page.getByTestId('order-manage-address')).toBeVisible()

    // 发票抬头未填：前端拦截，不发预览、不能提交
    await expect(page.getByTestId('totals-grand-total')).toHaveText('—')
    await expect(page.getByTestId('order-submit')).toBeDisabled()

    await page.getByTestId('invoice-title').fill(INVOICE_TITLE)
    await expect(page.getByTestId('totals-grand-total')).not.toHaveText('—', { timeout: 20_000 })

    // 与服务端预览结果逐项核对（前端不自行算钱）
    const baseBody = {
      cartId: seeded.cartId,
      cartItemIds: [line.cartItemId],
      shippingAddressId: address.addressId,
      invoice: { invoiceType: 'NORMAL', title: INVOICE_TITLE },
      contact: address.contact,
      deliveryMode: 'EXPRESS',
      deliveryTime: 'ANY',
      serviceFeeRequest: { enabled: false },
      version: cart.version,
    }
    const preview = await previewOrder(request, baseBody)
    expect(preview.totals.grandTotal).toBe(preview.totals.goods)
    expect(preview.totals.freight).toBe('0.00')
    await expect(page.getByTestId('totals-goods')).toHaveText(money(preview.totals.goods))
    await expect(page.getByTestId('totals-freight')).toHaveText(money(preview.totals.freight))
    await expect(page.getByTestId('totals-discount')).toHaveText(money(preview.totals.discount))
    await expect(page.getByTestId('totals-grand-total')).toHaveText(money(preview.totals.grandTotal))
    await expect(page.getByTestId('order-grand-total')).toHaveText(money(preview.totals.grandTotal))
    await expect(page.getByTestId('order-item-group')).toHaveCount(1)
    await expect(page.getByTestId('order-item-row')).toHaveCount(1)
    await expect(page.getByTestId('order-item-row').first()).toContainText(line.partName)
    await expect(page.getByTestId('order-vehicle-vin')).toHaveText(preview.vehicle.vin)

    // 管理费：金额由服务端按费率算，且不计入应付总额。
    // 页面输入 "12.5"，提交前按契约补零为 "12.50"（费率同为两位小数字符串）。
    await page.getByTestId('service-fee-toggle').check()
    await expect(page.getByTestId('service-fee-rate')).toBeVisible()
    await page.getByTestId('service-fee-rate').fill('12.5')
    const feeBody = { ...baseBody, serviceFeeRequest: { enabled: true, rate: '12.50' } }
    const feePreview = await previewOrder(request, feeBody)
    expect(Number(feePreview.serviceFeeRequest.amount)).toBeGreaterThan(0)
    expect(feePreview.totals.grandTotal, '管理费不计入应付总额').toBe(preview.totals.grandTotal)
    await expect(page.getByTestId('service-fee-amount')).toHaveText(money(feePreview.serviceFeeRequest.amount))
    await expect(page.getByTestId('totals-grand-total')).toHaveText(money(feePreview.totals.grandTotal))

    // 提交订单：body 与预览一致 + previewToken
    await page.getByTestId('order-submit').click()
    await expect(page.getByTestId('order-success')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('order-success-no')).toHaveText(/^HQO\d{12}$/)
    await expect(page.getByTestId('order-success-total')).toHaveText(money(feePreview.totals.grandTotal))

    // 下单后购物车行转为已转订单（不可再结算）
    const afterSubmit = await detailOf(request, seeded.cartId)
    expect(afterSubmit.list.filter((row) => row.itemStatus === 'NORMAL')).toHaveLength(0)
  })

  test('发票类型切换：NONE 隐藏抬头，VAT_SPECIAL 需要税号，必填未填时禁止提交', async ({ page, request }) => {
    const seeded = await seedCart(request)
    const cart = await detailOf(request, seeded.cartId)
    const line = cart.list[0]

    await openPage(page, `order-confirm?cartId=${seeded.cartId}&cartItemIds=${line.cartItemId}`)
    await expect(page.getByTestId('invoice-title')).toBeVisible()

    // 专票：抬头 + 税号，税号未填不可提交
    await page.getByTestId('invoice-type-VAT_SPECIAL').click()
    await expect(page.getByTestId('invoice-tax-no')).toBeVisible()
    await page.getByTestId('invoice-title').fill(INVOICE_TITLE)
    await expect(page.getByTestId('order-submit')).toBeDisabled()
    await page.getByTestId('invoice-tax-no').fill('91530100MA6K1234XA')
    await expect(page.getByTestId('totals-grand-total')).not.toHaveText('—', { timeout: 20_000 })
    await expect(page.getByTestId('order-submit')).toBeEnabled()

    // 不需要发票：抬头 / 税号都隐藏，仍可正常预览
    await page.getByTestId('invoice-type-NONE').click()
    await expect(page.getByTestId('invoice-title')).toHaveCount(0)
    await expect(page.getByTestId('invoice-tax-no')).toHaveCount(0)
    await expect(page.getByTestId('totals-grand-total')).not.toHaveText('—')

    // 切回普票并清空抬头：前端拦截（后端 Joi 同样要求 title 必填）
    await page.getByTestId('invoice-type-NORMAL').click()
    await page.getByTestId('invoice-title').fill(INVOICE_TITLE)
    await expect(page.getByTestId('order-submit')).toBeEnabled()
    await page.getByTestId('invoice-title').fill('')
    await expect(page.getByTestId('order-submit')).toBeDisabled()
  })
})
