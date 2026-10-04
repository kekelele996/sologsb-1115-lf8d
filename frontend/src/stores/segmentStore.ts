import { create } from 'zustand'
import type { NumberSegment, Specimen } from '@/types'
import { db, loadAll, putRow } from '@/hooks/usePersistentStore'
import { parseSpecimenCode } from '@/utils/codec'
import { findOverlappingSegments, segmentRangeText, validateTripReport } from '@/utils/segment'
import { uid } from '@/utils/id'

export interface IssueInput {
  siteCode: string
  year: string
  start: number
  end: number
  team: string
  note: string
}

export interface SegmentState {
  rows: NumberSegment[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 馆方发放号段：先查台账，与任何一队手里的段重叠都不能发 */
  issue: (input: IssueInput) => Promise<{ ok: boolean; error?: string }>
  /** 对账核销（在用 → 已核销） */
  close: (id: string) => Promise<void>
  /** 作废收回（仅限一号未用的段） */
  voidSegment: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** 野外队报回：事务内校验，任一不过则整批退回，标本与台账都不落库 */
  reportTrip: (segmentId: string, rows: Specimen[]) => Promise<{ ok: boolean; error?: string }>
}

export const segmentStore = create<SegmentState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<NumberSegment>(db.segments)
    rows.sort((a, b) =>
      `${a.siteCode}-${a.year}-${String(a.start).padStart(5, '0')}`.localeCompare(
        `${b.siteCode}-${b.year}-${String(b.start).padStart(5, '0')}`
      )
    )
    set({ rows, loaded: true })
  },
  issue: async (input) => {
    const siteCode = input.siteCode.trim().toUpperCase()
    const year = input.year.trim()
    const team = input.team.trim()
    if (!siteCode || !/^\d{4}$/.test(year)) return { ok: false, error: '请选择采集地并填写 4 位年份' }
    if (!team) return { ok: false, error: '请填写领用队伍' }
    if (!Number.isInteger(input.start) || input.start < 1) return { ok: false, error: '起始号必须是 ≥1 的整数' }
    if (!Number.isInteger(input.end) || input.end < input.start) return { ok: false, error: '截止号不能小于起始号' }
    if (input.end - input.start + 1 > 99999) return { ok: false, error: '单段不能超过 99999 个号' }
    const candidate: NumberSegment = {
      id: uid('seg'),
      siteCode,
      year,
      start: input.start,
      end: input.end,
      team,
      status: '在用',
      usedSerials: [],
      issuedAt: new Date().toISOString().slice(0, 10),
      note: input.note.trim()
    }
    const overlaps = findOverlappingSegments(get().rows, candidate)
    if (overlaps.length > 0) {
      const first = overlaps[0]
      return {
        ok: false,
        error: `与「${first.team}」手里的段（${segmentRangeText(first)}）重叠，不能发放`
      }
    }
    await putRow<NumberSegment>(db.segments, candidate)
    await get().hydrate()
    return { ok: true }
  },
  close: async (id) => {
    const target = get().rows.find((row) => row.id === id)
    if (!target || target.status !== '在用') return
    await putRow<NumberSegment>(db.segments, { ...target, status: '已核销' })
    await get().hydrate()
  },
  voidSegment: async (id) => {
    const target = get().rows.find((row) => row.id === id)
    if (!target) return { ok: false, error: '号段不存在' }
    if (target.usedSerials.length > 0) return { ok: false, error: '这段已经报回过号，不能作废，只能核销' }
    await putRow<NumberSegment>(db.segments, { ...target, status: '已作废' })
    await get().hydrate()
    return { ok: true }
  },
  reportTrip: async (segmentId, rows) => {
    try {
      await db.transaction('rw', [db.segments, db.specimens], async () => {
        const segment = await db.segments.get(segmentId)
        if (!segment) throw new Error('号段不存在，可能已被馆方收回')
        if (segment.status !== '在用') throw new Error(`号段（${segmentRangeText(segment)}）当前状态为「${segment.status}」，不能报回`)
        const entries = rows.map((row) => {
          const parsed = parseSpecimenCode(row.code)
          if (!parsed || parsed.siteCode !== segment.siteCode || parsed.year !== segment.year) {
            throw new Error(`编号 ${row.code} 不属于号段 ${segment.siteCode}-${segment.year}`)
          }
          return { code: row.code, serial: parsed.serial }
        })
        const siblings = (await db.segments.toArray()).filter(
          (item) => item.id !== segment.id && item.siteCode === segment.siteCode && item.year === segment.year
        )
        const existingCodes = (await db.specimens.toArray()).map((item) => item.code)
        const error = validateTripReport({ segment, entries, otherSegments: siblings, existingCodes })
        if (error) throw new Error(error)
        await db.specimens.bulkPut(rows)
        const usedSerials = [...segment.usedSerials, ...entries.map((entry) => entry.serial)].sort((a, b) => a - b)
        await db.segments.put({ ...segment, usedSerials })
      })
    } catch (cause) {
      // 事务已回滚：标本不入库，馆里的号段也不跟着动
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }
    await get().hydrate()
    return { ok: true }
  }
}))
