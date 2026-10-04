import { useMemo, useState } from 'react'
import type { NumberSegment, SegmentStatus } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { segmentStore } from '@/stores/segmentStore'
import { siteStore } from '@/stores/siteStore'
import { specimenStore } from '@/stores/specimenStore'
import { buildSpecimenCode } from '@/utils/codec'
import { occupiesRange, segmentRangeText, segmentRemaining, segmentSize, suggestSegmentStart } from '@/utils/segment'

const STATUS_STYLES: Record<SegmentStatus, string> = {
  在用: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  已核销: 'bg-sky-50 text-sky-700 border-sky-300',
  已作废: 'bg-rose-50 text-rose-600 border-rose-300',
  历史: 'bg-slate-100 text-slate-600 border-slate-300'
}

/** 号段台账：标本馆按采集地+年份发放流水号段，野外队逐趟报回用量，对账后核销 */
export default function SegmentsPage(): JSX.Element {
  const segments = usePersistentStore(segmentStore, (state) => state.rows)
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)

  const [siteCode, setSiteCode] = useState('')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [start, setStart] = useState('')
  const [count, setCount] = useState('100')
  const [team, setTeam] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const existingCodes = useMemo(() => specimens.map((item) => item.code), [specimens])

  /** 起始号建议值：现存段上限与已有编号的最大流水号 + 1；用户可手动改小改大，重叠会被拒绝 */
  const suggested = useMemo(
    () => (siteCode && /^\d{4}$/.test(year) ? suggestSegmentStart(siteCode, year, segments, existingCodes) : 1),
    [siteCode, year, segments, existingCodes]
  )
  const startValue = start.trim() === '' ? suggested : Number(start)
  const countValue = Number(count) || 0
  const endValue = startValue + countValue - 1
  const previewReady = siteCode !== '' && /^\d{4}$/.test(year) && Number.isInteger(startValue) && countValue >= 1

  const issue = async (): Promise<void> => {
    if (!siteCode) {
      setError('请选择采集地')
      return
    }
    if (countValue < 1) {
      setError('号段数量至少 1 个')
      return
    }
    const result = await segmentStore.getState().issue({
      siteCode,
      year,
      start: startValue,
      end: endValue,
      team,
      note
    })
    if (!result.ok) {
      setError(result.error ?? '发放失败')
      setMessage('')
      return
    }
    setError('')
    setMessage(`已把 ${buildSpecimenCode(siteCode, year, startValue)} ~ ${buildSpecimenCode(siteCode, year, endValue)} 发给「${team.trim()}」`)
    setStart('')
    setTeam('')
    setNote('')
  }

  const close = async (segment: NumberSegment): Promise<void> => {
    await segmentStore.getState().close(segment.id)
    setMessage(`号段 ${segmentRangeText(segment)} 已对账核销`)
  }

  const voidSegment = async (segment: NumberSegment): Promise<void> => {
    const result = await segmentStore.getState().voidSegment(segment.id)
    if (!result.ok) {
      setError(result.error ?? '作废失败')
      return
    }
    setError('')
    setMessage(`号段 ${segmentRangeText(segment)} 已作废收回，号可重新发放`)
  }

  const activeCount = segments.filter((item) => item.status === '在用').length
  const issuedTotal = segments.filter(occupiesRange).reduce((sum, item) => sum + segmentSize(item), 0)
  const usedTotal = segments.reduce((sum, item) => sum + item.usedSerials.length, 0)

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">号段台账</h1>
        <p className="page-sub">
          标本馆按「采集地+年份」把一段流水号发给野外队，队里这趟从段里往下取号；报回超出段上限或搭上别队的段会被整批退回，台账不跟着动。
        </p>
      </header>

      <section className="panel flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-700">发放号段</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <span className="field-label">采集地（编号前缀）</span>
            <select className="field-input" value={siteCode} onChange={(e) => setSiteCode(e.target.value)}>
              <option value="">请选择采集地</option>
              {sites.map((site) => (
                <option key={site.id} value={site.code}>
                  {site.code} {site.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="field-label">编号年份</span>
            <input className="field-input" value={year} onChange={(e) => setYear(e.target.value)} placeholder="如 2026" />
          </div>
          <div>
            <span className="field-label">领用队伍</span>
            <input className="field-input" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="如 黔南三队 · 陆昀" />
          </div>
          <div>
            <span className="field-label">起始流水号（留空取建议值 {suggested}）</span>
            <input
              className="field-input"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder={String(suggested)}
              inputMode="numeric"
            />
          </div>
          <div>
            <span className="field-label">发放数量（个号）</span>
            <input className="field-input" value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <span className="field-label">备注</span>
            <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 秋季集中调查" />
          </div>
        </div>

        {previewReady ? (
          <p className="rounded-lg bg-field-50 px-3 py-2 text-sm text-field-700">
            将发放：<span className="font-mono">{buildSpecimenCode(siteCode, year, startValue)}</span> ~{' '}
            <span className="font-mono">{buildSpecimenCode(siteCode, year, endValue)}</span>（共 {countValue} 个号）
          </p>
        ) : null}

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {message ? <p className="text-sm text-field-700">{message}</p> : null}

        <div>
          <button className="btn-primary" type="button" onClick={() => void issue()}>
            发放号段
          </button>
        </div>
      </section>

      <section className="panel flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">台账（{segments.length} 段）</h2>
          <p className="text-xs text-slate-500">
            在用 {activeCount} 段 · 累计发放 {issuedTotal} 个号 · 已报回 {usedTotal} 个
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="border border-slate-200 px-2 py-1">号段</th>
                <th className="border border-slate-200 px-2 py-1">领用队伍</th>
                <th className="border border-slate-200 px-2 py-1">发放日期</th>
                <th className="border border-slate-200 px-2 py-1">用量</th>
                <th className="border border-slate-200 px-2 py-1">状态</th>
                <th className="border border-slate-200 px-2 py-1">备注</th>
                <th className="border border-slate-200 px-2 py-1">操作</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => {
                const used = segment.usedSerials.length
                const size = segmentSize(segment)
                return (
                  <tr key={segment.id}>
                    <td className="border border-slate-200 px-2 py-1 font-mono text-xs text-field-700">
                      {segmentRangeText(segment)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">{segment.team}</td>
                    <td className="border border-slate-200 px-2 py-1 text-xs text-slate-500">{segment.issuedAt}</td>
                    <td className="border border-slate-200 px-2 py-1">
                      <span className="text-xs">
                        {used} / {size}
                      </span>
                      <div className="mt-1 h-1.5 w-28 rounded bg-slate-100">
                        <div
                          className={`h-1.5 rounded ${used >= size ? 'bg-amber-500' : 'bg-field-500'}`}
                          style={{ width: `${Math.min(100, size > 0 ? (used / size) * 100 : 0)}%` }}
                        />
                      </div>
                    </td>
                    <td className="border border-slate-200 px-2 py-1">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[segment.status]}`}>
                        {segment.status}
                      </span>
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-xs text-slate-500">{segment.note || '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">
                      {segment.status === '在用' ? (
                        <span className="flex flex-wrap gap-1">
                          <button className="btn-ghost" type="button" onClick={() => void close(segment)}>
                            核销
                          </button>
                          {segment.usedSerials.length === 0 ? (
                            <button className="btn-danger" type="button" onClick={() => void voidSegment(segment)}>
                              作废
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {segment.status === '历史' ? '升级补录' : segment.status === '已核销' ? `余 ${segmentRemaining(segment)} 号` : '已收回'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {segments.length === 0 ? (
                <tr>
                  <td className="border border-slate-200 px-2 py-6 text-center text-sm text-slate-400" colSpan={7}>
                    还没有号段，先在上方发放一段
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">
          「历史」段是系统升级时按现有标本编号补录的，保证新发的段不会与旧编号重叠；作废仅限一号未用的段，作废后号可重新发放。
        </p>
      </section>
    </div>
  )
}
