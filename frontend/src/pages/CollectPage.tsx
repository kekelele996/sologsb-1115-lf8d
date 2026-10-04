import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CollectMethod, Sex, Specimen, Stage } from '@/types'
import { COLLECT_METHODS, ORDERS, SEXES, STAGES } from '@/types'
import SpecimenCard from '@/components/common/SpecimenCard'
import SitePicker from '@/components/common/SitePicker'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { siteStore } from '@/stores/siteStore'
import { segmentStore } from '@/stores/segmentStore'
import { buildSpecimenCode, parseSpecimenCode } from '@/utils/codec'
import { nextSerialInSegment, segmentRangeText, segmentRemaining } from '@/utils/segment'
import { uid } from '@/utils/id'

interface DraftRow {
  id: string
  order: string
  family: string
  genus: string
  species: string
  tempName: string
  sex: Sex
  stage: Stage
  bodyLength: string
  method: CollectMethod
  quantity: string
  note: string
}

const newDraft = (): DraftRow => ({
  id: uid('draft'),
  order: '鞘翅目',
  family: '',
  genus: '',
  species: '',
  tempName: '',
  sex: '未知',
  stage: '成虫',
  bodyLength: '',
  method: '扫网',
  quantity: '1',
  note: ''
})

/** 采集登记：从本队领用的号段内取号，提交即向馆里报回这一趟的用量 */
export default function CollectPage(): JSX.Element {
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const segments = usePersistentStore(segmentStore, (state) => state.rows)

  const [siteId, setSiteId] = useState('')
  const [segmentId, setSegmentId] = useState('')
  const [collectDate, setCollectDate] = useState(new Date().toISOString().slice(0, 10))
  const [collector, setCollector] = useState('')
  const [drafts, setDrafts] = useState<DraftRow[]>([newDraft()])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [justCreated, setJustCreated] = useState<Specimen[]>([])

  const site = sites.find((item) => item.id === siteId)
  const year = collectDate.slice(0, 4) || String(new Date().getFullYear())

  /** 本队在该采集地+年份手里的在用号段；只有一段时自动选中 */
  const activeSegments = useMemo(
    () =>
      segments.filter(
        (item) => item.status === '在用' && item.siteCode === (site?.code ?? '') && item.year === year
      ),
    [segments, site?.code, year]
  )
  const segment =
    activeSegments.find((item) => item.id === segmentId) ??
    (activeSegments.length === 1 ? activeSegments[0] : undefined)

  /** 每行从段内往下取号；库中已占但台账未记录的号一并跳过；段用完的行留空 */
  const codes = useMemo(() => {
    const result: Record<string, string> = {}
    if (!segment) {
      drafts.forEach((draft) => {
        result[draft.id] = ''
      })
      return result
    }
    const extraUsed = specimens
      .map((item) => parseSpecimenCode(item.code))
      .filter((parsed): parsed is { siteCode: string; year: string; serial: number } => parsed !== null)
      .filter(
        (parsed) =>
          parsed.siteCode === segment.siteCode &&
          parsed.year === segment.year &&
          parsed.serial >= segment.start &&
          parsed.serial <= segment.end
      )
      .map((parsed) => parsed.serial)
    const reserved: number[] = []
    drafts.forEach((draft) => {
      const serial = nextSerialInSegment(segment, reserved, extraUsed)
      if (serial === null) {
        result[draft.id] = ''
      } else {
        reserved.push(serial)
        result[draft.id] = buildSpecimenCode(segment.siteCode, segment.year, serial)
      }
    })
    return result
    // drafts 的字段变化不影响编号分配，仅行数与号段影响
  }, [drafts, segment, specimens])

  const patchDraft = (id: string, patch: Partial<DraftRow>): void => {
    setDrafts((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const submit = async (): Promise<void> => {
    if (!site) {
      setError('请先选择采集地（标本编号需要采集地代码）')
      return
    }
    if (!segment) {
      setError(`${site.code}-${year} 没有本队在用的号段，请先到「号段台账」领取`)
      return
    }
    if (drafts.length === 0) {
      setError('至少登记一条标本')
      return
    }
    if (drafts.some((draft) => !codes[draft.id])) {
      setError(`本批次超出号段上限（${segmentRangeText(segment)}），请减少条数或到馆里再领一段`)
      return
    }
    if (drafts.some((row) => !row.order.trim())) {
      setError('每行都需要填写目')
      return
    }
    setError('')
    const rows: Specimen[] = drafts.map((draft) => ({
      id: uid('sp'),
      code: codes[draft.id],
      order: draft.order.trim(),
      family: draft.family.trim(),
      genus: draft.genus.trim(),
      species: draft.species.trim(),
      tempName: draft.tempName.trim(),
      collectDate,
      collector: collector.trim(),
      sex: draft.sex,
      stage: draft.stage,
      bodyLength: Number(draft.bodyLength) || 0,
      method: draft.method,
      quantity: Number(draft.quantity) || 1,
      status: '待鉴定',
      determiner: '',
      siteId: site.id,
      note: draft.note.trim()
    }))
    // 报回：事务内校验，超上限 / 搭上别队的段 / 撞号都会整批退回，号段台账不跟着动
    const result = await segmentStore.getState().reportTrip(segment.id, rows)
    if (!result.ok) {
      setError(`这一趟报回被退回：${result.error}（号段台账未变动）`)
      return
    }
    await specimenStore.getState().hydrate()
    setJustCreated(rows)
    setMessage(
      `本批次已登记 ${rows.length} 份标本并向馆里报回，编号：${rows.map((row) => row.code).join('、')}；段内余量 ${segmentRemaining(
        segment
      ) - rows.length} 号`
    )
    setDrafts([newDraft()])
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">采集登记</h1>
        <p className="page-sub">
          编号从本队领用的号段内依次取用，提交即向馆里报回这一趟的用量；超出号段上限或与其他队的段重叠会被整批退回。
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-[320px_1fr]">
        <div className="panel">
          <SitePicker sites={sites} value={siteId} onChange={setSiteId} />
          {site ? (
            <dl className="mt-3 space-y-1 rounded-lg bg-field-50 p-3 text-xs text-field-700">
              <div>
                <dt className="inline text-field-600">生境类型：</dt>
                <dd className="inline">{site.habitat}</dd>
              </div>
              <div>
                <dt className="inline text-field-600">小生境：</dt>
                <dd className="inline">{site.microHabitat || '—'}</dd>
              </div>
              <div>
                <dt className="inline text-field-600">微气候：</dt>
                <dd className="inline">{site.microClimate || '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-xs text-slate-400">选择采集地后会带出生境与小生境信息</p>
          )}
        </div>

        <div className="panel flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <span className="field-label">采集日期（决定编号年份）</span>
              <input type="date" className="field-input" value={collectDate} onChange={(e) => setCollectDate(e.target.value)} />
            </div>
            <div>
              <span className="field-label">采集人（本批次统一）</span>
              <input className="field-input" value={collector} onChange={(e) => setCollector(e.target.value)} placeholder="如 陆昀" />
            </div>
          </div>

          <div>
            <span className="field-label">本趟使用的号段（野外队出发前向馆里领取）</span>
            {site && activeSegments.length > 0 ? (
              <select
                className="field-input"
                value={segment?.id ?? ''}
                onChange={(e) => setSegmentId(e.target.value)}
                data-testid="segment-picker"
              >
                {activeSegments.length > 1 ? <option value="">请选择号段</option> : null}
                {activeSegments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {segmentRangeText(item)} · {item.team} · 余 {segmentRemaining(item)} 号
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {site
                  ? `${site.code}-${year} 没有在用的号段，请先到「号段台账」领取后再登记`
                  : '先选择采集地，才能看到可使用的号段'}
                <Link className="ml-1 font-medium text-field-700 underline" to="/segments">
                  去号段台账
                </Link>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-ghost" type="button" onClick={() => setDrafts((prev) => [...prev, newDraft()])}>
              + 增加一条标本
            </button>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => setDrafts((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
            >
              - 减少一条
            </button>
            <span className="text-xs text-slate-500">
              本批次 {drafts.length} 条，编号年份 {year}
              {segment ? `，段内余量 ${segmentRemaining(segment)} 号` : ''}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500">
                  <th className="border border-slate-200 px-2 py-1">标本编号</th>
                  <th className="border border-slate-200 px-2 py-1">目</th>
                  <th className="border border-slate-200 px-2 py-1">科</th>
                  <th className="border border-slate-200 px-2 py-1">属</th>
                  <th className="border border-slate-200 px-2 py-1">种</th>
                  <th className="border border-slate-200 px-2 py-1">暂定名</th>
                  <th className="border border-slate-200 px-2 py-1">性别</th>
                  <th className="border border-slate-200 px-2 py-1">虫态</th>
                  <th className="border border-slate-200 px-2 py-1">体长mm</th>
                  <th className="border border-slate-200 px-2 py-1">采集方式</th>
                  <th className="border border-slate-200 px-2 py-1">数量</th>
                  <th className="border border-slate-200 px-2 py-1">操作</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => (
                  <tr key={draft.id}>
                    <td className="border border-slate-200 px-2 py-1 font-mono text-xs text-field-700" data-testid="draft-code">
                      {codes[draft.id] || <span className="font-sans text-rose-500">段内无号可取</span>}
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <select className="field-input" value={draft.order} onChange={(e) => patchDraft(draft.id, { order: e.target.value })}>
                        {ORDERS.map((order) => (
                          <option key={order} value={order}>
                            {order}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input className="field-input" value={draft.family} onChange={(e) => patchDraft(draft.id, { family: e.target.value })} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input className="field-input" value={draft.genus} onChange={(e) => patchDraft(draft.id, { genus: e.target.value })} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input className="field-input" value={draft.species} onChange={(e) => patchDraft(draft.id, { species: e.target.value })} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input className="field-input" value={draft.tempName} onChange={(e) => patchDraft(draft.id, { tempName: e.target.value })} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <select className="field-input" value={draft.sex} onChange={(e) => patchDraft(draft.id, { sex: e.target.value as Sex })}>
                        {SEXES.map((sex) => (
                          <option key={sex} value={sex}>
                            {sex}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <select className="field-input" value={draft.stage} onChange={(e) => patchDraft(draft.id, { stage: e.target.value as Stage })}>
                        {STAGES.map((stage) => (
                          <option key={stage} value={stage}>
                            {stage}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input className="field-input w-20" value={draft.bodyLength} onChange={(e) => patchDraft(draft.id, { bodyLength: e.target.value })} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <select
                        className="field-input"
                        value={draft.method}
                        onChange={(e) => patchDraft(draft.id, { method: e.target.value as CollectMethod })}
                      >
                        {COLLECT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <input className="field-input w-16" value={draft.quantity} onChange={(e) => patchDraft(draft.id, { quantity: e.target.value })} />
                    </td>
                    <td className="border border-slate-200 px-1 py-1">
                      <button
                        className="btn-danger"
                        type="button"
                        onClick={() => setDrafts((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== draft.id) : prev))}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <span className="field-label">批次备注</span>
            <input
              className="field-input"
              value={drafts[0]?.note ?? ''}
              onChange={(e) => setDrafts((prev) => prev.map((row) => ({ ...row, note: e.target.value })))}
              placeholder="如 灯诱 20:30–22:00，翅面有磨损"
            />
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {message ? <p className="text-sm text-field-700">{message}</p> : null}

          <div className="flex gap-2">
            <button className="btn-primary" type="button" onClick={() => void submit()}>
              提交本批次（{drafts.length} 条）
            </button>
            <button className="btn-ghost" type="button" onClick={() => setDrafts([newDraft()])}>
              重置批次
            </button>
          </div>
        </div>
      </section>

      {justCreated.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">刚刚登记入库的标本</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {justCreated.map((specimen) => (
              <SpecimenCard key={specimen.id} specimen={specimen} site={site} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
