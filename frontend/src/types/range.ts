/** 号段状态 */
export const RANGE_STATUSES = ['在用', '已报回', '历史段'] as const
export type RangeStatus = (typeof RANGE_STATUSES)[number]

/**
 * NumberRange 号段：标本馆按「采集地代码 - 年份」发给野外队的一段流水号。
 * 队里在段内往下取号，回来按用掉的编号报回对账。
 */
export interface NumberRange {
  id: string
  /** 采集地代码（与标本编号前缀一致） */
  siteCode: string
  /** 年份（4 位字符串） */
  year: string
  /** 起始流水号（含） */
  startSerial: number
  /** 结束流水号（含，本段上限） */
  endSerial: number
  /** 领用队 */
  team: string
  /** 在用：已发出未对账；已报回：对账完成；历史段：升级时按存量编号补建 */
  status: RangeStatus
  /** 发段日期 */
  issuedDate: string
  /** 报回日期（对账成功后填写） */
  reportedDate?: string
  /** 本趟实际用掉的流水号（报回时登记） */
  usedSerials: number[]
  /** 备注 */
  note: string
}
