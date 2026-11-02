import type { Reading } from '../model'
import { emptyReading } from '../model'

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
  120: 1,
  121: 2,
  125: 2,
  136: 9,
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

export function decodeLpp(buf: Uint8Array): LppRecord[] {
  const out: LppRecord[] = []
  const view = viewOf(buf)
  let i = 0
  while (i + 2 <= buf.length) {
    const channel = buf[i]
    const type = buf[i + 1]
    const size = LPP_SIZE[type]
    if (size == null || i + 2 + size > buf.length) break
    const p = i + 2
    let value = Number.NaN
    switch (type) {
      case LPP_TEMP:
        value = view.getInt16(p, false) / 10
        break
      case LPP_HUMIDITY:
        value = buf[p] / 2
        break
      case LPP_PRESSURE:
        value = view.getUint16(p, false) / 10
        break
      case LPP_VOLTAGE:
        value = view.getUint16(p, false) / 100
        break
      case LPP_GENERIC:
      case 2:
        value = (type === 2 ? view.getInt16(p, false) : view.getInt32(p, false)) / 100
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
    out.push({ channel, type, value })
    i += 2 + size
  }
  return out
}

export function readingsFromLpp(records: LppRecord[]): Partial<Reading> {
  const by = new Map<number, LppRecord[]>()
  for (const record of records) {
    const list = by.get(record.channel) ?? []
    list.push(record)
    by.set(record.channel, list)
  }
  let envChannel: number | null = null
  for (const [channel, list] of by) {
    if (list.some((r) => r.type === LPP_TEMP) && list.some((r) => r.type === LPP_HUMIDITY)) {
      envChannel = channel
      break
    }
  }
  const reading: Partial<Reading> = {}
  if (envChannel != null) {
    const list = by.get(envChannel) ?? []
    const temp = list.find((r) => r.type === LPP_TEMP)
    const humidity = list.find((r) => r.type === LPP_HUMIDITY)
    const pressure = list.find((r) => r.type === LPP_PRESSURE)
    const gas = list.find((r) => r.type === LPP_GENERIC)
    if (temp) reading.temperatureC = temp.value
    if (humidity) reading.humidityPct = humidity.value
    if (pressure) reading.pressureHpa = pressure.value
    if (gas) reading.gasOhm = gas.value
  } else {
    const temps = records.filter((r) => r.type === LPP_TEMP && r.channel !== 1)
    const temp = temps[0] ?? records.find((r) => r.type === LPP_TEMP)
    if (temp) reading.temperatureC = temp.value
  }
  const volts = records.filter((r) => r.type === LPP_VOLTAGE)
  const voltage = volts.find((r) => r.channel === 1) ?? volts[0]
  if (voltage) reading.batteryMv = Math.round(voltage.value * 1000)
  for (const record of records) {
    if (record.type === LPP_GENERIC && record.channel !== envChannel && record.value >= 0 && record.value <= 500) {
      reading.iaq = record.value
    }
  }
  const co2 = records.find((r) => r.type === LPP_CONCENTRATION)
  if (co2) reading.eco2Ppm = co2.value
  return reading
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

export function encodeReadingLpp(reading: Reading): Uint8Array {
  const bytes: number[] = []
  if (reading.batteryMv != null) {
    bytes.push(1, LPP_VOLTAGE, ...u16(Math.round(reading.batteryMv / 10)))
  }
  if (reading.temperatureC != null) {
    bytes.push(2, LPP_TEMP, ...i16(Math.round(reading.temperatureC * 10)))
  }
  if (reading.humidityPct != null) {
    bytes.push(2, LPP_HUMIDITY, Math.max(0, Math.min(255, Math.round(reading.humidityPct * 2))))
  }
  if (reading.pressureHpa != null) {
    bytes.push(2, LPP_PRESSURE, ...u16(Math.round(reading.pressureHpa * 10)))
  }
  if (reading.gasOhm != null) {
    bytes.push(2, LPP_GENERIC, ...i32(Math.round(reading.gasOhm * 100)))
  }
  if (reading.iaq != null) {
    bytes.push(3, LPP_GENERIC, ...i32(Math.round(reading.iaq * 100)))
  }
  if (reading.eco2Ppm != null) {
    bytes.push(3, LPP_CONCENTRATION, ...u16(Math.round(reading.eco2Ppm)))
  }
  return Uint8Array.from(bytes)
}

export function readingFromTelemetryFrame(frame: Uint8Array): Reading {
  const partial = readingsFromLpp(decodeLpp(frame.subarray(8)))
  return { ...emptyReading(), ...partial }
}
