// 发布询价页端到端用例（buyer-publish.html 契约）
// 写入链路：POST /api/inquiry-drafts → PUT /api/inquiry-drafts/{id}/items → POST /api/inquiries
import { expect, test } from '@playwright/test'
import { apiOk, openPage, randomVin, requireBackend, seedVinRecord, waitToastGone } from './support.js'

test.describe('发布询价', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('单页发布：草稿落库 → 发布后跳询价单列表并高亮', async ({ page, request }) => {
    // VIN 档案先落库：识别走本地命中，不依赖外部译码链路的可用性。
    const vin = await seedVinRecord(request, randomVin())
    // 发布入参按 Q3/Q4 契约核对：isOpenInvoice 必传，SYSTEM 下 storeIds 固定空数组
    const publishBodies = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/inquiries$/.test(new URL(r.url()).pathname)) {
        publishBodies.push(JSON.parse(r.postData() || '{}'))
      }
    })
    await openPage(page, 'publish')
    await expect(page.getByTestId('draft-state')).toContainText('草稿未创建')

    // VIN 识别：RECOGNIZED 后写入车型快照，发布门禁（42248）才放行
    await page.getByTestId('vin-input').fill(vin)
    await page.getByTestId('recognize-vin').click()
    await expect(page.getByTestId('vehicle-preview')).toContainText('宝马')
    await page.getByTestId('step-next').click()

    // 保存草稿：草稿已落库，version=1
    await expect(page.getByTestId('publish-items')).toBeVisible()
    await expect(page.getByTestId('draft-state')).toContainText('· v1')
    await expect(page.getByTestId('item-name-0')).toHaveValue('前保险杠')
    await expect(page.getByTestId('item-oe-0')).toHaveValue('51117379491')
    await expect(page.getByTestId('item-qty-0')).toHaveValue('1')
    await expect(page.getByTestId('item-quality-0')).not.toHaveValue('')
    await page.getByTestId('step-next').click()

    // 摘要 + 发布选项（单页表单常驻，内容随输入实时更新）
    await expect(page.getByTestId('publish-summary')).toContainText(vin)
    await expect(page.getByTestId('publish-summary')).toContainText('前保险杠×1')
    await expect(page.getByTestId('option-anonymous')).toBeChecked()
    await expect(page.getByTestId('option-invoice-open')).toBeChecked()
    await page.getByTestId('publish-contact-name').fill('况承泽')
    await page.getByTestId('publish-contact-phone').fill('13058093388')
    await page.getByTestId('step-publish').click()

    // 发布后跳转 + 列表行高亮（highlight 取自响应 inquiryId）
    await expect(page).toHaveURL(/#\/inquiries\?highlight=/, { timeout: 20_000 })
    const inquiryId = decodeURIComponent(new URL(page.url()).hash.split('highlight=')[1])
    expect(publishBodies).toHaveLength(1)
    expect(publishBodies[0].publishOptions.isOpenInvoice).toBe(true)
    expect(publishBodies[0].publishOptions.storeIds).toEqual([])
    // 页面默认带上当前收货地址：只传 addressId，地区明细由服务端展开
    const activeAddresses = await apiOk(request, '/api/addresses?pageNum=1&pageSize=50&status=ACTIVE')
    const firstAddress = activeAddresses.list[0]
    if (firstAddress) expect(publishBodies[0].addressId).toBe(firstAddress.addressId)
    const inquiry = await apiOk(request, `/api/inquiries/${inquiryId}`)
    expect(inquiry.source).toBe('PC')
    expect(inquiry.status).toBe('PUBLISHED')
    expect(inquiry.itemCount).toBe(1)
    // 详情接口只回脱敏 VIN：保留前 3 位 + 后 3 位
    expect(inquiry.vinMasked).toBe(`${vin.slice(0, 3)}${'*'.repeat(vin.length - 6)}${vin.slice(-3)}`)

    const row = page.getByTestId('inquiry-row').filter({ hasText: inquiry.inquiryNo })
    await expect(row).toHaveCount(1)
    await expect(row).toHaveClass(/row-highlight/)
    await expect(row.locator('td').nth(0)).toContainText(inquiry.inquiryNo)
    // 列序：单号 / 车辆信息 / 车牌号 / 报案号 / 配件信息 / 发布时间 / 状态 / 操作
    await expect(row.locator('td').nth(2)).toHaveText('—')
    await expect(row.locator('td').nth(4)).toHaveText('1 项配件')
  })

  test('配件清单可增行：两行配件都会写入草稿并出现在发布摘要', async ({ page, request }) => {
    const vin = await seedVinRecord(request, randomVin())
    await openPage(page, 'publish')
    await page.getByTestId('vin-input').fill(vin)
    await page.getByTestId('recognize-vin').click()
    await expect(page.getByTestId('vehicle-preview')).toContainText('宝马')
    await page.getByTestId('step-next').click()
    await expect(page.getByTestId('publish-item-row')).toHaveCount(1)

    await page.getByTestId('add-item').click()
    await expect(page.getByTestId('publish-item-row')).toHaveCount(2)
    await page.getByTestId('item-name-1').fill('前大灯')
    await page.getByTestId('item-oe-1').fill('81130123456')
    await page.getByTestId('item-qty-1').fill('2')
    await page.getByTestId('step-next').click()

    await expect(page.getByTestId('publish-summary')).toContainText('前保险杠×1')
    await expect(page.getByTestId('publish-summary')).toContainText('前大灯×2')
    await page.getByTestId('publish-contact-name').fill('况承泽')
    await page.getByTestId('publish-contact-phone').fill('13058093388')
    await page.getByTestId('step-publish').click()

    await expect(page).toHaveURL(/#\/inquiries\?highlight=/, { timeout: 20_000 })
    const inquiryId = decodeURIComponent(new URL(page.url()).hash.split('highlight=')[1])
    const detail = await apiOk(request, `/api/inquiries/${inquiryId}`)
    expect(detail.itemCount).toBe(2)
    const items = await apiOk(request, `/api/inquiries/${inquiryId}/items`)
    expect(items.items.map((row) => row.name).sort()).toEqual(['前保险杠', '前大灯'])
    expect(items.items.find((row) => row.name === '前大灯').quantity).toBe(2)
  })

  test('其他要求：开票单选默认「需要发票」，切到「不需要发票」后按所选值提交', async ({ page, request }) => {
    const publishBodies = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/inquiries$/.test(new URL(r.url()).pathname)) {
        publishBodies.push(JSON.parse(r.postData() || '{}'))
      }
    })

    await openPage(page, 'publish')
    await page.getByTestId('vin-input').fill(await seedVinRecord(request, randomVin()))
    await page.getByTestId('recognize-vin').click()
    await expect(page.getByTestId('vehicle-preview')).toContainText('宝马')
    await expect(page.getByTestId('option-invoice-open')).toBeChecked()
    await expect(page.getByTestId('option-invoice-none')).not.toBeChecked()

    await page.getByTestId('option-invoice-none').check()
    await expect(page.getByTestId('option-invoice-none')).toBeChecked()
    await page.getByTestId('publish-contact-name').fill('况承泽')
    await page.getByTestId('publish-contact-phone').fill('13058093388')
    await page.getByTestId('step-publish').click()

    await expect(page).toHaveURL(/#\/inquiries\?highlight=/, { timeout: 20_000 })
    expect(publishBodies).toHaveLength(1)
    expect(publishBodies[0].publishOptions.isOpenInvoice).toBe(false)
  })

  test('客户端校验：VIN 不合法不发写请求，空配件不推进草稿', async ({ page }) => {
    // 单页表单：拦住的是「写请求本身」，比拦步骤渲染更严格。
    const draftPosts = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/inquiry-drafts')) draftPosts.push(request.url())
    })

    await openPage(page, 'publish')
    await page.getByTestId('vin-input').fill('ABC123')
    await page.getByTestId('step-next').click()
    await expect(page.getByTestId('toast')).toContainText('VIN 需为 17 位大写字母数字，且不含 I/O/Q')
    expect(draftPosts).toEqual([])
    await expect(page.getByTestId('draft-state')).toContainText('草稿未创建')

    await waitToastGone(page)
    await page.getByTestId('vin-input').fill(randomVin())
    await page.getByTestId('step-next').click()
    await expect(page.getByTestId('draft-state')).toContainText('· v1')

    // 清空配件名称 → 保存被拦截，草稿版本保持不变（不空推 version）
    await waitToastGone(page)
    await page.getByTestId('item-name-0').fill('')
    await page.getByTestId('step-next').click()
    await expect(page.getByTestId('toast')).toContainText('请至少填写一个配件')
    await expect(page.getByTestId('draft-state')).toContainText('· v1')
  })
})
