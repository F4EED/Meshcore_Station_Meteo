import { BAND_FIELDS, BAND_ORDER, type Band, type BandField, type BandId } from '../model'

export type BandSet = Record<BandId, Band>

function band(mean: number | null, low: number | null, high: number | null, veryLow: number | null, warnLow: number | null, warnHigh: number | null, veryHigh: number | null): Band {
  return { mean, low, high, veryLow, warnLow, warnHigh, veryHigh }
}

export const FACTORY_BANDS: BandSet = {
  temp: band(15, -10, 40, -20, 0, 35, 45),
  humidity: band(55, 20, 90, null, 30, 80, null),
  pressure: band(1013, 980, 1040, null, null, null, null),
  gas: band(50_000, 5_000, 10_000_000, null, null, null, null),
  iaq: band(50, null, 150, null, null, null, 200),
  eco2: band(600, 400, 1500, null, null, null, null),
  frost: band(0, 0, 40, null, null, 25, 60),
  fire: band(0, 0, 50, null, null, 35, 70),
}

export function cloneBand(source: Band): Band {
  return { ...source }
}

export function cloneBandSet(source: BandSet = FACTORY_BANDS): BandSet {
  const copy = {} as BandSet
  for (const id of BAND_ORDER) copy[id] = cloneBand(source[id])
  return copy
}

export function bandsToList(set: BandSet): Band[] {
  return BAND_ORDER.map((id) => cloneBand(set[id]))
}

export function listToBandSet(list: Band[]): BandSet {
  const set = cloneBandSet()
  BAND_ORDER.forEach((id, index) => {
    if (list[index]) set[id] = cloneBand(list[index])
  })
  return set
}

export function formatBandField(value: number | null): string {
  return value == null ? '' : String(value)
}

export function parseUserNumber(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!text) return null
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) throw new Error(`Nombre invalide : ${raw}`)
  return Number(text)
}

export function parseBandDraft(draft: Record<BandField, string>): Band {
  const bandValue = {} as Band
  for (const field of BAND_FIELDS) bandValue[field] = parseUserNumber(draft[field])
  return bandValue
}
