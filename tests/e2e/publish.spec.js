// 发布询价页端到端用例（buyer-publish.html 契约）
// 写入链路：POST /api/inquiry-drafts → PUT /api/inquiry-drafts/{id}/items → POST /api/inquiries
import { expect, test } from '@playwright/test'
import { apiOk, openPage, randomVin, requireBackend, waitToastGone } from './support.js'

test.describe('发布询价', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('单页发布：草稿落库 → 发布后跳询价单列表并高亮', async ({ page, request }) => {
    const vin = randomVin()
    await openPage(page, 'publish')
    await expect(page.getByTestId('draft-state')).toContainText('草稿未创建')

    // VIN 识别（识别不到也能继续，识别结果只做车型预填）
    await page.getByTestId('vin-input').fill(vin)
    await page.getByTestId('recognize-vin').click()
    await expect(page.getByTestId('vehicle-preview')).toBeVisible()
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
    await page.getByTestId('publish-contact-name').fill('况承泽')
    await page.getByTestId('publish-contact-phone').fill('13058093388')
    await page.getByTestId('step-publish').click()

    // 发布后跳转 + 列表行高亮（highlight 取自响应 inquiryId）
    await expect(page).toHaveURL(/#\/inquiries\?highlight=/, { timeout: 20_000 })
    const inquiryId = decodeURIComponent(new URL(page.url()).hash.split('highlight=')[1])
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
    await expect(row.locator('td').nth(2)).toHaveText('1')
  })

  test('配件清单可增行：两行配件都会写入草稿并出现在发布摘要', async ({ page, request }) => {
    const vin = randomVin()
    await openPage(page, 'publish')
    await page.getByTestId('vin-input').fill(vin)
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
