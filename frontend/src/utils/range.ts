import type { NumberRange, RangeStatus, Specimen } from '@/types'
import { buildSpecimenCode, parseSpecimenCode } from './codec'

/** 流水号显示：4 位补零，如 7 → 0007 */
export function formatSerial(serial: number): string {
  return String(serial).padStart(4, '0')
}

/** 号段完整编号文本，如 QLB-2026-0003 ~ QLB-2026-0050 */
export function rangeLabel(range: NumberRange): string {
  return `${range.siteCode}-${range.year}-${formatSerial(range.startSerial)} ~ ${formatSerial(range.endSerial)}`
}

/** 两段是否同采集地、同年且区间重叠 */
export function rangesOverlap(a: NumberRange, b: NumberRange): boolean {
  return (
    a.siteCode === b.siteCode &&
    a.year === b.year &&
    a.startSerial <= b.endSerial &&
    b.startSerial <= a.endSerial
  )
}

/** 某流水号是否落在号段区间内 */
export function serialInRange(range: NumberRange, serial: number): boolean {
  return serial >= range.startSerial && serial <= range.endSerial
}

/** 同采集地 + 年份的已有号段中最大结束号，新段从这里接着发 */
export function nextRangeStart(ranges: NumberRange[], siteCode: string, year: string | number): number {
  const prefix = siteCode.toUpperCase()
  const yearText = String(year)
  const ends = ranges
    .filter((range) => range.siteCode === prefix && range.year === yearText)
    .map((range) => range.endSerial)
  return ends.length > 0 ? Math.max(...ends) + 1 : 1
}

/** 发段前校验：新段不得与已有号段重叠 */
export function validateNewRange(
  ranges: NumberRange[],
  siteCode: string,
  year: string | number,
  startSerial: number,
  endSerial: number
): string | null {
  const prefix = siteCode.toUpperCase()
  const yearText = String(year)
  if (startSerial < 1 || endSerial < startSerial) return '号段区间不合法'
  const candidate = { siteCode: prefix, year: yearText, startSerial, endSerial } as NumberRange
  const clash = ranges.find((item) => item.siteCode === prefix && item.year === yearText && rangesOverlap(item, candidate))
  if (clash) {
    return `新段 ${prefix}-${yearText}-${formatSerial(startSerial)}~${formatSerial(endSerial)} 与已有号段（领用队 ${clash.team}，${formatSerial(
      clash.startSerial
    )}~${formatSerial(clash.endSerial)}）重叠，请从 ${nextRangeStart(ranges, prefix, yearText)} 号以后接着发`
  }
  return null
}

export interface ReportCheck {
  ok: boolean
  error?: string
}

/**
 * 报回前校验：
 * - 用量不得超出本段上限（也不得低于段起始号）；
 * - 不得与别的队手里的段搭上（编号落在对方区间内）。
 * 任一条件不满足则退回，馆里的号段不跟着动。
 */
export function validateReportBack(
  range: NumberRange,
  ranges: NumberRange[],
  usedSerials: number[]
): ReportCheck {
  const others = ranges.filter(
    (item) => item.id !== range.id && item.siteCode === range.siteCode && item.year === range.year
  )
  const serials = [...new Set(usedSerials)].sort((a, b) => a - b)
  for (const serial of serials) {
    if (serial < range.startSerial) {
      return {
        ok: false,
        error: `报回退回：${buildSpecimenCode(range.siteCode, range.year, serial)} 不在本段（${formatSerial(
          range.startSerial
        )}~${formatSerial(range.endSerial)}）范围内`
      }
    }
    if (serial > range.endSerial) {
      return {
        ok: false,
        error: `报回退回：用量超出本段上限，${buildSpecimenCode(range.siteCode, range.year, serial)} 已超过本段结束号 ${formatSerial(
          range.endSerial
        )}`
      }
    }
    const clash = others.find((item) => serialInRange(item, serial))
    if (clash) {
      return {
        ok: false,
        error: `报回退回：${buildSpecimenCode(range.siteCode, range.year, serial)} 与「${clash.team}」手里的段（${formatSerial(
          clash.startSerial
        )}~${formatSerial(clash.endSerial)}）搭上了，请队里核对本趟实际用号`
      }
    }
  }
  return { ok: true }
}

/** 从存量标本编号中解析某号段内已用的流水号 */
export function usedSerialsFromSpecimens(range: NumberRange, specimens: Specimen[]): number[] {
  return specimens
    .map((specimen) => parseSpecimenCode(specimen.code))
    .filter((parsed) => parsed !== null)
    .filter(
      (parsed) =>
        parsed.siteCode === range.siteCode &&
        parsed.year === range.year &&
        parsed.serial >= range.startSerial &&
        parsed.serial <= range.endSerial
    )
    .map((parsed) => parsed.serial)
    .sort((a, b) => a - b)
}

/**
 * 段内分配下一个流水号：取段内已用最大号 + 1，不超过本段上限；段满返回 null。
 * reserved 为同一批次已预占的流水号。
 */
export function nextSerialInRange(
  range: NumberRange,
  specimens: Specimen[],
  reserved: number[] = []
): number | null {
  const used = new Set<number>(reserved)
  for (const serial of usedSerialsFromSpecimens(range, specimens)) used.add(serial)
  let next = range.startSerial
  if (used.size > 0) next = Math.max(next, Math.max(...used) + 1)
  for (let serial = next; serial <= range.endSerial; serial += 1) {
    if (!used.has(serial)) return serial
  }
  return null
}

/** 报回状态下的已用比例文案，如 3 / 48 */
export function rangeUsageText(range: NumberRange, specimens: Specimen[]): string {
  const used =
    range.status === '已报回'
      ? range.usedSerials.length
      : usedSerialsFromSpecimens(range, specimens).length
  const capacity = range.endSerial - range.startSerial + 1
  return `${used} / ${capacity}`
}

/**
 * 按存量标本编号补建历史段（升级迁移用）：
 * 同一采集地 + 年份的编号归为一段，区间取现成编号的最小 ~ 最大流水号。
 */
export function buildHistoricalRanges(
  specimens: Specimen[],
  today: string,
  note = '升级时按存量标本编号补建的历史段'
): NumberRange[] {
  const groups = new Map<string, { siteCode: string; year: string; serials: number[] }>()
  for (const specimen of specimens) {
    const parsed = parseSpecimenCode(specimen.code)
    if (!parsed) continue
    const key = `${parsed.siteCode}__${parsed.year}`
    const group = groups.get(key) ?? { siteCode: parsed.siteCode, year: parsed.year, serials: [] }
    group.serials.push(parsed.serial)
    groups.set(key, group)
  }
  const ranges: NumberRange[] = []
  for (const group of groups.values()) {
    const serials = [...new Set(group.serials)].sort((a, b) => a - b)
    ranges.push({
      id: `range_history_${group.siteCode}_${group.year}`,
      siteCode: group.siteCode,
      year: group.year,
      startSerial: serials[0],
      endSerial: serials[serials.length - 1],
      team: '历史数据',
      status: '历史段' as RangeStatus,
      issuedDate: today,
      usedSerials: serials,
      note
    })
  }
  return ranges.sort((a, b) => a.siteCode.localeCompare(b.siteCode) || a.year.localeCompare(b.year))
}
