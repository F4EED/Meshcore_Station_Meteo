export type BandField = 'mean' | 'low' | 'high' | 'veryLow' | 'warnLow' | 'warnHigh' | 'veryHigh'

export type Band = Record<BandField, number | null>

export type BandId = 'temp' | 'humidity' | 'pressure' | 'gas' | 'iaq' | 'eco2' | 'frost' | 'fire'

export type Sense = 'twoSided' | 'lowerBetter'

export type Cadence = 'normal' | 'hors-plage' | 'choc'

export type Reading = {
  temperatureC: number | null
  humidityPct: number | null
  pressureHpa: number | null
  gasOhm: number | null
  iaq: number | null
  eco2Ppm: number | null
  batteryMv: number | null
  cadence: Cadence | null
  intervalS: number | null
  epoch: number | null
}

export type LiveReading = Reading & { eco2Estimated: boolean }

export const BAND_FIELDS: BandField[] = ['mean', 'low', 'high', 'veryLow', 'warnLow', 'warnHigh', 'veryHigh']

export const BAND_FIELD_LABELS: Record<BandField, string> = {
  mean: 'Repère',
  low: 'Mini',
  high: 'Maxi',
  veryLow: 'Très bas',
  warnLow: 'Alerte basse',
  warnHigh: 'Alerte haute',
  veryHigh: 'Très haut',
}

export const BAND_ORDER: BandId[] = ['temp', 'humidity', 'pressure', 'gas', 'iaq', 'eco2', 'frost', 'fire']

export const BAND_META: Record<BandId, { label: string; unit: string; sense: Sense; hint: string }> = {
  temp: { label: 'Température', unit: '°C', sense: 'twoSided', hint: 'Air' },
  humidity: { label: 'Humidité', unit: '% HR', sense: 'twoSided', hint: 'Humidité relative' },
  pressure: { label: 'Pression', unit: 'hPa', sense: 'twoSided', hint: 'Pression station' },
  gas: { label: 'Gaz', unit: 'Ω', sense: 'lowerBetter', hint: 'Résistance du BME688' },
  iaq: { label: 'IAQ', unit: 'indice', sense: 'lowerBetter', hint: 'Indice maison, pas BSEC' },
  eco2: { label: 'eCO2', unit: 'ppm', sense: 'lowerBetter', hint: 'Estimé, pas une mesure NDIR' },
  frost: { label: 'Gel / verglas', unit: '0–100', sense: 'lowerBetter', hint: 'Calculé depuis T, HR et rosée' },
  fire: { label: 'Incendie', unit: '0–100', sense: 'lowerBetter', hint: 'T haute et HR basse, pas un IFM' },
}

export function emptyReading(): Reading {
  return {
    temperatureC: null,
    humidityPct: null,
    pressureHpa: null,
    gasOhm: null,
    iaq: null,
    eco2Ppm: null,
    batteryMv: null,
    cadence: null,
    intervalS: null,
    epoch: null,
  }
}

export function withEstimatedEco2(reading: Reading): LiveReading {
  if (reading.eco2Ppm == null && reading.iaq != null) {
    return { ...reading, eco2Ppm: 400 + reading.iaq * 4, eco2Estimated: true }
  }
  return { ...reading, eco2Estimated: false }
}
