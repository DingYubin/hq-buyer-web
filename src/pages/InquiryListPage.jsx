// 询价单列表（buyer-inquiry-list.html）：GET /api/inquiries
// 分页固定 pageNum/pageSize + list/total；筛选只提供状态与关键字（关键字为精确匹配）。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FilePlus2, Search } from 'lucide-react'
import { api } from '../api/client'
import { formatDateTime, inquiryStatusMeta } from '../lib/format'
import { Button, Card, Empty, ErrorBox, Field, Modal, PageHead, Pager, Status, useToast } from '../components/ui'

/** 不采购原因只在「未成单」的询价单上开放，成单/撤回后按钮收起。 */
const REASON_STATUS = ['PUBLISHED', 'QUOTING', 'PARTIALLY_QUOTED', 'QUOTED']

const TABS = [
  { key: 'ALL', label: '全部', status: undefined },
  { key: 'PUBLISHED', label: '待报价', status: ['PUBLISHED'] },
  { key: 'QUOTING', label: '报价中', status: ['QUOTING', 'PARTIALLY_QUOTED'] },
  { key: 'QUOTED', label: '已报价', status: ['QUOTED'] },
  { key: 'ORDERED', label: '已下单', status: ['ORDERED'] },
  { key: 'WITHDRAWN', label: '已撤回/过期', status: ['WITHDRAWN', 'EXPIRED'] },
]

const PAGE_SIZE = 10

export default function InquiryListPage({ onNavigate, keyword = '', highlight }) {
  const [tab, setTab] = useState('ALL')
  const [search, setSearch] = useState(keyword)
  const [pageNum, setPageNum] = useState(1)
  const [state, setState] = useState({ loading: true, error: null, list: [], total: 0 })
  const [reasonFor, setReasonFor] = useState(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const notify = useToast()
  /** 竞态保护：StrictMode 下 effect 双跑，丢弃过期响应，避免旧列表覆盖新查询结果。 */
  const loadSeq = useRef(0)

  const active = TABS.find((item) => item.key === tab) || TABS[0]

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const data = await api.listInquiries({
        pageNum,
        pageSize: PAGE_SIZE,
        ...(active.status ? { status: active.status } : {}),
        ...(search.trim() ? { keyword: search.trim() } : {}),
      })
      if (seq !== loadSeq.current) return
      setState({ loading: false, error: null, list: data.list || [], total: data.total || 0 })
    } catch (error) {
      if (seq !== loadSeq.current) return
      setState({ loading: false, error, list: [], total: 0 })
    }
  }, [active.status, pageNum, search])

  useEffect(() => {
    load()
  }, [load])

  const switchTab = (key) => {
    setTab(key)
    setPageNum(1)
  }
  const submitSearch = () => {
    setPageNum(1)
    load()
  }

  /** 不采购原因：PUT /api/inquiries/{id}/no-purchase-reason，写操作带 version。 */
  const submitReason = async () => {
    if (!reasonFor || !reason.trim()) {
      notify('请填写不采购原因')
      return
    }
    setSaving(true)
    try {
      await api.saveNoPurchaseReason(reasonFor.inquiryId, { version: reasonFor.version, reason: reason.trim() })
      notify('已记录不采购原因')
      setReasonFor(null)
      setReason('')
      await load()
    } catch (error) {
      notify(`保存失败：${error?.message || '请求失败'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHead
        eyebrow="采购中心 / 我的询价单"
        title="我的询价单"
        description="查看询价进度，报价回来后进入报价结果页选购配件。"
        action={
          <Button onClick={() => onNavigate('publish')} data-testid="to-publish">
            <FilePlus2 size={17} />
            发布询价
          </Button>
        }
      />
      <ErrorBox error={state.error} onRetry={load} />
      <div className="tabs-row">
        <div className="tabs" data-testid="inquiry-tabs">
          {TABS.map((item) => (
            <button
              key={item.key}
              data-testid={`inquiry-tab-${item.key}`}
              className={tab === item.key ? 'active' : ''}
              onClick={() => switchTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="table-search">
          <Search size={15} />
          <input
            data-testid="inquiry-search"
            value={search}
            placeholder="输入询价单号精确查询"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submitSearch()}
          />
          <button className="link-btn" onClick={submitSearch}>
            查询
          </button>
        </div>
      </div>
      <Card className="table-card">
        <div className="table-scroll">
          <table data-testid="inquiry-table">
            <thead>
              <tr>
                <th>询价单号</th>
                <th>状态</th>
                <th>配件数</th>
                <th>VIN</th>
                <th>车牌号</th>
                <th>报案号</th>
                <th>询价时间</th>
                <th>报价截止</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {state.list.map((row) => {
                const meta = inquiryStatusMeta(row.status)
                return (
                  <tr
                    key={row.inquiryId}
                    data-testid="inquiry-row"
                    data-inquiry-id={row.inquiryId}
                    className={highlight === row.inquiryId ? 'row-highlight' : ''}
                  >
                    <td>
                      <b>{row.inquiryNo}</b>
                      <small>{row.source}</small>
                    </td>
                    <td>
                      <Status tone={meta.tone}>{meta.label}</Status>
                    </td>
                    <td>{row.itemCount}</td>
                    <td>{row.vinMasked || '—'}</td>
                    <td>{row.plateNo || '—'}</td>
                    <td>{row.claimNo || '—'}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{formatDateTime(row.quoteDeadlineAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => onNavigate(`quotation-result?inquiryId=${row.inquiryId}`)}>
                          查看报价
                        </button>
                        {REASON_STATUS.includes(row.status) && !row.noPurchaseReason && (
                          <button
                            data-testid="inquiry-reason"
                            onClick={() => {
                              setReasonFor(row)
                              setReason('')
                            }}
                          >
                            不采购原因
                          </button>
                        )}
                        {row.noPurchaseReason && <small className="reason-note">不采购：{row.noPurchaseReason}</small>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!state.loading && state.list.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    <Empty title="没有符合条件的询价单" description="换个状态或先发布一个询价" />
                  </td>
                </tr>
              )}
              {state.loading && (
                <tr>
                  <td colSpan={9} className="empty">
                    加载中…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager pageNum={pageNum} pageSize={PAGE_SIZE} total={state.total} onChange={setPageNum} />
      </Card>
      {reasonFor && (
        <Modal
          title="不采购原因"
          description={`询价单 ${reasonFor.inquiryNo}：记录原因后停止跟进，接口 PUT /api/inquiries/{id}/no-purchase-reason`}
          testId="inquiry-reason-modal"
          onClose={() => setReasonFor(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setReasonFor(null)}>
                取消
              </Button>
              <Button onClick={submitReason} disabled={saving} data-testid="inquiry-reason-save">
                {saving ? '保存中…' : '保存原因'}
              </Button>
            </>
          }
        >
          <Field label="不采购原因" required hint="最多 500 字，写操作带 version 做乐观锁">
            <textarea
              data-testid="inquiry-reason-input"
              rows={4}
              value={reason}
              placeholder="例如：报价高于预算 / 客户取消维修"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </Modal>
      )}
    </>
  )
}
