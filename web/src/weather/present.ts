import { BAND_META, BAND_ORDER, type BandId, type LiveReading } from '../model'
import { FACTORY_BANDS, type BandSet } from './factory'
import { dewPointC, feelsLikeC, fireScore, frostAssessment, smokeIndex, smokeLikely } from './derived'
import { LEVEL_LABEL, metricLevel, type Level } from './levels'

export type MetricCard = {
  id: string
  label: string
  value: string
  unit: string
  level: Level
  levelLabel: string
  note?: string
}

export type PresentedWeather = {
  hero: MetricCard
  cards: MetricCard[]
  frost: MetricCard
  fire: MetricCard
  smoke: MetricCard
  smokeAlert: boolean
  cadenceLabel: string | null
  intervalLabel: string | null
}

const nf = (digits: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function num(value: number | null, digits: number): string {
  if (value == null || Number.isNaN(value)) return '—'
  return nf(digits).format(value)
}

export function formatInterval(seconds: number): string {
  if (seconds < 90) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function formatAge(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000))
  if (seconds < 5) return 'à l’instant'
  if (seconds < 60) return `il y a ${seconds} s`
  const minutes = Math.round(seconds / 60)
  return `il y a ${minutes} min`
}

function card(id: string, label: string, value: string, unit: string, level: Level, note?: string): MetricCard {
  return { id, label, value, unit, level, levelLabel: LEVEL_LABEL[level], note }
}

export function presentWeather(reading: LiveReading, bands: BandSet): PresentedWeather {
  const temp = reading.temperatureC
  const hr = reading.humidityPct
  const dew = reading.dewPointC ?? (temp != null && hr != null ? dewPointC(temp, hr) : null)
  const feels = reading.feelsLikeC ?? (temp != null && hr != null ? feelsLikeC(temp, hr) : null)
  const frost = temp != null && hr != null && dew != null ? frostAssessment(temp, hr, dew) : null
  const frostScore = reading.frostScore ?? frost?.score ?? null
  const fire = reading.fireScore ?? (temp != null && hr != null ? fireScore(temp, hr) : null)
  const smokeScore = reading.smokeScore ?? (reading.iaq != null ? smokeIndex(reading.iaq) : null)
  const tempLevel = metricLevel(temp, bands.temp, 'twoSided')
  const frostLevel = metricLevel(frostScore, bands.frost, 'lowerBetter')
  const fireLevel = metricLevel(fire, bands.fire, 'lowerBetter')
  const fireWord = fireLevel === 'alert' ? 'fort' : fireLevel === 'warn' ? 'élevé' : fire == null ? 'absent' : 'faible'
  const frostWord = frost?.kind === 'gel' ? 'gel' : frost?.kind === 'verglas' ? 'verglas' : 'aucun'

  return {
    hero: card('temp', 'Température', num(temp, 1), '°C', tempLevel),
    cards: [
      card('humidity', 'Humidité', num(hr, 0), '% HR', metricLevel(hr, bands.humidity, 'twoSided')),
      card('pressure', 'Pression', num(reading.pressureHpa, 1), 'hPa', metricLevel(reading.pressureHpa, bands.pressure, 'twoSided')),
      card('dew', 'Point de rosée', num(dew, 1), '°C', 'none', reading.dewPointC != null ? 'Reçu' : 'Magnus–Tetens'),
      card('feels', 'Ressenti', num(feels, 1), '°C', 'none', reading.feelsLikeC != null ? 'Reçu' : temp != null && temp >= 27 ? 'Indice de chaleur' : 'Steadman, vent nul'),
      card('gas', 'Gaz', num(reading.gasOhm, 0), 'Ω', metricLevel(reading.gasOhm, bands.gas, 'lowerBetter')),
      card('iaq', 'IAQ', num(reading.iaq, 0), '', metricLevel(reading.iaq, bands.iaq, 'lowerBetter'), 'Indice maison'),
      card(
        'eco2',
        'eCO2',
        num(reading.eco2Ppm, 0),
        'ppm',
        metricLevel(reading.eco2Ppm, bands.eco2, 'lowerBetter'),
        reading.eco2Estimated ? 'Estimé : 400 + IAQ × 4' : 'Estimé, pas un NDIR',
      ),
      card(
        'battery',
        'Batterie',
        reading.batteryMv == null ? '—' : num(reading.batteryMv / 1000, 2),
        'V',
        'none',
        reading.batteryMv == null ? undefined : `${num(reading.batteryMv, 0)} mV`,
      ),
    ],
    frost: card('frost', 'Gel / verglas', frostScore == null ? '—' : num(frostScore, 0), '/ 100', frostLevel, reading.frostScore != null ? `${frostWord} · reçu` : frostWord),
    fire: card('fire', 'Incendie', fire == null ? '—' : num(fire, 0), '/ 100', fireLevel, reading.fireScore != null ? `${fireWord} · reçu` : `${fireWord} · pas un IFM`),
    smoke: card('smoke', 'Fumée', smokeScore == null ? '—' : num(smokeScore, 0), '/ 100', 'none', reading.smokeScore != null ? 'Reçu' : 'IAQ déjà élevé'),
    smokeAlert: (smokeScore != null && smokeScore >= 20) || smokeLikely(reading.iaq, reading.gasOhm, bands.iaq, bands.gas),
    cadenceLabel:
      reading.cadence === 'normal' ? 'Créneau calme' : reading.cadence === 'hors-plage' ? 'Hors plage' : reading.cadence === 'choc' ? 'Choc' : null,
    intervalLabel: reading.intervalS != null ? formatInterval(reading.intervalS) : null,
  }
}

export function bandLabel(id: BandId): string {
  return BAND_META[id].label
}

export const ORDER = BAND_ORDER
export const DEFAULT_BANDS = FACTORY_BANDS
