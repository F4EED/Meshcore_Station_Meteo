import type { Reading } from '../model'
import { emptyReading } from '../model'
import { RESP_CHANNEL_DATA, RESP_CHANNEL_MSG, RESP_CHANNEL_MSG_V3, STMET_DATA_TYPE } from './codes'
import { decodeLpp, readingsFromLpp } from './lpp'

export type ChannelData = {
  channelIdx: number
  dataType: number
  payload: Uint8Array
}

export type ChannelText = {
  channelIdx: number
  message: string
}

type MetricKey =
  | 'temperatureC'
  | 'humidityPct'
  | 'pressureHpa'
  | 'dewPointC'
  | 'feelsLikeC'
  | 'frostScore'
  | 'fireScore'
  | 'smokeScore'

const LABEL: Record<string, MetricKey> = {
  t: 'temperatureC',
  hr: 'humidityPct',
  p: 'pressureHpa',
  rosée: 'dewPointC',
  rosee: 'dewPointC',
  ressenti: 'feelsLikeC',
  gel: 'frostScore',
  feu: 'fireScore',
  fumée: 'smokeScore',
  fumee: 'smokeScore',
}

export function encodeChannelDataFrame(channelIdx: number, dataType: number, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(9 + payload.length)
  buf[0] = RESP_CHANNEL_DATA
  buf[4] = channelIdx
  buf[5] = 0xff
  buf[6] = dataType & 0xff
  buf[7] = (dataType >> 8) & 0xff
  buf[8] = Math.min(255, payload.length)
  buf.set(payload.subarray(0, buf[8]), 9)
  return buf
}

export function encodeChannelTextFrame(channelIdx: number, message: string): Uint8Array {
  const body = new TextEncoder().encode(message)
  const buf = new Uint8Array(11 + body.length)
  buf[0] = RESP_CHANNEL_MSG_V3
  buf[4] = channelIdx
  buf[5] = 0xff
  buf.set(body, 11)
  return buf
}

export function parseChannelData(frame: Uint8Array): ChannelData | null {
  if (frame[0] !== RESP_CHANNEL_DATA || frame.length < 9) return null
  const dataLen = frame[8]
  const payload = frame.subarray(9, Math.min(frame.length, 9 + dataLen))
  return {
    channelIdx: frame[4],
    dataType: frame[6] | (frame[7] << 8),
    payload,
  }
}

export function parseChannelText(frame: Uint8Array): ChannelText | null {
  const code = frame[0]
  const offset = code === RESP_CHANNEL_MSG_V3 ? 11 : code === RESP_CHANNEL_MSG ? 8 : -1
  if (offset < 0 || frame.length < offset) return null
  const channelIdx = code === RESP_CHANNEL_MSG_V3 ? frame[4] : frame[1]
  const message = new TextDecoder().decode(frame.subarray(offset)).replace(/\0+$/g, '').trim()
  if (!message) return null
  return { channelIdx, message }
}

export function hasStationAir(reading: Reading): boolean {
  return reading.temperatureC != null || reading.humidityPct != null || reading.pressureHpa != null || reading.dewPointC != null
}

function splitSender(text: string): { sender: string; body: string } {
  const cut = text.indexOf(': ')
  if (cut > 0 && cut <= 40 && !text.slice(0, cut).includes(' ')) {
    return { sender: text.slice(0, cut).trim(), body: text.slice(cut + 2).trim() }
  }
  return { sender: '', body: text.trim() }
}

export function parseMeteoLine(raw: string): Reading | null {
  const { sender, body } = splitSender(raw.replace(/\0/g, ''))
  if (!body || /^mto_now$/i.test(body)) return null
  const reading = emptyReading()
  const field = /(^|[^0-9A-Za-z_À-ÿ])(ressenti|rosée|rosee|fumée|fumee|gel|feu|HR|T|P)\s+(-?\d+(?:[.,]\d+)?)/gi
  let count = 0
  for (const match of body.matchAll(field)) {
    const key = LABEL[match[2].toLowerCase()]
    if (!key) continue
    const value = Number(match[3].replace(',', '.'))
    if (!Number.isFinite(value)) continue
    reading[key] = value
    count += 1
  }
  const fromStation = /f4eed|meteo/i.test(sender)
  if (count === 0 || (!fromStation && count < 3) || !hasStationAir(reading)) return null
  return reading
}

export function readingFromCompanionFrame(frame: Uint8Array): { reading: Reading; source: 'radio' | 'texte' } | null {
  if (frame[0] === RESP_CHANNEL_DATA) {
    const data = parseChannelData(frame)
    if (!data || data.dataType !== STMET_DATA_TYPE) return null
    const reading = { ...emptyReading(), ...readingsFromLpp(decodeLpp(data.payload)) }
    if (!hasStationAir(reading)) return null
    return { reading, source: 'radio' }
  }
  const text = parseChannelText(frame)
  if (!text) return null
  const reading = parseMeteoLine(text.message)
  if (!reading) return null
  return { reading, source: 'texte' }
}
