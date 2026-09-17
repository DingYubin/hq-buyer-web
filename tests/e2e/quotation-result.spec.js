// 报价结果页端到端用例（buyer-quotation-result.html 契约）
// 读取：询价详情 + 需求项 + GET /api/inquiries/{id}/quotations（按配件分组）+ 已保存选择
// 写入：POST /api/inquiries/{id}/quotation-selection → 加入购物车
import { expect, test } from '@playwright/test'
import { apiOk, money, openPage, requireBackend, seedPublishedInquiry, seedQuotedInquiry } from './support.js'

const listQuotations = (request, inquiryId) =>
  apiOk(request, `/api/inquiries/${inquiryId}/quotations?pageNum=1&pageSize=100&groupBy=PART&sort=MATCH`)

const cartIdOf = (page) => new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('cartId')

test.describe('报价结果页', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('报价按配件分组展示，选中后加入购物车并落库（选择 + 购物车行）', async ({ page, request }) => {
    const quote = await seedQuotedInquiry(request)
    const quotes = await listQuotations(request, quote.inquiryId)
    expect(quotes.list.length, '造数后应有一条报价').toBe(1)
    const line = quotes.list[0]

    await openPage(page, `quotation-result?inquiryId=${quote.inquiryId}`)

    // 页头摘要：询价单号 / 报价行数 / 需求项
    await expect(page.getByTestId('quote-inquiry-no')).toHaveText(quote.inquiryNo)
    await expect(page.getByTestId('quote-total')).toHaveText(String(quotes.list.length))
    await expect(page.getByTestId('quote-deadline')).toHaveText(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$|^—$/,
    )

    // 报价分组：按需求项分组，组内展示商家别名、品质/交期/有效期、单价
    await expect(page.getByTestId('quote-group')).toHaveCount(1)
    await expect(page.getByTestId('quote-part-name')).toHaveText(quote.itemName)
    const row = page.getByTestId('quote-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(line.anonymousSupplierName)
    await expect(row).toContainText(line.qualityCode === 'MOCK_ORIGINAL' ? '联调原厂品质' : line.qualityCode)
    await expect(row).toContainText(`交期 ${line.leadTimeDays} 天`)
    await expect(row).toContainText(money(line.sellAmount))
    await expect(row.getByTestId('quote-unavailable')).toHaveCount(0)

    // 未选择时不能加购
    await expect(page.getByTestId('selection-count')).toHaveText('0')
    await expect(page.getByTestId('selection-total')).toHaveText('¥0.00')
    await expect(page.getByTestId('save-selection')).toBeDisabled()

    // 选择报价 → 右侧已选摘要按 单价 × 数量 计算
    await row.getByTestId('quote-select').click()
    await expect(page.getByTestId('selection-count')).toHaveText('1')
    const chosenQuantity = Math.max(1, Math.min(line.availableQuantity, quote.quantity))
    const expectedTotal = Number(line.sellAmount) * chosenQuantity
    await expect(page.getByTestId('selection-total')).toHaveText(money(expectedTotal))

    // 同一配件再次点击 = 取消选择
    await row.getByTestId('quote-select').click()
    await expect(page.getByTestId('selection-count')).toHaveText('0')
    await row.getByTestId('quote-select').click()
    await expect(page.getByTestId('selection-count')).toHaveText('1')

    // 加入购物车：先写选择（POST quotation-selection），再写购物车行
    await page.getByTestId('save-selection').click()
    await expect(page).toHaveURL(/#\/cart\?cartId=/, { timeout: 20_000 })
    const cartId = cartIdOf(page)
    expect(cartId, '加购后应跳转到带 cartId 的购物车页').toBeTruthy()

    const selection = await apiOk(request, `/api/inquiries/${quote.inquiryId}/quotation-selection`)
    expect(selection.selections, '选择结果应写入服务端').toHaveLength(1)
    expect(selection.selections[0]).toMatchObject({
      inquiryItemId: quote.inquiryItemId,
      quotationItemId: quote.quotationItemId,
      unitPrice: line.sellAmount,
    })

    const cart = await apiOk(request, `/api/carts/${cartId}?pageNum=1&pageSize=100`)
    const cartLine = cart.list.find((item) => item.inquiryItemId === quote.inquiryItemId)
    expect(cartLine, '购物车应包含刚选购的报价行').toBeTruthy()
    expect(cartLine.partName).toBe(quote.itemName)
    expect(cartLine.unitPrice).toBe(line.sellAmount)
    expect(cartLine.itemStatus).toBe('NORMAL')
  })

  test('暂无报价：展示空态与刷新入口', async ({ page, request }) => {
    const inquiry = await seedPublishedInquiry(request, { itemName: '后视镜' })
    await openPage(page, `quotation-result?inquiryId=${inquiry.inquiryId}`)

    await expect(page.getByTestId('quote-inquiry-no')).toHaveText(inquiry.inquiryNo)
    await expect(page.getByTestId('quote-total')).toHaveText('0')
    await expect(page.getByTestId('quote-group')).toHaveCount(0)
    await expect(page.getByText('暂无报价')).toBeVisible()
    await expect(page.getByTestId('quote-refresh')).toBeVisible()
    await expect(page.getByTestId('save-selection')).toBeDisabled()

    await page.getByTestId('quote-refresh').click()
    await expect(page.getByTestId('quote-total')).toHaveText('0')
  })

  test('缺少 inquiryId：展示错误态且不发起报价请求', async ({ page }) => {
    const calls = []
    page.on('request', (req) => {
      if (req.url().includes('/quotations')) calls.push(req.url())
    })

    await openPage(page, 'quotation-result')
    await expect(page.getByTestId('error-box')).toContainText('缺少 inquiryId 参数')
    await expect(page.getByTestId('quote-inquiry-no')).toHaveText('—')
    expect(calls).toEqual([])
  })
})
