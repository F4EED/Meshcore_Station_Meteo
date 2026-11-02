import { readCString, toHex, utf8Size, writeCString } from './bytes'
import {
  APP_NAME,
  APP_TARGET_VER,
  CMD_APP_START,
  CMD_DEVICE_QUERY,
  CMD_GET_BATT,
  CMD_GET_CHANNEL,
  CMD_GET_CUSTOM_VARS,
  CMD_GET_DEFAULT_FLOOD_SCOPE,
  CMD_SET_CHANNEL,
  CMD_SET_CUSTOM_VAR,
  CMD_SET_DEFAULT_FLOOD_SCOPE,
  CMD_SET_DEVICE_TIME,
  CMD_SET_RADIO_PARAMS,
  RADIO_BW_MILLIKHZ,
  RADIO_CR,
  RADIO_FREQ_KHZ,
  RADIO_SF,
  RESP_BATT,
  RESP_CHANNEL,
  RESP_CUSTOM_VARS,
  RESP_DEVICE,
  RESP_ERR,
  RESP_FLOOD,
  RESP_SELF,
} from './codes'

export type SelfInfo = {
  advType: number
  txPower: number
  maxTxPower: number
  publicKeyHex: string
  freqMhz: number
  bwKhz: number
  sf: number
  cr: number
  name: string
}

export type DeviceInfo = {
  fwVer: number
  maxChannels: number
  build: string
  model: string
  version: string
  repeat: boolean
}

export type ChannelInfo = {
  index: number
  name: string
  secretHex: string
}

export type FloodScope = {
  name: string
  keyHex: string
}

const ADV_LABEL: Record<number, string> = {
  1: 'compagnon',
  2: 'répéteur',
  3: 'salon',
  4: 'capteur',
}

export function advertLabel(advType: number): string {
  return ADV_LABEL[advType] ?? `type ${advType}`
}

export function packetErrorMessage(frame: Uint8Array): string {
  const code = frame.length > 1 ? frame[1] : 0
  switch (code) {
    case 1:
      return 'Commande non prise en charge par le firmware'
    case 2:
      return 'Introuvable'
    case 3:
      return 'File pleine, réessayer'
    case 4:
      return 'Mauvais état'
    case 5:
      return 'Erreur de stockage'
    case 6:
      return 'Argument refusé'
    default:
      return `Erreur firmware (${code})`
  }
}

export function isError(frame: Uint8Array): boolean {
  return frame[0] === RESP_ERR
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function int8(value: number): number {
  return value > 127 ? value - 256 : value
}

export function encodeAppStart(): Uint8Array {
  const name = new TextEncoder().encode(APP_NAME)
  const buf = new Uint8Array(8 + name.length)
  buf[0] = CMD_APP_START
  buf.set(name, 8)
  return buf
}

export function encodeDeviceQuery(version = APP_TARGET_VER): Uint8Array {
  return Uint8Array.of(CMD_DEVICE_QUERY, version)
}

export function encodeSetTime(unixSeconds: number): Uint8Array {
  const buf = new Uint8Array(5)
  buf[0] = CMD_SET_DEVICE_TIME
  viewOf(buf).setUint32(1, unixSeconds >>> 0, true)
  return buf
}

export function encodeGetBattery(): Uint8Array {
  return Uint8Array.of(CMD_GET_BATT)
}

export function encodeGetChannel(index: number): Uint8Array {
  return Uint8Array.of(CMD_GET_CHANNEL, index)
}

export function encodeSetChannel(index: number, name: string, secret: Uint8Array): Uint8Array {
  const nameBytes = utf8Size(name)
  if (!name.trim() || nameBytes > 32) throw new Error('Nom de canal : 1 à 32 octets')
  if (secret.length !== 16) throw new Error('La clé de canal fait 16 octets')
  const buf = new Uint8Array(50)
  buf[0] = CMD_SET_CHANNEL
  buf[1] = index
  writeCString(buf.subarray(2, 34), name)
  buf.set(secret, 34)
  return buf
}

export function encodeGetCustomVars(): Uint8Array {
  return Uint8Array.of(CMD_GET_CUSTOM_VARS)
}

export function encodeCustomVar(name: string, value: string): Uint8Array {
  if (!name || name.includes(':') || name.includes(',') || value.includes(':') || value.includes(',')) {
    throw new Error('Variable refusée')
  }
  const text = new TextEncoder().encode(`${name}:${value}`)
  const buf = new Uint8Array(1 + text.length)
  buf[0] = CMD_SET_CUSTOM_VAR
  buf.set(text, 1)
  return buf
}

export function encodeGetFloodScope(): Uint8Array {
  return Uint8Array.of(CMD_GET_DEFAULT_FLOOD_SCOPE)
}

export function encodeFloodScope(name: string, key: Uint8Array): Uint8Array {
  const size = utf8Size(name)
  if (size < 1 || size > 30) throw new Error('Région : 1 à 30 octets')
  if (key.length !== 16) throw new Error('Clé de transport : 16 octets')
  const buf = new Uint8Array(1 + 31 + 16)
  buf[0] = CMD_SET_DEFAULT_FLOOD_SCOPE
  writeCString(buf.subarray(1, 32), name)
  buf.set(key, 32)
  return buf
}

export function encodeRadioProfile(): Uint8Array {
  const buf = new Uint8Array(12)
  const view = viewOf(buf)
  buf[0] = CMD_SET_RADIO_PARAMS
  view.setUint32(1, RADIO_FREQ_KHZ, true)
  view.setUint32(5, RADIO_BW_MILLIKHZ, true)
  buf[9] = RADIO_SF
  buf[10] = RADIO_CR
  buf[11] = 0
  return buf
}

export function parseSelfInfo(data: Uint8Array): SelfInfo | null {
  if (data.length < 58 || data[0] !== RESP_SELF) return null
  const view = viewOf(data)
  return {
    advType: data[1],
    txPower: int8(data[2]),
    maxTxPower: int8(data[3]),
    publicKeyHex: toHex(data.subarray(4, 36)),
    freqMhz: view.getUint32(48, true) / 1000,
    bwKhz: view.getUint32(52, true) / 1000,
    sf: data[56],
    cr: data[57],
    name: new TextDecoder().decode(data.subarray(58)).replace(/\0+$/g, '').trim(),
  }
}

export function parseDeviceInfo(data: Uint8Array): DeviceInfo | null {
  if (data.length < 2 || data[0] !== RESP_DEVICE) return null
  const info: DeviceInfo = {
    fwVer: data[1],
    maxChannels: data.length >= 4 ? data[3] : 8,
    build: '',
    model: '',
    version: '',
    repeat: false,
  }
  if (info.fwVer >= 3 && data.length >= 80) {
    info.maxChannels = data[3]
    info.build = readCString(data.subarray(8, 20))
    info.model = readCString(data.subarray(20, 60))
    info.version = readCString(data.subarray(60, 80))
  }
  if (data.length >= 81) info.repeat = data[80] !== 0
  return info
}

export function parseChannel(data: Uint8Array): ChannelInfo | null {
  if (data.length < 50 || data[0] !== RESP_CHANNEL) return null
  return {
    index: data[1],
    name: readCString(data.subarray(2, 34)),
    secretHex: toHex(data.subarray(34, 50)),
  }
}

export function parseBattery(data: Uint8Array): { mv: number } | null {
  if (data.length < 3 || data[0] !== RESP_BATT) return null
  return { mv: viewOf(data).getUint16(1, true) }
}

export function parseCustomVars(data: Uint8Array): Record<string, string> | null {
  if (data[0] !== RESP_CUSTOM_VARS) return null
  const text = new TextDecoder().decode(data.subarray(1))
  const out: Record<string, string> = {}
  if (!text) return out
  for (const pair of text.split(',')) {
    const cut = pair.indexOf(':')
    if (cut <= 0) continue
    out[pair.slice(0, cut)] = pair.slice(cut + 1)
  }
  return out
}

export function parseFloodScope(data: Uint8Array): FloodScope | null {
  if (data[0] !== RESP_FLOOD) return null
  if (data.length < 48) return { name: '', keyHex: '' }
  return {
    name: readCString(data.subarray(1, 32)),
    keyHex: toHex(data.subarray(32, 48)),
  }
}
