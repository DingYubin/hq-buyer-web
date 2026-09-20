// 收货地址管理（buyer-address.html）
// 读取：GET /api/addresses?status=&pageNum=&pageSize=  → { list, total }
// 写入：POST 新增（只回键 + syncStatus，必须整表回读）/ PATCH 编辑（必带 version）
//      POST {id}/default 设为默认 / DELETE ?version= 删除或降级停用 / POST {id}/sync 重试同步
// 关键口径：列表行自带 version 与 syncStatus；冲突 40911 一律先刷新再让用户重试。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MapPin, Plus, Store, TriangleAlert } from 'lucide-react'
import { api } from '../api/client'
import RegionPicker from '../components/RegionPicker'
import { Button, Card, Empty, ErrorBox, Field, Modal, PageHead, Pager, Status, errorText, useToast } from '../components/ui'

const PAGE_SIZE = 5
const PHONE_RE = /^1[3-9]\d{9}$/
const CODE_RE = /^\d{4,12}$/

const TABS = [
  { key: 'ACTIVE', label: '正常' },
  { key: 'INACTIVE', label: '已停用' },
  { key: 'ALL', label: '全部' },
]

const EMPTY_FORM = {
  label: '',
  name: '',
  phone: '',
  tel: '',
  regionText: '',
  regionCodes: '',
  detail: '',
  isDefault: false,
}

/** 表单 → 请求体；regionCodes 按契约以数组提交（1–4 个 4–12 位数字编码）。 */
function parseCodes(input) {
  return input
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function validate(form) {
  const errors = {}
  const label = form.label.trim()
  const name = form.name.trim()
  const phone = form.phone.trim()
  const regionText = form.regionText.trim()
  const detail = form.detail.trim()
  const codes = parseCodes(form.regionCodes)
  if (!label) errors.label = '请填写门店 / 公司名称'
  else if (label.length > 100) errors.label = '门店 / 公司名称不超过 100 字'
  if (!name) errors.name = '请填写收货人姓名'
  else if (name.length > 100) errors.name = '收货人姓名不超过 100 字'
  if (!PHONE_RE.test(phone)) errors.phone = '请输入 11 位手机号（1 开头，第二位 3–9）'
  if (!codes.length) errors.regionCodes = '请选择所在地区'
  else if (codes.length > 4) errors.regionCodes = '地区编码最多 4 级（省 / 市 / 区 / 街道）'
  else if (codes.some((code) => !CODE_RE.test(code))) errors.regionCodes = '地区编码需为 4–12 位数字'
  if (!regionText) errors.regionText = '请从地区字典选择所在地区'
  if (!detail) errors.detail = '请填写详细地址'
  else if (detail.length > 200) errors.detail = '详细地址不超过 200 字'
  const tel = (form.tel || '').trim()
  // 固定号码选填（原型「固定号码」列）；座机含区号，长度走契约 ≤20。
  if (tel && tel.length > 20) errors.tel = '固定号码不超过 20 位'
  return {
    errors,
    codes,
    payload: { label, contact: { name, phone }, ...(tel ? { tel } : {}), regionCodes: codes, regionText, detail },
  }
}

export default function AddressPage({ onNavigate }) {
  const notify = useToast()
  /** 竞态保护：丢弃过期响应，避免切 Tab / 翻页时旧列表覆盖新结果。 */
  const loadSeq = useRef(0)
  const [tab, setTab] = useState('ACTIVE')
  const [pageNum, setPageNum] = useState(1)
  const [state, setState] = useState({ loading: true, error: null, list: [], total: 0 })
  const [editing, setEditing] = useState(null) // null=关闭；{ addressId?, version?, form }
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [regionReady, setRegionReady] = useState(false)

  const changeRegions = useCallback((next) => {
    setForm((previous) => ({ ...previous, ...next }))
    setFormErrors((previous) => ({ ...previous, regionCodes: undefined, regionText: undefined }))
  }, [])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const data = await api.listAddresses({
        pageNum,
        pageSize: PAGE_SIZE,
        ...(tab === 'ALL' ? {} : { status: tab }),
      })
      if (seq !== loadSeq.current) return
      setState({ loading: false, error: null, list: data.list || [], total: data.total || 0 })
    } catch (error) {
      if (seq !== loadSeq.current) return
      setState({ loading: false, error, list: [], total: 0 })
    }
  }, [pageNum, tab])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setRegionReady(false)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setEditing({ form: EMPTY_FORM })
  }

  const openEdit = (row) => {
    setRegionReady(false)
    const next = {
      label: row.label || '',
      name: row.contact?.name || '',
      phone: row.contact?.phone || '',
      tel: row.tel || '',
      regionText: row.regionText || '',
      regionCodes: (row.regionCodes || []).join(','),
      detail: row.detail || '',
      isDefault: Boolean(row.isDefault),
    }
    setForm(next)
    setFormErrors({})
    setEditing({ addressId: row.addressId, version: row.version, wasDefault: row.isDefault, form: next })
  }

  const closeModal = () => {
    setEditing(null)
    setFormErrors({})
  }

  const save = async () => {
    if (!regionReady || busy) return
    const { errors, payload } = validate(form)
    setFormErrors(errors)
    if (Object.keys(errors).length) return
    setBusy(true)
    try {
      if (!editing.addressId) {
        await api.createAddress({ ...payload, isDefault: Boolean(form.isDefault) })
        notify('地址已保存')
      } else {
        const body = { ...payload, version: editing.version }
        // 取消默认只能由其它地址设为默认，传 false 服务端不生效，这里只在勾选时提交。
        if (form.isDefault && !editing.wasDefault) body.isDefault = true
        await api.updateAddress(editing.addressId, body)
        notify('地址已更新')
      }
      closeModal()
      await load() // 新增只回键、编辑不回列表全量 → 统一整表回读
    } catch (error) {
      notify(errorText(error))
      if (error?.code === 40911) await load()
    } finally {
      setBusy(false)
    }
  }

  const setDefault = async (row) => {
    setBusy(true)
    try {
      await api.setDefaultAddress(row.addressId, { version: row.version })
      notify('已切换默认地址')
      await load() // 只改一行会留下两个默认地址，必须整表刷新
    } catch (error) {
      notify(errorText(error))
      if (error?.code === 40911) await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row) => {
    const confirmed = window.confirm(
      `确认删除「${row.label}」？若该地址已被在途询价 / 订单引用，服务端会降级为停用并保留历史快照。`,
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const result = await api.deleteAddress(row.addressId, row.version)
      notify(result.status === 'DELETED' ? '地址已删除' : '该地址已在单据中使用，已停用')
      await load()
    } catch (error) {
      notify(errorText(error))
      if (error?.code === 40911) await load()
    } finally {
      setBusy(false)
    }
  }

  const change = (key) => (event) =>
    setForm((prev) => ({
      ...prev,
      [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }))

  return (
    <>
      <PageHead
        eyebrow="首页 / 收货地址"
        title="收货地址"
        description="管理询价和订单使用的收货信息，默认地址会优先用于发布询价和确认订单。"
        action={
          <Button onClick={openCreate} data-testid="address-create">
            <Plus size={17} />
            新增收货地址
          </Button>
        }
      />
      <ErrorBox error={state.error} onRetry={load} />
      <div className="address-layout">
        <div>
          <Card className="table-card address-table-card">
            <div className="card-head address-card-head" data-testid="address-count">
              <span>已保存 <b>{state.total}</b> 条地址</span>
              <div className="tabs address-status-tabs" data-testid="address-tabs">
                {TABS.map((item) => (
                  <button
                    key={item.key}
                    data-testid={`address-tab-${item.key}`}
                    className={tab === item.key ? 'active' : ''}
                    onClick={() => {
                      setTab(item.key)
                      setPageNum(1)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button className="link-btn" onClick={() => onNavigate('publish')} data-testid="address-back-publish">
                返回发布询价
              </button>
            </div>
            <div className="table-scroll">
              <table data-testid="address-table">
                <thead>
                  <tr>
                    <th>收货人</th>
                    <th>所在地区</th>
                    <th>详细地址</th>
                    <th>手机号</th>
                    <th>固定号码</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.list.map((row) => {
                    return (
                      <tr
                        key={row.addressId}
                        data-testid="address-row"
                        data-address-id={row.addressId}
                        className={row.isDefault ? 'row-highlight' : ''}
                      >
                        <td>
                          <b>{row.label}</b>
                          <small>
                            {row.contact?.name}
                          </small>
                          {row.isDefault && <em className="badge">默认地址</em>}
                        </td>
                        <td>{row.regionText || '—'}</td>
                        <td>{row.detail}</td>
                        <td>{row.contact?.phone}</td>
                        <td>{row.tel || '—'}</td>
                        <td>
                          <div className="row-actions">
                            {!row.isDefault && row.status === 'ACTIVE' && (
                              <button
                                disabled={busy}
                                data-testid="address-set-default"
                                onClick={() => setDefault(row)}
                              >
                                设为默认
                              </button>
                            )}
                            <button data-testid="address-edit" onClick={() => openEdit(row)}>
                              编辑
                            </button>
                            {row.status === 'ACTIVE' && (
                              <button data-testid="address-delete" disabled={busy} onClick={() => remove(row)}>
                                删除
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {!state.loading && state.list.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        <Empty
                          icon={<MapPin size={30} />}
                          title="暂无收货地址"
                          description="新增地址后，发布询价与确认订单会默认选中默认地址"
                          action={
                            <Button onClick={openCreate} data-testid="address-empty-create">
                              新增收货地址
                            </Button>
                          }
                        />
                      </td>
                    </tr>
                  )}
                  {state.loading && (
                    <tr>
                      <td colSpan={6} className="empty">
                        加载中…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager
              pageNum={pageNum}
              pageSize={PAGE_SIZE}
              total={state.total}
              onChange={setPageNum}
              testId="address-pagination"
            />
          </Card>
        </div>
        <aside className="address-note">
          <div className="tip-icon">
            <TriangleAlert size={16} />
          </div>
          <b>地址信息不准可能影响报价</b>
          <p>地区与详细地址会用于发布询价和确认订单，请确认收货信息准确。</p>
          <small>省、市、区、街道从地区字典选择；字典不可用时请重试或联系管理员，不手填编码。</small>
        </aside>
      </div>

      {editing && (
        <Modal
          testId="address-modal"
          title={editing.addressId ? '编辑收货地址' : '新增收货地址'}
          description="请选择地区并填写收货信息；保存成功后可用于发布询价和确认订单。"
          onClose={closeModal}
          footer={
            <>
              <Button variant="ghost" onClick={closeModal} data-testid="address-cancel">
                取消
              </Button>
              <Button onClick={save} disabled={busy || !regionReady} data-testid="address-save">
                {busy ? '保存中…' : '保存地址'}
              </Button>
            </>
          }
        >
          <Field label="门店 / 公司名称" required>
            <input data-testid="address-label" value={form.label} maxLength={100} onChange={change('label')} />
            {formErrors.label && <small className="field-error">{formErrors.label}</small>}
          </Field>
          <Field label="收货人" required>
            <input
              data-testid="address-contact-name"
              value={form.name}
              maxLength={100}
              onChange={change('name')}
            />
            {formErrors.name && <small className="field-error">{formErrors.name}</small>}
          </Field>
          <Field label="手机号" required>
            <input
              data-testid="address-contact-phone"
              value={form.phone}
              maxLength={11}
              inputMode="numeric"
              onChange={change('phone')}
            />
            {formErrors.phone && <small className="field-error">{formErrors.phone}</small>}
          </Field>
          <Field label="固定号码（选填）" hint="座机 / 前台固定电话，最多 20 位">
            <input
              data-testid="address-tel"
              value={form.tel || ''}
              placeholder="0871-63500000"
              maxLength={20}
              onChange={change('tel')}
            />
            {formErrors.tel && <small className="field-error">{formErrors.tel}</small>}
          </Field>
          <RegionPicker
            value={form.regionCodes}
            onChange={changeRegions}
            onReadyChange={setRegionReady}
            disabled={busy}
          />
          <Field label="已选地区（名称）" required hint="随上方地区选择自动生成">
            <input data-testid="address-region-text" value={form.regionText} readOnly />
            {formErrors.regionText && <small className="field-error">{formErrors.regionText}</small>}
          </Field>
          <Field label="地区编码" required hint="与地区名称同序，提交时转换为字符串数组">
            <input data-testid="address-region-codes" value={form.regionCodes} readOnly />
            {formErrors.regionCodes && <small className="field-error">{formErrors.regionCodes}</small>}
          </Field>
          <Field label="详细地址" required>
            <textarea
              data-testid="address-detail"
              rows={3}
              value={form.detail}
              maxLength={200}
              onChange={change('detail')}
            />
            {formErrors.detail && <small className="field-error">{formErrors.detail}</small>}
          </Field>
          <label className="select-label">
            <input
              type="checkbox"
              data-testid="address-default-checkbox"
              checked={form.isDefault}
              onChange={change('isDefault')}
            />{' '}
            设为默认收货地址
            {editing.addressId && editing.wasDefault && <small>（取消默认请在列表把其它地址设为默认）</small>}
          </label>
          <small className="tip-line">
            <span>
              <Store size={12} /> 首条地址由服务端强制置为默认；同用户仅允许一个默认地址。
            </span>
          </small>
        </Modal>
      )}
    </>
  )
}
