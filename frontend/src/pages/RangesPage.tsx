import { useMemo, useState } from 'react'
import type { NumberRange, RangeStatus } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { numberRangeStore } from '@/stores/numberRangeStore'
import { siteStore } from '@/stores/siteStore'
import { specimenStore } from '@/stores/specimenStore'
import { formatSerial, rangeLabel, usedSerialsFromSpecimens } from '@/utils/range'

const STATUS_STYLES: Record<RangeStatus, string> = {
  在用: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  已报回: 'border-slate-300 bg-slate-100 text-slate-600',
  历史段: 'border-amber-300 bg-amber-50 text-amber-700'
}

function StatusBadge({ status }: { status: RangeStatus }): JSX.Element {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs leading-5 ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  )
}

/** 报回对账弹窗：系统内已用编号 + 补报编号，校验通过才落库，否则退回 */
function ReportBackModal({ range, onClose }: { range: NumberRange; onClose: () => void }) {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const systemSerials = useMemo(() => usedSerialsFromSpecimens(range, specimens), [range, specimens])

  const [extraText, setExtraText] = useState('')
  const [reportedDate, setReportedDate] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const extraSerials = useMemo(
    () =>
      [
        ...new Set(
          extraText
            .split(/[^0-9]+/)
            .filter(Boolean)
            .map((text) => Number(text))
        )
      ].sort((a, b) => a - b),
    [extraText]
  )
  const allSerials = useMemo(
    () => [...new Set([...systemSerials, ...extraSerials])].sort((a, b) => a - b),
    [systemSerials, extraSerials]
  )

  const submit = async (): Promise<void> => {
    setError('')
    const result = await numberRangeStore.getState().reportBack(range.id, allSerials, reportedDate)
    if (!result.ok) {
      setError(result.error ?? '报回被退回')
      return
    }
    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="panel w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-slate-800">报回用量 · {rangeLabel(range)}</h2>
        <p className="mt-1 text-xs text-slate-500">
          领用队「{range.team}」回馆对账。用量不得超出本段上限，也不得与别的队手里的段搭上；不通过则整趟退回，号段不动。
        </p>

        <dl className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <div>
            <dt className="inline text-slate-400">本段上限：</dt>
            <dd className="inline font-mono">
              {range.siteCode}-{range.year}-{formatSerial(range.endSerial)}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-400">系统内已用编号：</dt>
            <dd className="inline">{systemSerials.length} 个（采集登记时从段内分配）</dd>
          </div>
        </dl>

        <div className="mt-3">
          <span className="field-label">补报编号（手写标签等未入系统的号，填流水号，逗号或空格分隔）</span>
          <input
            className="field-input"
            value={extraText}
            onChange={(e) => setExtraText(e.target.value)}
            placeholder="如 3, 7, 12"
            disabled={done}
          />
        </div>

        <div className="mt-3">
          <span className="field-label">报回日期</span>
          <input type="date" className="field-input" value={reportedDate} onChange={(e) => setReportedDate(e.target.value)} disabled={done} />
        </div>

        {allSerials.length > 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            本趟报回 {allSerials.length} 个编号：
            <span className="font-mono text-slate-700">
              {allSerials.slice(0, 12).map((serial) => formatSerial(serial)).join('、')}
              {allSerials.length > 12 ? ` 等 ${allSerials.length} 个` : ''}
            </span>
          </p>
        ) : null}

        {error ? <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}
        {done ? (
          <p className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-700">
            对账通过：本趟 {allSerials.length} 个编号已报回，号段状态置为「已报回」。
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" type="button" onClick={onClose}>
            {done ? '关闭' : '取消'}
          </button>
          {!done ? (
            <button className="btn-primary" type="button" onClick={() => void submit()}>
              提交报回
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 号段台账：标本馆按采集地 + 年份发段，野外队按段领用、回馆报回用量 */
export default function RangesPage(): JSX.Element {
  const ranges = usePersistentStore(numberRangeStore, (state) => state.rows)
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)

  const [siteCode, setSiteCode] = useState('')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [count, setCount] = useState('50')
  const [team, setTeam] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reportTarget, setReportTarget] = useState<NumberRange | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  const sorted = useMemo(
    () =>
      [...ranges].sort((a, b) => {
        if (a.status !== b.status) {
          const order: Record<RangeStatus, number> = { 在用: 0, 已报回: 1, 历史段: 2 }
          return order[a.status] - order[b.status]
        }
        return (
          b.issuedDate.localeCompare(a.issuedDate) ||
          a.siteCode.localeCompare(b.siteCode) ||
          b.year.localeCompare(a.year) ||
          a.startSerial - b.startSerial
        )
      }),
    [ranges]
  )

  const issue = async (): Promise<void> => {
    if (!siteCode) {
      setError('请选择采集地')
      return
    }
    if (!/^\d{4}$/.test(year.trim())) {
      setError('年份应为 4 位数字')
      return
    }
    const n = Number(count)
    if (!Number.isInteger(n) || n <= 0) {
      setError('段内数量应为正整数')
      return
    }
    if (!team.trim()) {
      setError('请填写领用队')
      return
    }
    setError('')
    try {
      const row = await numberRangeStore.getState().issue({ siteCode, year: year.trim(), count: n, team, note, issuedDate: today })
      setMessage(`已发段：${rangeLabel(row)}，领用队「${row.team}」，共 ${n} 个号`)
      setNote('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const remove = async (range: NumberRange): Promise<void> => {
    if (!window.confirm(`确定删除号段 ${rangeLabel(range)}（${range.team}）？此操作仅清理台账记录。`)) return
    await numberRangeStore.getState().remove(range.id)
    setMessage(`号段 ${rangeLabel(range)} 已删除`)
  }

  const specimensInRange = (range: NumberRange): number =>
    usedSerialsFromSpecimens(range, specimens).length

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">号段台账</h1>
        <p className="page-sub">
          野外队出发前向标本馆领一段编号，馆里按采集地 + 年份发段，队里在段内往下取号，回馆按用掉的编号报回对账。用量超出本段上限或与别的队手里的段搭上，整趟报回退回，馆里的号段不跟着动。
        </p>
      </header>

      <section className="panel">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">标本馆发段</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <div>
            <span className="field-label">采集地</span>
            <select className="field-input" value={siteCode} onChange={(e) => setSiteCode(e.target.value)}>
              <option value="">选择采集地</option>
              {sites.map((site) => (
                <option key={site.id} value={site.code}>
                  {site.code} · {site.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="field-label">年份</span>
            <input className="field-input" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026" />
          </div>
          <div>
            <span className="field-label">段内数量（个号）</span>
            <input className="field-input" value={count} onChange={(e) => setCount(e.target.value)} placeholder="50" />
          </div>
          <div>
            <span className="field-label">领用队</span>
            <input className="field-input" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="如 样地调查一队" />
          </div>
          <div>
            <span className="field-label">备注</span>
            <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-field-700">{message}</p> : null}
        <div className="mt-3">
          <button className="btn-primary" type="button" onClick={() => void issue()}>
            发出号段
          </button>
        </div>
      </section>

      <section className="panel overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">号段记录（{sorted.length}）</h2>
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs text-slate-500">
              <th className="border border-slate-200 px-2 py-1">号段</th>
              <th className="border border-slate-200 px-2 py-1">流水号区间</th>
              <th className="border border-slate-200 px-2 py-1">领用队</th>
              <th className="border border-slate-200 px-2 py-1">状态</th>
              <th className="border border-slate-200 px-2 py-1">发段日期</th>
              <th className="border border-slate-200 px-2 py-1">报回日期</th>
              <th className="border border-slate-200 px-2 py-1">已用 / 上限</th>
              <th className="border border-slate-200 px-2 py-1">备注</th>
              <th className="border border-slate-200 px-2 py-1">操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((range) => {
              const used =
                range.status === '已报回' ? range.usedSerials.length : specimensInRange(range)
              const capacity = range.endSerial - range.startSerial + 1
              return (
                <tr key={range.id}>
                  <td className="border border-slate-200 px-2 py-1 font-mono text-xs text-field-700">
                    {range.siteCode}-{range.year}
                  </td>
                  <td className="border border-slate-200 px-2 py-1 font-mono text-xs">
                    {formatSerial(range.startSerial)} ~ {formatSerial(range.endSerial)}
                  </td>
                  <td className="border border-slate-200 px-2 py-1">{range.team}</td>
                  <td className="border border-slate-200 px-2 py-1">
                    <StatusBadge status={range.status} />
                  </td>
                  <td className="border border-slate-200 px-2 py-1 text-xs">{range.issuedDate}</td>
                  <td className="border border-slate-200 px-2 py-1 text-xs">{range.reportedDate ?? '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-xs">
                    <span className={used > capacity ? 'font-semibold text-rose-600' : ''}>
                      {used} / {capacity}
                    </span>
                  </td>
                  <td className="border border-slate-200 px-2 py-1 text-xs text-slate-500">{range.note || '—'}</td>
                  <td className="border border-slate-200 px-2 py-1">
                    <div className="flex gap-1">
                      {range.status === '在用' ? (
                        <button className="btn-primary px-2 py-1 text-xs" type="button" onClick={() => setReportTarget(range)}>
                          报回
                        </button>
                      ) : null}
                      <button
                        className="btn-danger px-2 py-1 text-xs"
                        type="button"
                        onClick={() => void remove(range)}
                        title={
                          range.status === '在用' && specimensInRange(range) > 0
                            ? '该段已有标本采集记录，删除后采集页将无法分配编号'
                            : undefined
                        }
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="border border-slate-200 px-2 py-6 text-center text-xs text-slate-400">
                  暂无号段记录
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {reportTarget ? <ReportBackModal range={reportTarget} onClose={() => setReportTarget(null)} /> : null}
    </div>
  )
}
