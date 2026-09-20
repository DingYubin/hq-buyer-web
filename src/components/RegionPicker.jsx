import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { errorText } from './ui'

const LEVELS = ['PROVINCE', 'CITY', 'DISTRICT', 'STREET']
const LABELS = { PROVINCE: '省 / 自治区 / 直辖市', CITY: '市', DISTRICT: '区 / 县', STREET: '街道 / 乡镇' }
const splitCodes = (value) => value.split(',').filter(Boolean)

// 只消费 /api/regions 的字典，不内置地区、不手填编码、不触发同步。
// 缓存仅在本次弹窗内有效；过期响应不得覆盖新选中的父级。
export default function RegionPicker({ value, onChange, onReadyChange, disabled = false }) {
  const cache = useRef(new Map())
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState({ columns: [], loading: true, error: '' })
  const codes = splitCodes(value)

  useEffect(() => {
    let active = true
    const selectedCodes = splitCodes(value)
    const columns = []
    const selected = []
    onReadyChange(false)
    setView((previous) => ({ ...previous, loading: true, error: '' }))

    const children = (parentCode) => {
      const key = parentCode || ''
      if (!cache.current.has(key)) {
        const pending = api.listRegions(parentCode).catch((error) => {
          if (cache.current.get(key) === pending) cache.current.delete(key)
          throw error
        })
        cache.current.set(key, pending)
      }
      return cache.current.get(key)
    }

    async function load() {
      try {
        let parentCode
        for (let index = 0; index < 4; index += 1) {
          const data = await children(parentCode)
          if (!active) return
          const options = data?.list
          if (!Array.isArray(options)) throw new Error('地区字典返回格式异常，请联系管理员。')
          const parentLevel = selected.length ? LEVELS.indexOf(selected.at(-1).regionLevel) : -1
          const seen = new Set()
          for (const option of options) {
            if (
              !option || typeof option.regionCode !== 'string' || !/^\d{4,12}$/.test(option.regionCode) ||
              typeof option.regionName !== 'string' || !option.regionName.trim() ||
              !LEVELS.includes(option.regionLevel) || LEVELS.indexOf(option.regionLevel) <= parentLevel ||
              (option.parentCode || '') !== (parentCode || '') || typeof option.hasChildren !== 'boolean' ||
              seen.has(option.regionCode) || selectedCodes.slice(0, index).includes(option.regionCode)
            ) throw new Error('地区字典层级或编码异常，请联系管理员核查。')
            seen.add(option.regionCode)
          }
          columns.push({ parentCode, options })
          setView({ columns: [...columns], loading: true, error: '' })
          if (selectedCodes.length > 4) throw new Error('原地址地区超过四级，请重新选择。')
          if (!options.length) {
            throw new Error(parentCode ? '下级地区暂无数据，请重试或联系管理员核查。' : '地区字典暂无数据，请联系管理员恢复后重试。')
          }
          const code = selectedCodes[index]
          if (!code) break // 契约允许选至任意已验证级别（1–4 段），不强制四级。
          const node = options.find((option) => option.regionCode === code)
          if (!node) throw new Error(`原地区编码 ${code} 不在当前字典中，请重新选择。`)
          selected.push(node)
          if (!node.hasChildren || node.regionLevel === 'STREET' || index === 3) {
            if (selectedCodes.length > selected.length) throw new Error('原地址在叶子地区后仍有下级编码，请重新选择。')
            break
          }
          parentCode = node.regionCode
        }
        if (!active) return
        setView({ columns, loading: false, error: '' })
        if (selected.length) {
          onChange({
            regionCodes: selected.map((node) => node.regionCode).join(','),
            regionText: selected.map((node) => node.regionName).join(' '),
          })
          onReadyChange(true)
        }
      } catch (error) {
        if (active) setView({ columns, loading: false, error: errorText(error) })
      }
    }
    void load()
    return () => { active = false }
  }, [value, retry, onChange, onReadyChange])

  const choose = (index, code) => {
    const next = codes.slice(0, index)
    if (code) next.push(code)
    if (next.join(',') === value) return
    onReadyChange(false)
    onChange({
      regionCodes: next.join(','),
      regionText: next.map((item, depth) => view.columns[depth]?.options.find((node) => node.regionCode === item)?.regionName || '').join(' '),
    })
  }

  return (
    <fieldset disabled={disabled} aria-label="所在地区" data-testid="address-region-picker" style={{ border: 0, margin: 0, padding: 0, minWidth: 0, gridColumn: '1 / -1' }}>
      <legend style={{ marginBottom: 8 }}>所在地区 <em>必填</em></legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        {view.columns.filter((column, index) => (column.parentCode || '') === (index ? codes[index - 1] : '')).map((column, index) => {
          const level = column.options[0]?.regionLevel || LEVELS[index]
          const label = column.options.every((node) => node.regionLevel === level) ? LABELS[level] : '下级地区'
          const missing = codes[index] && !column.options.some((node) => node.regionCode === codes[index])
          return (
            <label key={column.parentCode || 'root'}>
              {label}
              <select aria-label={label} data-testid={`address-region-${index}`} value={codes[index] || ''} onChange={(event) => choose(index, event.target.value)}>
                <option value="">{index ? '可继续选择' : '请选择省级地区'}</option>
                {missing && <option value={codes[index]} disabled>原编码 {codes[index]}（请重选）</option>}
                {column.options.map((node) => <option key={node.regionCode} value={node.regionCode}>{node.regionName}</option>)}
              </select>
            </label>
          )
        })}
      </div>
      <div aria-live="polite" data-testid="address-region-status">
        {view.loading ? <small className="field-hint">地区加载中…</small> : null}
        {view.error ? (
          <div role="alert" className="field-error">
            {view.error}{' '}
            <button type="button" className="link-btn" data-testid="address-region-retry" onClick={() => {
              cache.current.clear()
              setRetry((count) => count + 1)
            }}>重新加载地区</button>
          </div>
        ) : null}
      </div>
      <small className="field-hint">请按实际地址选择；名称和编码自动回填，下级地区可选。</small>
    </fieldset>
  )
}
