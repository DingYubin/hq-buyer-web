// 收货地址页端到端用例：全部断言基于真实接口返回（buyer-address.html 契约）
import { expect, test } from '@playwright/test'
import {
  ADDRESS_COLUMNS,
  ADDRESS_TABS,
  SYNC_STATUS_LABEL,
  apiOk,
  openPage,
  requireBackend,
  waitToastGone,
} from './support.js'

const stamp = () => String(Date.now()).slice(-7)

// pageSize 需与页面 PAGE_SIZE 对齐：首屏只渲染第一页，快照取全量会比页面多。
const listAddresses = (request, status) =>
  apiOk(request, `/api/addresses?pageNum=1&pageSize=5${status ? `&status=${status}` : ''}`)

test.describe('收货地址', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('列表：6 列按契约顺序渲染，总数与接口一致', async ({ page, request }) => {
    const data = await listAddresses(request, 'ACTIVE')
    await openPage(page, 'addresses')

    await expect(page.getByTestId('address-table').locator('thead th')).toHaveText(ADDRESS_COLUMNS)
    await expect(page.getByTestId('address-row')).toHaveCount(data.list.length)
    await expect(page.getByTestId('address-count')).toContainText(`已保存 ${data.total} 条地址`)
    await expect(page.getByTestId('address-tabs').getByRole('button')).toHaveText(ADDRESS_TABS)

    if (data.list.length > 0) {
      const first = data.list[0]
      const cells = page.getByTestId('address-row').first().locator('td')
      await expect(cells.nth(0)).toContainText(first.contact.name)
      await expect(cells.nth(1)).toHaveText(first.regionText || '—')
      await expect(cells.nth(2)).toHaveText(first.detail)
      await expect(cells.nth(3)).toHaveText(first.contact.phone)
      // 原型「固定号码」列：接口未传时回落为占位符
      await expect(cells.nth(4)).toHaveText(first.tel || '—')
      // 操作列：编辑按钮始终存在；仅非默认且 ACTIVE 的行才有「设为默认」
      await expect(cells.nth(5)).toContainText('编辑')
      await expect(page.getByTestId('address-row').first().getByTestId('address-edit')).toBeVisible()
      if (!first.isDefault && first.status === 'ACTIVE') {
        await expect(page.getByTestId('address-row').first().getByTestId('address-set-default')).toBeVisible()
      }
    }
  })

  test('新增 → 编辑 → 设为默认 → 删除：包体与契约字段逐项核对', async ({ page, request }) => {
    const label = `E2E门店${stamp()}`
    const detail = `矣六街道 ${stamp()} 号仓库`
    const updatedDetail = `小板桥街道 ${stamp()} 号仓库`

    await openPage(page, 'addresses')

    // --- 客户端校验：手机号不合法时不发请求 ---
    await page.getByTestId('address-create').click()
    await expect(page.getByTestId('address-modal')).toBeVisible()
    await page.getByTestId('address-label').fill(`${label}非法`)
    await page.getByTestId('address-contact-name').fill('端到端收货人')
    await page.getByTestId('address-contact-phone').fill('12345')
    await page.getByTestId('address-region-text').fill('云南省 昆明市 官渡区 矣六街道')
    await page.getByTestId('address-region-codes').fill('530000,530100,530111,53011110')
    await page.getByTestId('address-detail').fill(detail)
    await page.getByTestId('address-save').click()
    await expect(page.getByTestId('address-modal')).toBeVisible()
    await expect(page.getByText('请输入 11 位手机号（1 开头，第二位 3–9）')).toBeVisible()
    const untouched = await listAddresses(request)
    expect(untouched.list.some((row) => row.label === `${label}非法`), '校验失败不应写入服务端').toBe(false)

    // --- 新增成功（校验通过后把名称改回合法值）---
    await page.getByTestId('address-label').fill(label)
    await page.getByTestId('address-contact-phone').fill('13900001111')
    await page.getByTestId('address-save').click()
    await expect(page.getByTestId('toast')).toContainText('地址已保存')
    await expect(page.getByTestId('address-modal')).toHaveCount(0)

    const row = page.getByTestId('address-row').filter({ hasText: label })
    await expect(row).toHaveCount(1)

    // POST /api/addresses 只回键 + syncStatus（页面不展示同步列，接口仍按契约下发）
    const afterCreate = await listAddresses(request, 'ACTIVE')
    const created = afterCreate.list.find((item) => item.label === label)
    expect(created, '新增地址应出现在 GET /api/addresses?status=ACTIVE 列表').toBeTruthy()
    expect(created.contact).toEqual({ name: '端到端收货人', phone: '13900001111' })
    expect(created.regionCodes).toEqual(['530000', '530100', '530111', '53011110'])
    expect(created.regionText).toBe('云南省 昆明市 官渡区 矣六街道')
    expect(created.detail).toBe(detail)
    expect(created.status).toBe('ACTIVE')
    expect(Object.keys(SYNC_STATUS_LABEL)).toContain(created.syncStatus)
    expect(typeof created.version).toBe('number')
    expect(typeof created.isDefault).toBe('boolean')

    // --- 编辑（必带 version，服务端重新进入同步）---
    await row.getByTestId('address-edit').click()
    await expect(page.getByTestId('address-modal')).toBeVisible()
    await expect(page.getByTestId('address-label')).toHaveValue(label)
    await expect(page.getByTestId('address-contact-phone')).toHaveValue('13900001111')
    await expect(page.getByTestId('address-region-codes')).toHaveValue('530000,530100,530111,53011110')
    await page.getByTestId('address-detail').fill(updatedDetail)
    await page.getByTestId('address-save').click()
    await expect(page.getByTestId('toast')).toContainText('地址已更新')
    await expect(page.getByTestId('address-row').filter({ hasText: updatedDetail })).toHaveCount(1)

    const afterEdit = await listAddresses(request, 'ACTIVE')
    const edited = afterEdit.list.find((item) => item.addressId === created.addressId)
    expect(edited.detail).toBe(updatedDetail)
    expect(edited.version).toBeGreaterThan(created.version)

    // --- 设为默认：整表回读后 ACTIVE 列表只能有一个默认地址 ---
    const targetRow = page.getByTestId('address-row').filter({ hasText: updatedDetail })
    await waitToastGone(page)
    const setDefaultButton = targetRow.getByTestId('address-set-default')
    if (await setDefaultButton.count()) {
      await setDefaultButton.click()
      await expect(page.getByTestId('toast')).toContainText('已切换默认地址')
    }
    const afterDefault = await listAddresses(request, 'ACTIVE')
    const defaults = afterDefault.list.filter((item) => item.isDefault)
    expect(defaults.map((item) => item.addressId)).toContain(created.addressId)
    expect(defaults.length, 'ACTIVE 列表最多一个默认地址').toBe(1)
    await expect(targetRow).toHaveClass(/row-highlight/)

    // --- 删除：DELETE 走 query version，弹窗需确认 ---
    await waitToastGone(page)
    page.once('dialog', (dialog) => dialog.accept())
    await targetRow.getByTestId('address-delete').click()
    await expect(page.getByTestId('toast')).toContainText(/地址已删除|已停用/)
    await expect(page.getByTestId('address-row').filter({ hasText: updatedDetail })).toHaveCount(0)

    const afterDelete = await listAddresses(request, 'ACTIVE')
    expect(afterDelete.list.some((item) => item.addressId === created.addressId)).toBe(false)
  })

  test('停用 tab 与分页：状态筛选、页码文案取自接口', async ({ page, request }) => {
    const inactive = await listAddresses(request, 'INACTIVE')
    await openPage(page, 'addresses')

    await page.getByTestId('address-tab-INACTIVE').click()
    await expect(page.getByTestId('address-row')).toHaveCount(inactive.list.length)

    const all = await listAddresses(request)
    await page.getByTestId('address-tab-ALL').click()
    await expect(page.getByTestId('address-count')).toContainText(`已保存 ${all.total} 条地址`)
    if (all.total > 0) {
      await expect(page.getByTestId('address-pagination')).toContainText(`共 ${all.total} 条`)
    }
  })
})
