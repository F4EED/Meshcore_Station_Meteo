import { BAND_FIELDS, type Band, type Cadence, type Reading } from '../model'
import { CMD_STATION_GET_BAND, CMD_STATION_GET_READING, CMD_STATION_SET_BAND, MIN_UNIX, RESP_STATION_BAND, RESP_STATION_READING } from './codes'

const F_TEMP = 1 << 0
const F_HR = 1 << 1
const F_P = 1 << 2
const F_GAS = 1 << 3
const F_IAQ = 1 << 4
const F_ECO2 = 1 << 5
const F_BATT = 1 << 6
const F_CADENCE = 1 << 7
const NAN_BITS = 0x7fc00000

const CADENCE_CODE: Record<Cadence, number> = { normal: 0, 'hors-plage': 1, choc: 2 }

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function writeFloat(view: DataView, offset: number, value: number | null): void {
  if (value == null) view.setUint32(offset, NAN_BITS, true)
  else view.setFloat32(offset, value, true)
}

function readFloat(view: DataView, offset: number): number | null {
  const value = view.getFloat32(offset, true)
  return Number.isNaN(value) ? null : value
}

export function writeBandFloats(buf: Uint8Array, offset: number, band: Band): void {
  const view = viewOf(buf)
  BAND_FIELDS.forEach((field, index) => writeFloat(view, offset + index * 4, band[field]))
}

export function readBandFloats(buf: Uint8Array, offset: number): Band {
  const view = viewOf(buf)
  const band = {} as Band
  BAND_FIELDS.forEach((field, index) => {
    band[field] = readFloat(view, offset + index * 4)
  })
  return band
}

export function encodeGetReading(): Uint8Array {
  return Uint8Array.of(CMD_STATION_GET_READING)
}

export function encodeGetBand(id: number): Uint8Array {
  return Uint8Array.of(CMD_STATION_GET_BAND, id)
}

export function encodeSetBand(id: number, band: Band): Uint8Array {
  const buf = new Uint8Array(30)
  buf[0] = CMD_STATION_SET_BAND
  buf[1] = id
  writeBandFloats(buf, 2, band)
  return buf
}

export function encodeBandResponse(id: number, band: Band): Uint8Array {
  const buf = new Uint8Array(30)
  buf[0] = RESP_STATION_BAND
  buf[1] = id
  writeBandFloats(buf, 2, band)
  return buf
}

export function decodeBand(frame: Uint8Array): { id: number; band: Band } | null {
  if (frame.length < 30 || frame[0] !== RESP_STATION_BAND) return null
  return { id: frame[1], band: readBandFloats(frame, 2) }
}

function cadenceOf(code: number): Cadence | null {
  if (code === 0) return 'normal'
  if (code === 1) return 'hors-plage'
  if (code === 2) return 'choc'
  return null
}

export function encodeReading(reading: Reading): Uint8Array {
  const buf = new Uint8Array(37)
  const view = viewOf(buf)
  buf[0] = RESP_STATION_READING
  buf[1] = 1
  let flags = 0
  if (reading.temperatureC != null) flags |= F_TEMP
  if (reading.humidityPct != null) flags |= F_HR
  if (reading.pressureHpa != null) flags |= F_P
  if (reading.gasOhm != null) flags |= F_GAS
  if (reading.iaq != null) flags |= F_IAQ
  if (reading.eco2Ppm != null) flags |= F_ECO2
  if (reading.batteryMv != null) flags |= F_BATT
  if (reading.cadence != null) flags |= F_CADENCE
  view.setUint16(2, flags, true)
  writeFloat(view, 4, reading.temperatureC)
  writeFloat(view, 8, reading.humidityPct)
  writeFloat(view, 12, reading.pressureHpa)
  writeFloat(view, 16, reading.gasOhm)
  writeFloat(view, 20, reading.iaq)
  writeFloat(view, 24, reading.eco2Ppm)
  view.setUint16(28, reading.batteryMv ?? 0, true)
  buf[30] = reading.cadence ? CADENCE_CODE[reading.cadence] : 0xff
  view.setUint16(31, reading.intervalS ?? 0, true)
  view.setUint32(33, reading.epoch ?? 0, true)
  return buf
}

export function decodeReading(frame: Uint8Array): Reading {
  if (frame.length < 37 || frame[0] !== RESP_STATION_READING) throw new Error('Trame station illisible')
  if (frame[1] !== 1) throw new Error('Version de trame station inconnue')
  const view = viewOf(frame)
  const flags = view.getUint16(2, true)
  const epoch = view.getUint32(33, true)
  return {
    temperatureC: flags & F_TEMP ? readFloat(view, 4) : null,
    humidityPct: flags & F_HR ? readFloat(view, 8) : null,
    pressureHpa: flags & F_P ? readFloat(view, 12) : null,
    gasOhm: flags & F_GAS ? readFloat(view, 16) : null,
    iaq: flags & F_IAQ ? readFloat(view, 20) : null,
    eco2Ppm: flags & F_ECO2 ? readFloat(view, 24) : null,
    batteryMv: flags & F_BATT ? view.getUint16(28, true) : null,
    cadence: flags & F_CADENCE ? cadenceOf(frame[30]) : null,
    intervalS: flags & F_CADENCE ? view.getUint16(31, true) : null,
    epoch: epoch >= MIN_UNIX ? epoch : null,
  }
}
