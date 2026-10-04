/** 号段状态：在用 → 已核销（对账完成）；已作废（一号未用，馆方收回）；历史（升级时按现有编号补录） */
export const SEGMENT_STATUSES = ['在用', '已核销', '已作废', '历史'] as const
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number]

/** NumberSegment 号段：标本馆按采集地+年份发放给野外队的一段流水号 */
export interface NumberSegment {
  id: string
  /** 采集地代码（标本编号前缀） */
  siteCode: string
  /** 编号年份 */
  year: string
  /** 起始流水号（含） */
  start: number
  /** 截止流水号（含，即这段的上限） */
  end: number
  /** 领用队伍 */
  team: string
  status: SegmentStatus
  /** 队里逐趟报回、已经用掉的流水号 */
  usedSerials: number[]
  /** 发放日期 */
  issuedAt: string
  note: string
}
