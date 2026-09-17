// 页面级公共组件：与冻结契约的「字段顺序 = 页面展示顺序」保持一致，
// 组件只负责展示，不在这里做任何业务计算或本地金额累加。
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Activity, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { ApiError } from '../api/client'

export function PageHead({ eyebrow, title, description, action }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

export function Status({ tone = 'gray', children }) {
  return (
    <span className={`status status-${tone}`}>
      <span />
      {children}
    </span>
  )
}

export function Button({ children, variant = 'primary', ...props }) {
  return (
    <button className={`btn btn-${variant}`} {...props}>
      {children}
    </button>
  )
}

export function Card({ children, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  )
}

export function Field({ label, required, hint, children }) {
  return (
    <label>
      {label}
      {required && <em>必填</em>}
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  )
}

export function Loading({ label = '加载中…' }) {
  return <div className="card empty">{label}</div>
}

export function Empty({ icon, title, description, action }) {
  return (
    <div className="cart-empty">
      {icon}
      <b>{title}</b>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

/** 服务端错误统一展示：code 来自 { code, message } 包体。 */
export function errorText(error) {
  if (error instanceof ApiError) return error.code ? `${error.message}（${error.code}）` : error.message
  return error?.message || '请求失败'
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="error-box" data-testid="error-box">
      <span>{errorText(error)}</span>
      {onRetry && (
        <button className="link-btn" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}

export function Modal({ title, description, onClose, footer, children, testId }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" data-testid={testId} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** 分页：契约固定 pageNum / pageSize + list / total，不提供游标。 */
export function Pager({ pageNum, pageSize, total, onChange, testId = 'pagination' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  return (
    <div className="pagination" data-testid={testId}>
      <span>
        共 {total} 条 · 第 {pageNum}/{pages} 页
      </span>
      <button disabled={pageNum <= 1} onClick={() => onChange(pageNum - 1)} aria-label="上一页">
        <ChevronLeft size={14} />
      </button>
      {Array.from({ length: pages }, (_, index) => index + 1)
        .filter((page) => Math.abs(page - pageNum) <= 2 || page === 1 || page === pages)
        .map((page, index, list) => (
          <React.Fragment key={page}>
            {index > 0 && list[index - 1] !== page - 1 && <i className="pager-gap">…</i>}
            <button className={page === pageNum ? 'current' : ''} onClick={() => onChange(page)}>
              {page}
            </button>
          </React.Fragment>
        ))}
      <button disabled={pageNum >= pages} onClick={() => onChange(pageNum + 1)} aria-label="下一页">
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toast, setToast] = useState('')
  const notify = useCallback((message) => {
    setToast(message)
    window.clearTimeout(window.__hqToastTimer)
    window.__hqToastTimer = window.setTimeout(() => setToast(''), 2600)
  }, [])
  const value = useMemo(() => notify, [notify])
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className="toast" data-testid="toast">
          <Activity size={17} />
          {toast}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
