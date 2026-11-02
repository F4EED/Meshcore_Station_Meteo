import { writeCString } from '../protocol/bytes'
import {
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
  CMD_STATION_GET_BAND,
  CMD_STATION_GET_READING,
  CMD_STATION_SET_BAND,
  CMD_TELEMETRY,
  ERR_ILLEGAL,
  ERR_NOT_FOUND,
  ERR_UNSUPPORTED,
  MIN_UNIX,
  PUSH_TELEM,
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
  RESP_OK,
  RESP_SELF,
} from '../protocol/codes'
import { encodeReadingLpp } from '../protocol/lpp'
import { decodeBand, encodeBandResponse, encodeReading } from '../protocol/station'
import { BAND_ORDER, type Cadence, type Reading, emptyReading } from '../model'
import { bandsToList, cloneBandSet, type BandSet } from '../weather/factory'
import { secondsUntilSlot } from '../weather/derived'

type Slot = { name: string; secret: Uint8Array }

function error(code: number): Uint8Array {
  return Uint8Array.of(RESP_ERR, code)
}

function ok(): Uint8Array {
  return Uint8Array.of(RESP_OK)
}

function emptySlot(): Slot {
  return { name: '', secret: new Uint8Array(16) }
}

export class StationFirmwareSim {
  stationExtension = true
  bands: BandSet = cloneBandSet()
  channels: Slot[] = Array.from({ length: 8 }, emptySlot)
  region = ''
  floodName = ''
  floodKey = new Uint8Array(16)
  hasFlood = false
  freqMhz = RADIO_FREQ_KHZ / 1000
  bwKhz = RADIO_BW_MILLIKHZ / 1000
  sf = RADIO_SF
  cr = RADIO_CR
  repeat = false
  name = 'Station meteo'
  batteryMv = 3920
  fixedReading: Reading | null = null
  maxChannels = 8
  private polls = 0

  handle(frame: Uint8Array): Uint8Array {
    const cmd = frame[0]
    switch (cmd) {
      case CMD_APP_START:
        return this.selfInfo()
      case CMD_DEVICE_QUERY:
        return frame.length >= 2 ? this.deviceInfo() : error(ERR_ILLEGAL)
      case CMD_SET_DEVICE_TIME:
        return this.setTime(frame)
      case CMD_GET_BATT:
        return this.battery()
      case CMD_GET_CHANNEL:
        return this.getChannel(frame[1] ?? 255)
      case CMD_SET_CHANNEL:
        return this.setChannel(frame)
      case CMD_GET_CUSTOM_VARS:
        return this.customVars()
      case CMD_SET_CUSTOM_VAR:
        return this.setCustom(frame)
      case CMD_GET_DEFAULT_FLOOD_SCOPE:
        return this.getFlood()
      case CMD_SET_DEFAULT_FLOOD_SCOPE:
        return this.setFlood(frame)
      case CMD_SET_RADIO_PARAMS:
        return this.setRadio(frame)
      case CMD_TELEMETRY:
        return frame.length === 4 ? this.telemetry() : error(ERR_NOT_FOUND)
      case CMD_STATION_GET_READING:
        return this.stationExtension ? encodeReading(this.sample()) : error(ERR_UNSUPPORTED)
      case CMD_STATION_GET_BAND:
        return this.getBand(frame)
      case CMD_STATION_SET_BAND:
        return this.setBand(frame)
      default:
        return error(ERR_UNSUPPORTED)
    }
  }

  private sample(): Reading {
    if (this.fixedReading) return { ...this.fixedReading }
    const w = this.polls
    this.polls += 1
    const temperatureC = Math.round((12 + 30 * Math.sin(w / 2)) * 10) / 10
    const humidityPct = Math.round((55 + 40 * Math.sin(w / 2.4 + 1)) * 10) / 10
    const pressureHpa = Math.round((1008 + 6 * Math.sin(w / 3)) * 10) / 10
    const gasOhm = Math.round(80_000 + 5_000 * Math.sin(w / 5))
    const iaq = Math.round(40 + 170 * (0.5 + 0.5 * Math.sin(w / 2.2)))
    const reading: Reading = {
      ...emptyReading(),
      temperatureC,
      humidityPct,
      pressureHpa,
      gasOhm,
      iaq,
      eco2Ppm: 400 + iaq * 4,
      batteryMv: 3700 + (w % 8) * 40,
      epoch: Math.floor(Date.now() / 1000),
    }
    const mode = this.classify(reading)
    return { ...reading, ...mode }
  }

  private classify(reading: Reading): { cadence: Cadence; intervalS: number } {
    const values = [reading.temperatureC, reading.humidityPct, reading.pressureHpa, reading.gasOhm, reading.iaq, reading.eco2Ppm]
    const bands = bandsToList(this.bands).slice(0, 6)
    const outside = values.some((value, index) => {
      if (value == null) return false
      const band = bands[index]
      if (band.low != null && value < band.low) return true
      if (band.high != null && value > band.high) return true
      return false
    })
    if (outside) return { cadence: 'hors-plage', intervalS: 3600 }
    return { cadence: 'normal', intervalS: secondsUntilSlot() }
  }

  private selfInfo(): Uint8Array {
    const name = new TextEncoder().encode(this.name)
    const buf = new Uint8Array(58 + name.length)
    const view = new DataView(buf.buffer)
    buf[0] = RESP_SELF
    buf[1] = 0x04
    buf[2] = 14
    buf[3] = 22
    buf[4] = 0xf4
    buf[5] = 0xee
    buf[6] = 0xed
    view.setUint32(48, Math.round(this.freqMhz * 1000), true)
    view.setUint32(52, Math.round(this.bwKhz * 1000), true)
    buf[56] = this.sf
    buf[57] = this.cr
    buf.set(name, 58)
    return buf
  }

  private deviceInfo(): Uint8Array {
    const buf = new Uint8Array(82)
    buf[0] = RESP_DEVICE
    buf[1] = 11
    buf[3] = this.maxChannels
    writeCString(buf.subarray(8, 20), 'sim')
    writeCString(buf.subarray(20, 60), 'Wio Tracker L1 Pro')
    writeCString(buf.subarray(60, 80), 'station-sim')
    buf[80] = this.repeat ? 1 : 0
    buf[81] = 1
    return buf
  }

  private battery(): Uint8Array {
    const buf = new Uint8Array(11)
    const view = new DataView(buf.buffer)
    buf[0] = RESP_BATT
    view.setUint16(1, this.batteryMv, true)
    view.setUint32(3, 12, true)
    view.setUint32(7, 64, true)
    return buf
  }

  private setTime(frame: Uint8Array): Uint8Array {
    if (frame.length < 5) return error(ERR_ILLEGAL)
    const stamp = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1, true)
    if (stamp < MIN_UNIX) return error(ERR_ILLEGAL)
    return ok()
  }

  private getChannel(index: number): Uint8Array {
    if (index >= this.maxChannels) return error(ERR_NOT_FOUND)
    const slot = this.channels[index] ?? emptySlot()
    const buf = new Uint8Array(50)
    buf[0] = RESP_CHANNEL
    buf[1] = index
    writeCString(buf.subarray(2, 34), slot.name)
    buf.set(slot.secret, 34)
    return buf
  }

  private setChannel(frame: Uint8Array): Uint8Array {
    if (frame.length < 50) return error(ERR_ILLEGAL)
    const index = frame[1]
    if (index >= this.maxChannels) return error(ERR_NOT_FOUND)
    const secret = frame.subarray(34, 50)
    if (secret.every((b) => b === 0)) return error(ERR_ILLEGAL)
    const slot = emptySlot()
    slot.name = new TextDecoder().decode(frame.subarray(2, 34)).replace(/\0+$/g, '').trim()
    slot.secret = Uint8Array.from(secret)
    this.channels[index] = slot
    return ok()
  }

  private customVars(): Uint8Array {
    if (!this.region) return Uint8Array.of(RESP_CUSTOM_VARS)
    const text = new TextEncoder().encode(`region:${this.region}`)
    const buf = new Uint8Array(1 + text.length)
    buf[0] = RESP_CUSTOM_VARS
    buf.set(text, 1)
    return buf
  }

  private setCustom(frame: Uint8Array): Uint8Array {
    const text = new TextDecoder().decode(frame.subarray(1))
    const cut = text.indexOf(':')
    if (cut <= 0) return error(ERR_ILLEGAL)
    const name = text.slice(0, cut)
    const value = text.slice(cut + 1)
    if (name !== 'region' || !value || value.length > 30) return error(ERR_ILLEGAL)
    this.region = value
    return ok()
  }

  private getFlood(): Uint8Array {
    if (!this.hasFlood) return Uint8Array.of(RESP_FLOOD)
    const buf = new Uint8Array(48)
    buf[0] = RESP_FLOOD
    writeCString(buf.subarray(1, 32), this.floodName)
    buf.set(this.floodKey, 32)
    return buf
  }

  private setFlood(frame: Uint8Array): Uint8Array {
    if (frame.length === 1) {
      this.hasFlood = false
      this.floodName = ''
      this.floodKey = new Uint8Array(16)
      return ok()
    }
    if (frame.length < 48) return error(ERR_ILLEGAL)
    const name = new TextDecoder().decode(frame.subarray(1, 32)).replace(/\0+$/g, '').trim()
    if (!name || name.length > 30) return error(ERR_ILLEGAL)
    this.floodName = name
    this.floodKey = Uint8Array.from(frame.subarray(32, 48))
    this.hasFlood = true
    return ok()
  }

  private setRadio(frame: Uint8Array): Uint8Array {
    if (frame.length < 11) return error(ERR_ILLEGAL)
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    const freq = view.getUint32(1, true)
    const bw = view.getUint32(5, true)
    const sf = frame[9]
    const cr = frame[10]
    const repeat = frame.length > 11 ? frame[11] : 0
    if (freq < 150_000 || freq > 2_500_000 || bw < 7_000 || bw > 500_000 || sf < 5 || sf > 12 || cr < 5 || cr > 8) {
      return error(ERR_ILLEGAL)
    }
    this.freqMhz = freq / 1000
    this.bwKhz = bw / 1000
    this.sf = sf
    this.cr = cr
    this.repeat = repeat !== 0
    return ok()
  }

  private telemetry(): Uint8Array {
    const lpp = encodeReadingLpp(this.sample())
    const buf = new Uint8Array(8 + lpp.length)
    buf[0] = PUSH_TELEM
    buf.set(lpp, 8)
    return buf
  }

  private getBand(frame: Uint8Array): Uint8Array {
    if (!this.stationExtension) return error(ERR_UNSUPPORTED)
    if (frame.length < 2 || frame[1] > 7) return error(ERR_ILLEGAL)
    const id = BAND_ORDER[frame[1]]
    return encodeBandResponse(frame[1], this.bands[id])
  }

  private setBand(frame: Uint8Array): Uint8Array {
    if (!this.stationExtension) return error(ERR_UNSUPPORTED)
    const decoded = decodeBand(Uint8Array.of(0x71, ...frame.subarray(1)))
    if (!decoded || decoded.id > 7) return error(ERR_ILLEGAL)
    const id = BAND_ORDER[decoded.id]
    this.bands[id] = decoded.band
    return ok()
  }
}
