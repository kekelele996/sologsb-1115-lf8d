import type { NumberSegment } from '@/types'
import { buildSpecimenCode, isDuplicateCode, parseSpecimenCode } from '@/utils/codec'
import { uid } from '@/utils/id'

/** 段容量（含起止） */
export function segmentSize(segment: Pick<NumberSegment, 'start' | 'end'>): number {
  return segment.end - segment.start + 1
}

/** 段内剩余可用号数 */
export function segmentRemaining(segment: NumberSegment): number {
  return segmentSize(segment) - segment.usedSerials.length
}

/** 段是否仍占着号（参与重叠校验）：已作废且一号未用的段视为已释放 */
export function occupiesRange(segment: NumberSegment): boolean {
  return segment.status !== '已作废' || segment.usedSerials.length > 0
}

/** 号段展示文本：QLB-2026-0001 ~ QLB-2026-0100 */
export function segmentRangeText(segment: Pick<NumberSegment, 'siteCode' | 'year' | 'start' | 'end'>): string {
  return `${buildSpecimenCode(segment.siteCode, segment.year, segment.start)} ~ ${buildSpecimenCode(segment.siteCode, segment.year, segment.end)}`
}

/** 同采集地+年份下，与候选段区间相交且仍占号的现存段 */
export function findOverlappingSegments(
  segments: NumberSegment[],
  candidate: Pick<NumberSegment, 'siteCode' | 'year' | 'start' | 'end'> & { id?: string }
): NumberSegment[] {
  return segments.filter(
    (item) =>
      item.id !== candidate.id &&
      item.siteCode === candidate.siteCode.toUpperCase() &&
      item.year === String(candidate.year) &&
      occupiesRange(item) &&
      item.start <= candidate.end &&
      candidate.start <= item.end
  )
}

/** 建议起始号：现存段上限与已有标本编号的最大流水号 + 1 */
export function suggestSegmentStart(
  siteCode: string,
  year: string,
  segments: NumberSegment[],
  existingCodes: string[]
): number {
  const prefix = siteCode.toUpperCase()
  const segEnds = segments
    .filter((item) => item.siteCode === prefix && item.year === String(year) && occupiesRange(item))
    .map((item) => item.end)
  const codeSerials = existingCodes
    .map((code) => parseSpecimenCode(code))
    .filter((parsed): parsed is { siteCode: string; year: string; serial: number } => parsed !== null)
    .filter((parsed) => parsed.siteCode === prefix && parsed.year === String(year))
    .map((parsed) => parsed.serial)
  const all = [...segEnds, ...codeSerials]
  return all.length > 0 ? Math.max(...all) + 1 : 1
}

/**
 * 从段内往下取下一个号：接着已用号（含批次内预留、库中已占）的最大值往下编，不回填空洞；
 * 越过段上限返回 null（段已用完）
 */
export function nextSerialInSegment(segment: NumberSegment, reserved: number[] = [], extraUsed: number[] = []): number | null {
  const used = [...segment.usedSerials, ...reserved, ...extraUsed].filter(
    (serial) => serial >= segment.start && serial <= segment.end
  )
  const next = used.length > 0 ? Math.max(...used) + 1 : segment.start
  return next <= segment.end ? next : null
}

/** 升级迁移：按现成编号把用过的号补成历史段（按 采集地代码+年份 分组，一组一段） */
export function backfillHistoricalSegments(codes: string[], today: string): NumberSegment[] {
  const groups = new Map<string, { siteCode: string; year: string; serials: number[] }>()
  codes.forEach((code) => {
    const parsed = parseSpecimenCode(code)
    if (!parsed) return
    const key = `${parsed.siteCode}-${parsed.year}`
    const group = groups.get(key) ?? { siteCode: parsed.siteCode, year: parsed.year, serials: [] }
    group.serials.push(parsed.serial)
    groups.set(key, group)
  })
  return [...groups.values()].map((group) => {
    const serials = [...new Set(group.serials)].sort((a, b) => a - b)
    return {
      id: uid('seg'),
      siteCode: group.siteCode,
      year: group.year,
      start: serials[0],
      end: serials[serials.length - 1],
      team: '历史遗留（升级补录）',
      status: '历史' as const,
      usedSerials: serials,
      issuedAt: today,
      note: '系统升级时按现有标本编号补录的历史段'
    }
  })
}

export interface TripCheckInput {
  /** 本趟报回依托的号段 */
  segment: NumberSegment
  /** 本趟报回的编号（已解析出流水号） */
  entries: { code: string; serial: number }[]
  /** 同采集地+年份、其他队手里的段 */
  otherSegments: NumberSegment[]
  /** 标本库里已存在的编号 */
  existingCodes: string[]
}

/** 报回校验：返回退回原因，null 表示通过（超上限 / 搭上别队的段 / 撞号均退回） */
export function validateTripReport({ segment, entries, otherSegments, existingCodes }: TripCheckInput): string | null {
  if (entries.length === 0) return '本趟没有报回任何编号'

  const seen = new Set<number>()
  for (const entry of entries) {
    if (seen.has(entry.serial)) return `批次内编号重复：${entry.code}`
    seen.add(entry.serial)
  }

  const outOfRange = entries.filter((entry) => entry.serial < segment.start || entry.serial > segment.end)
  if (outOfRange.length > 0) {
    return `编号 ${outOfRange.map((entry) => entry.code).join('、')} 超出本段上限（${segmentRangeText(segment)}）`
  }

  const usedSet = new Set(segment.usedSerials)
  const reused = entries.filter((entry) => usedSet.has(entry.serial))
  if (reused.length > 0) {
    return `编号 ${reused.map((entry) => entry.code).join('、')} 在本段里已经报回过`
  }

  for (const other of otherSegments) {
    if (!occupiesRange(other)) continue
    const hit = entries.filter((entry) => entry.serial >= other.start && entry.serial <= other.end)
    if (hit.length > 0) {
      return `编号 ${hit.map((entry) => entry.code).join('、')} 搭上了「${other.team}」手里的段（${segmentRangeText(other)}）`
    }
  }

  const clash = entries.filter((entry) => isDuplicateCode(entry.code, existingCodes))
  if (clash.length > 0) {
    return `编号 ${clash.map((entry) => entry.code).join('、')} 与库中已有标本重复`
  }

  return null
}
