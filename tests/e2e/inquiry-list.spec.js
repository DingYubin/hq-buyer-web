// 询价单列表端到端用例（buyer-inquiry-list.html 契约）
// 读取：GET /api/inquiries?pageNum&pageSize&status[]&keyword（keyword 为询价单号/ID 精确匹配）
import { expect, test } from '@playwright/test'
import { INQUIRY_COLUMNS, INQUIRY_STATUS_LABEL, apiOk, openPage, requireBackend, seedQuotedInquiry } from './support.js'

const PAGE_SIZE = 10

/** 与前端同一契约：pageNum/pageSize + status[] 数组参数。 */
async function listInquiries(request, { pageNum = 1, status = [], keyword } = {}) {
  const search = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(PAGE_SIZE) })
  status.forEach((item) => search.append('status[]', item))
  if (keyword) search.append('keyword', keyword)
  return apiOk(request, `/api/inquiries?${search.toString()}`)
}

/** 页签 → 契约状态数组（QUOTING / WITHDRAWN 页签是合并状态）。 */
const TAB_STATUS = {
  ALL: [],
  PUBLISHED: ['PUBLISHED'],
  QUOTING: ['QUOTING', 'PARTIALLY_QUOTED'],
  QUOTED: ['QUOTED'],
  ORDERED: ['ORDERED'],
  WITHDRAWN: ['WITHDRAWN', 'EXPIRED'],
}

// 掩码口径与后端 DirectInquiryService 落库时一致：前 3 + 10 个 * + 后 4
const maskedVin = (vin) => `${vin.slice(0, 3)}${'*'.repeat(10)}${vin.slice(-4)}`

test.describe('询价单列表', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('列表：8 列表头、6 个页签筛选参数与行数、分页文案都取自接口', async ({ page, request }) => {
    await openPage(page, 'inquiries')

    await expect(page.getByTestId('inquiry-table').locator('thead th')).toHaveText(INQUIRY_COLUMNS)
    await expect(page.getByTestId('inquiry-tabs').getByRole('button')).toHaveText([
      '全部',
      '待报价',
      '报价中',
      '已报价',
      '已下单',
      '已撤回/过期',
    ])

    // 「全部」页签不带 status[]，行数 = min(total, pageSize)
    const all = await listInquiries(request, {})
    await expect(page.getByTestId('inquiry-row')).toHaveCount(Math.min(all.total, PAGE_SIZE))
    await expect(page.getByTestId('pagination')).toContainText(
      `共 ${all.total} 条 · 第 1/${Math.max(1, Math.ceil(all.total / PAGE_SIZE))} 页`,
    )

    // 其余 5 个页签：逐个核对请求参数 + 行数（请求参数即契约的 status[] 数组写法）
    for (const key of ['PUBLISHED', 'QUOTING', 'QUOTED', 'ORDERED', 'WITHDRAWN']) {
      const [req] = await Promise.all([
        page.waitForRequest((r) => {
          if (!r.url().includes('/api/inquiries?')) return false
          const params = new URL(r.url()).searchParams
          return params.getAll('status[]').join(',') === TAB_STATUS[key].join(',')
        }),
        page.getByTestId(`inquiry-tab-${key}`).click(),
      ])
      const params = new URL(req.url()).searchParams
      expect(params.getAll('status[]'), `${key} 页签 status[] 参数`).toEqual(TAB_STATUS[key])
      expect(params.get('pageNum')).toBe('1')
      expect(params.get('pageSize')).toBe(String(PAGE_SIZE))

      const data = await listInquiries(request, { status: TAB_STATUS[key] })
      await expect(page.getByTestId('inquiry-row')).toHaveCount(Math.min(data.total, PAGE_SIZE))
    }

    // 切回「全部」：不再携带 status[]
    const [backReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/inquiries?') && !r.url().includes('status%5B%5D')),
      page.getByTestId('inquiry-tab-ALL').click(),
    ])
    expect(new URL(backReq.url()).searchParams.getAll('status[]')).toEqual([])
  })

  test('查询：按询价单号精确匹配，行内「查看报价」进入报价结果页', async ({ page, request }) => {
    const quote = await seedQuotedInquiry(request)
    await openPage(page, 'inquiries')

    await page.getByTestId('inquiry-search').fill(quote.inquiryNo)
    const [req] = await Promise.all([
      page.waitForRequest((r) => new URL(r.url()).searchParams.get('keyword') === quote.inquiryNo),
      page.getByTestId('inquiry-search').press('Enter'),
    ])
    expect(new URL(req.url()).searchParams.get('pageNum')).toBe('1')

    const rows = page.getByTestId('inquiry-row')
    await expect(rows).toHaveCount(1)
    const row = rows.first()
    await expect(row).toHaveAttribute('data-inquiry-id', quote.inquiryId)
    await expect(row.locator('td').nth(0)).toContainText(quote.inquiryNo)
    await expect(row.locator('td').nth(1)).toContainText(maskedVin(quote.vin))
    await expect(row.locator('td').nth(2)).toHaveText('—')
    await expect(row.locator('td').nth(3)).toHaveText('—')
    // 列表契约里配件信息列只有 itemCount（明细名要另拉 items，属待确认缺口），页面按契约渲染件数。
    await expect(row.locator('td').nth(4)).toHaveText(`${quote.itemCount} 项配件`)
    await expect(row.locator('td').nth(5)).toHaveText(/\d{4}-\d{2}-\d{2}/)
    await expect(row.locator('td').nth(6)).toContainText(INQUIRY_STATUS_LABEL.QUOTED)

    // 行内按钮 → 报价结果页（hash 路由带 inquiryId）
    await row.getByRole('button', { name: '查看报价' }).click()
    await expect(page).toHaveURL(new RegExp(`#/quotation-result\\?inquiryId=${quote.inquiryId}$`))
  })

  test('空结果：无匹配询价单号时展示空态，发布询价入口可跳转', async ({ page }) => {
    await openPage(page, 'inquiries')
    await page.getByTestId('inquiry-search').fill(`HQI_NOT_EXIST_${Date.now()}`)
    await page.getByTestId('inquiry-search').press('Enter')

    await expect(page.getByTestId('inquiry-row')).toHaveCount(0)
    await expect(page.getByText('没有符合条件的询价单')).toBeVisible()
    await expect(page.getByTestId('pagination')).toHaveCount(0)

    await page.getByTestId('to-publish').click()
    await expect(page).toHaveURL(/#\/publish$/)
  })
})
