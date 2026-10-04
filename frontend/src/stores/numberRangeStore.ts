import { create } from 'zustand'
import type { NumberRange } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { nextRangeStart, validateNewRange, validateReportBack } from '@/utils/range'
import { uid } from '@/utils/id'

export interface IssueRangeInput {
  /** 采集地代码 */
  siteCode: string
  /** 年份（4 位） */
  year: string
  /** 本段流水号数量 */
  count: number
  /** 领用队 */
  team: string
  /** 发段日期 */
  issuedDate: string
  note: string
}

export interface NumberRangeState {
  rows: NumberRange[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 标本馆发段：新段接在同采集地 + 年份最大号之后，重叠则拒绝 */
  issue: (input: IssueRangeInput) => Promise<NumberRange>
  /** 野外队报回用量：校验不通过则退回，馆里号段不跟着动 */
  reportBack: (id: string, usedSerials: number[], reportedDate: string) => Promise<{ ok: boolean; error?: string }>
  remove: (id: string) => Promise<void>
}

export const numberRangeStore = create<NumberRangeState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<NumberRange>(db.numberRanges)
    rows.sort(
      (a, b) =>
        b.issuedDate.localeCompare(a.issuedDate) ||
        a.siteCode.localeCompare(b.siteCode) ||
        a.year.localeCompare(b.year) ||
        a.startSerial - b.startSerial
    )
    set({ rows, loaded: true })
  },
  issue: async (input) => {
    const siteCode = input.siteCode.trim().toUpperCase()
    const year = String(input.year).trim()
    const team = input.team.trim()
    if (!siteCode) throw new Error('发段需要采集地代码')
    if (!/^\d{4}$/.test(year)) throw new Error('年份应为 4 位数字')
    if (!Number.isInteger(input.count) || input.count <= 0) throw new Error('段内数量应为正整数')
    if (!team) throw new Error('请填写领用队')

    const startSerial = nextRangeStart(get().rows, siteCode, year)
    const endSerial = startSerial + input.count - 1
    const clash = validateNewRange(get().rows, siteCode, year, startSerial, endSerial)
    if (clash) throw new Error(clash)

    const row: NumberRange = {
      id: uid('range'),
      siteCode,
      year,
      startSerial,
      endSerial,
      team,
      status: '在用',
      issuedDate: input.issuedDate,
      usedSerials: [],
      note: input.note.trim()
    }
    await putRow<NumberRange>(db.numberRanges, row)
    await get().hydrate()
    return row
  },
  reportBack: async (id, usedSerials, reportedDate) => {
    const range = get().rows.find((item) => item.id === id)
    if (!range) return { ok: false, error: '号段不存在' }
    if (range.status !== '在用') {
      return { ok: false, error: `该号段状态为「${range.status}」，不能报回` }
    }
    const serials = [...new Set(usedSerials)].sort((a, b) => a - b)
    const check = validateReportBack(range, get().rows, serials)
    if (!check.ok) {
      // 退回：不写库、不改状态，馆里的号段保持原样
      return { ok: false, error: check.error }
    }
    await putRow<NumberRange>(db.numberRanges, {
      ...range,
      status: '已报回',
      reportedDate,
      usedSerials: serials
    })
    await get().hydrate()
    return { ok: true }
  },
  remove: async (id) => {
    await deleteRow<NumberRange>(db.numberRanges, id)
    await get().hydrate()
  }
}))
