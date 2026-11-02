import type { Band, Sense } from '../model'

export type Level = 'ok' | 'warn' | 'alert' | 'absent' | 'none'

export function metricLevel(value: number | null, band: Band, sense: Sense): Level {
  if (value == null || Number.isNaN(value)) return 'absent'
  const highAlert = band.veryHigh != null && value >= band.veryHigh
  const lowAlert = sense === 'twoSided' && band.veryLow != null && value <= band.veryLow
  if (highAlert || lowAlert) return 'alert'
  const highWarn =
    (band.warnHigh != null && value >= band.warnHigh) ||
    (band.warnHigh == null && band.high != null && value > band.high)
  const lowWarn =
    sense === 'twoSided' &&
    ((band.warnLow != null && value <= band.warnLow) || (band.warnLow == null && band.low != null && value < band.low))
  if (highWarn || lowWarn) return 'warn'
  return 'ok'
}

export const LEVEL_LABEL: Record<Level, string> = {
  ok: 'dans la bande',
  warn: 'un peu décalé',
  alert: 'très décalé',
  absent: 'absent',
  none: 'mesure',
}
