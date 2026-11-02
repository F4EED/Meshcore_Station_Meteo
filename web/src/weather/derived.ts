import type { Band } from '../model'

export type FrostKind = 'aucun' | 'gel' | 'verglas'

export type FrostAssessment = { score: number; kind: FrostKind }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function dewPointC(temperatureC: number, humidityPct: number): number | null {
  if (humidityPct < 1 || humidityPct > 100) return null
  const a = 17.62
  const b = 243.12
  const gamma = Math.log(humidityPct / 100) + (a * temperatureC) / (b + temperatureC)
  const denominator = a - gamma
  if (denominator === 0) return null
  return (b * gamma) / denominator
}

export function feelsLikeC(temperatureC: number, humidityPct: number): number {
  if (temperatureC >= 27) return heatIndexC(temperatureC, humidityPct)
  const vapor = (humidityPct / 100) * 6.105 * Math.exp((17.27 * temperatureC) / (237.7 + temperatureC))
  return temperatureC + 0.33 * vapor - 4
}

function heatIndexC(temperatureC: number, humidityPct: number): number {
  const t = (temperatureC * 9) / 5 + 32
  const rh = humidityPct
  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * rh -
    0.22475541 * t * rh -
    0.00683783 * t * t -
    0.05481717 * rh * rh +
    0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh -
    0.00000199 * t * t * rh * rh
  if (rh < 13 && t >= 80 && t <= 112) {
    hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17)
  } else if (rh > 85 && t >= 80 && t <= 87) {
    hi += ((rh - 85) / 10) * ((87 - t) / 5)
  }
  return ((hi - 32) * 5) / 9
}

export function frostAssessment(temperatureC: number, humidityPct: number, dewC: number): FrostAssessment {
  const spread = temperatureC - dewC
  let gel = 0
  if (temperatureC <= 0) {
    const cold = clamp((0 - temperatureC) / 10, 0, 1)
    const saturated = clamp((2 - spread) / 2, 0, 1)
    gel = cold * saturated
  }
  let verglas = 0
  if (temperatureC >= -2 && temperatureC <= 2) {
    const nearZero = 1 - Math.min(Math.abs(temperatureC), 2) / 2
    const wet = clamp((humidityPct - 85) / 15, 0, 1)
    verglas = nearZero * wet
  }
  const score = Math.round(100 * Math.max(gel, verglas))
  let kind: FrostKind = 'aucun'
  if (score >= 20) kind = verglas > gel ? 'verglas' : 'gel'
  return { score, kind }
}

export function fireScore(temperatureC: number, humidityPct: number): number {
  const angstrom = humidityPct / 20 + (27 - temperatureC) / 10
  return clamp(Math.round(((4 - angstrom) / 3) * 100), 0, 100)
}

export function smokeLikely(iaq: number | null, gasOhm: number | null, iaqBand: Band, gasBand: Band): boolean {
  const iaqLimit = iaqBand.veryHigh ?? 200
  const gasLimit = gasBand.low
  const iaqHit = iaq != null && iaq >= iaqLimit
  const gasHit = gasOhm != null && gasLimit != null && gasOhm <= gasLimit
  return iaqHit || gasHit
}

export function secondsUntilSlot(now = new Date()): number {
  const slots = [6, 12, 18]
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  for (const hour of slots) {
    const slot = hour * 3600
    if (slot > nowSec) return Math.max(60, slot - nowSec)
  }
  return Math.max(60, 24 * 3600 - nowSec + 6 * 3600)
}
