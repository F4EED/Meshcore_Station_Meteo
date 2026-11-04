import type { Reading } from '../model'
import { emptyReading } from '../model'
import { dewPointC, feelsLikeC, fireScore, frostAssessment, smokeIndex } from '../weather/derived'

const LPP_SIZE: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  100: 4,
  101: 2,
  102: 1,
  103: 2,
  104: 1,
  113: 6,
  115: 2,
  116: 2,
  117: 2,
  118: 4,
  120: 1,
  121: 2,
  125: 2,
  128: 2,
  130: 4,
  132: 2,
  133: 4,
  134: 6,
  135: 3,
  136: 9,
  142: 1,
}

export const LPP_TEMP = 103
export const LPP_HUMIDITY = 104
export const LPP_PRESSURE = 115
export const LPP_VOLTAGE = 116
export const LPP_GENERIC = 100
export const LPP_CONCENTRATION = 125

export type LppRecord = { channel: number; type: number; value: number }

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function decodeLpp(buf: Uint8Array, humidityBytes = 1): LppRecord[] {
  const out: LppRecord[] = []
  const view = viewOf(buf)
  let i = 0
  while (i + 2 <= buf.length) {
    const channel = buf[i]
    const type = buf[i + 1]
    const size = type === LPP_HUMIDITY ? humidityBytes : LPP_SIZE[type]
    if (size == null) {
      i += 1
      continue
    }
    if (i + 2 + size > buf.length) break
    const p = i + 2
    let value = Number.NaN
    switch (type) {
      case LPP_TEMP:
        value = view.getInt16(p, false) / 10
        break
      case LPP_HUMIDITY:
        value = (humidityBytes === 2 ? view.getUint16(p, false) : buf[p]) / 2
        break
      case LPP_PRESSURE:
        value = view.getUint16(p, false) / 10
        break
      case LPP_VOLTAGE:
        value = view.getUint16(p, false) / 100
        break
      case LPP_GENERIC:
        value = view.getUint32(p, false)
        break
      case 2:
        value = view.getInt16(p, false) / 100
        break
      case LPP_CONCENTRATION:
        value = view.getUint16(p, false)
        break
      case 120:
        value = buf[p]
        break
      case 121:
        value = view.getInt16(p, false)
        break
      default:
        break
    }
    if (Number.isFinite(value)) out.push({ channel, type, value })
    i += 2 + size
  }
  return out
}

export function readingsFromLpp(records: LppRecord[]): Partial<Reading> {
  const reading: Partial<Reading> = {}
  const temps = records.filter((r) => r.type === LPP_TEMP)
  const air = temps.find((r) => r.channel !== 1 && r.channel !== 7 && r.channel !== 8)
  if (air) reading.temperatureC = air.value
  const dew = temps.find((r) => r.channel === 7)
  const feels = temps.find((r) => r.channel === 8)
  if (dew) reading.dewPointC = dew.value
  if (feels) reading.feelsLikeC = feels.value

  const humidities = records.filter((r) => r.type === LPP_HUMIDITY)
  const humidity = humidities.find((r) => air != null && r.channel === air.channel) ?? humidities[0]
  if (humidity) reading.humidityPct = humidity.value

  const pressures = records.filter((r) => r.type === LPP_PRESSURE)
  const pressure = pressures.find((r) => air != null && r.channel === air.channel) ?? pressures[0]
  if (pressure) reading.pressureHpa = pressure.value

  const airChannel = air?.channel ?? humidity?.channel ?? pressure?.channel ?? null
  const generics = records.filter((r) => r.type === LPP_GENERIC)
  const gas = airChannel == null ? undefined : generics.find((r) => r.channel === airChannel)
  if (gas) reading.gasOhm = gas.value
  const iaq = generics.find((r) => r.channel === 3) ?? generics.find((r) => r !== gas)
  if (iaq && iaq !== gas) reading.iaq = iaq.value

  const co2 = records.find((r) => r.type === LPP_CONCENTRATION && (airChannel == null || r.channel === airChannel)) ?? records.find((r) => r.type === LPP_CONCENTRATION)
  if (co2) reading.eco2Ppm = co2.value

  const percent = (channel: number) => records.find((r) => r.type === 120 && r.channel === channel)
  const frost = percent(4)
  const fire = percent(5)
  const smoke = percent(6)
  if (frost) reading.frostScore = frost.value
  if (fire) reading.fireScore = fire.value
  if (smoke) reading.smokeScore = smoke.value

  const volts = records.filter((r) => r.type === LPP_VOLTAGE)
  const voltage = volts.find((r) => r.channel === 1) ?? volts[0]
  if (voltage) reading.batteryMv = Math.round(voltage.value * 1000)
  return reading
}

function lppScore(reading: Partial<Reading>): number {
  let score = 0
  if (reading.temperatureC != null) score += 1
  if (reading.humidityPct != null && reading.humidityPct > 0 && reading.humidityPct <= 100) score += 2
  if (reading.pressureHpa != null && reading.pressureHpa >= 800 && reading.pressureHpa <= 1100) score += 2
  if (reading.gasOhm != null && reading.gasOhm > 100) score += 2
  if (reading.iaq != null) score += 1
  if (reading.eco2Ppm != null) score += 1
  if (reading.batteryMv != null && reading.batteryMv >= 2000 && reading.batteryMv <= 5000) score += 1
  return score
}

export function readingsFromLppBuffer(buf: Uint8Array): Partial<Reading> {
  const one = readingsFromLpp(decodeLpp(buf, 1))
  const two = readingsFromLpp(decodeLpp(buf, 2))
  return lppScore(two) > lppScore(one) ? two : one
}

export function lppBufferScore(buf: Uint8Array): number {
  return lppScore(readingsFromLppBuffer(buf))
}

function i16(value: number): [number, number] {
  const raw = value < 0 ? value + 65536 : value
  return [(raw >> 8) & 0xff, raw & 0xff]
}

function u16(value: number): [number, number] {
  return [(value >> 8) & 0xff, value & 0xff]
}

function i32(value: number): number[] {
  const raw = value < 0 ? value + 2 ** 32 : value
  return [(raw >>> 24) & 0xff, (raw >>> 16) & 0xff, (raw >>> 8) & 0xff, raw & 0xff]
}

function pushTemp(bytes: number[], channel: number, celsius: number): void {
  bytes.push(channel, LPP_TEMP, ...i16(Math.round(celsius * 10)))
}

function pushPercent(bytes: number[], channel: number, score: number): void {
  bytes.push(channel, 120, Math.max(0, Math.min(100, Math.round(score))))
}

export function encodeReadingLpp(reading: Reading): Uint8Array {
  const bytes: number[] = []
  const temp = reading.temperatureC
  const hr = reading.humidityPct
  const dew = reading.dewPointC ?? (temp != null && hr != null ? dewPointC(temp, hr) : null)
  const feels = reading.feelsLikeC ?? (temp != null && hr != null ? feelsLikeC(temp, hr) : null)
  const frost = reading.frostScore ?? (temp != null && hr != null && dew != null ? frostAssessment(temp, hr, dew).score : null)
  const fire = reading.fireScore ?? (temp != null && hr != null ? fireScore(temp, hr) : null)
  const smoke = reading.smokeScore ?? (reading.iaq != null ? smokeIndex(reading.iaq) : null)
  if (reading.batteryMv != null) {
    bytes.push(1, LPP_VOLTAGE, ...u16(Math.round(reading.batteryMv / 10)))
  }
  if (temp != null) pushTemp(bytes, 2, temp)
  if (hr != null) {
    bytes.push(2, LPP_HUMIDITY, Math.max(0, Math.min(255, Math.round(hr * 2))))
  }
  if (reading.pressureHpa != null) {
    bytes.push(2, LPP_PRESSURE, ...u16(Math.round(reading.pressureHpa * 10)))
  }
  if (reading.gasOhm != null) {
    bytes.push(2, LPP_GENERIC, ...i32(Math.round(reading.gasOhm)))
  }
  if (reading.eco2Ppm != null) {
    bytes.push(2, LPP_CONCENTRATION, ...u16(Math.round(reading.eco2Ppm)))
  }
  if (reading.iaq != null) {
    bytes.push(3, LPP_GENERIC, ...i32(Math.round(reading.iaq)))
  }
  if (frost != null) pushPercent(bytes, 4, frost)
  if (fire != null) pushPercent(bytes, 5, fire)
  if (smoke != null) pushPercent(bytes, 6, smoke)
  if (dew != null) pushTemp(bytes, 7, dew)
  if (feels != null) pushTemp(bytes, 8, feels)
  return Uint8Array.from(bytes)
}

export function readingFromTelemetryFrame(frame: Uint8Array): Reading {
  const partial = readingsFromLppBuffer(frame.subarray(8))
  return { ...emptyReading(), ...partial }
}
