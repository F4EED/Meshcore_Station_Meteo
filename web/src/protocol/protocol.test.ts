import { describe, expect, it } from 'vitest'
import { FACTORY_CHANNEL_NAME } from './codes'
import { encodeRadioProfile, encodeSetChannel } from './companion'
import { encodeHostFrame, StreamFrameParser } from './frame'
import { decodeLpp, encodeReadingLpp, readingsFromLpp } from './lpp'
import { parseMeteoLine } from './radio'
import { decodeReading, encodeReading } from './station'
import { emptyReading } from '../model'
import { FACTORY_BANDS } from '../weather/factory'

describe('trames compagnon', () => {
  it('écrit #germacrisepublic sans clé', () => {
    const frame = encodeSetChannel(1, FACTORY_CHANNEL_NAME, new Uint8Array(16))
    expect(frame[0]).toBe(0x20)
    expect(frame[1]).toBe(1)
    expect(frame).toHaveLength(50)
    const nameField = frame.subarray(2, 34)
    const end = nameField.indexOf(0)
    expect(new TextDecoder().decode(nameField.subarray(0, end))).toBe('#germacrisepublic')
    expect(nameField.subarray(end).every((byte) => byte === 0)).toBe(true)
    expect(frame.subarray(34).every((byte) => byte === 0)).toBe(true)
  })

  it('encode le profil meshcore.fr', () => {
    const frame = encodeRadioProfile()
    const view = new DataView(frame.buffer)
    expect(frame[0]).toBe(0x0b)
    expect(view.getUint32(1, true)).toBe(869618)
    expect(view.getUint32(5, true)).toBe(62500)
    expect(frame[9]).toBe(8)
    expect(frame[10]).toBe(8)
    expect(frame[11]).toBe(0)
  })

  it('ressynchronise le flux 0x3E', () => {
    const payload = Uint8Array.of(0xaa, 0xbb)
    const host = encodeHostFrame(payload)
    const device = Uint8Array.from(host)
    device[0] = 0x3e
    const chunk = Uint8Array.from([0x00, 0x3c, ...device])
    const parser = new StreamFrameParser()
    const first = parser.push(chunk.subarray(0, 4))
    const second = parser.push(chunk.subarray(4))
    const frames = [...first, ...second]
    expect(frames).toHaveLength(1)
    expect([...frames[0]]).toEqual([0xaa, 0xbb])
  })
})

describe('station et LPP', () => {
  it('conserve un seuil vide', () => {
    const encoded = encodeReading({
      ...emptyReading(),
      temperatureC: 11.5,
      batteryMv: 3920,
      cadence: 'normal',
      intervalS: 120,
      epoch: 1_700_000_000,
    })
    const decoded = decodeReading(encoded)
    expect(decoded.temperatureC).toBeCloseTo(11.5, 2)
    expect(decoded.humidityPct).toBeNull()
    expect(decoded.batteryMv).toBe(3920)
    expect(decoded.cadence).toBe('normal')
    expect(decoded.intervalS).toBe(120)
  })

  it('décode un BME680 CayenneLPP', () => {
    const reading = {
      ...emptyReading(),
      temperatureC: 18.5,
      humidityPct: 40,
      pressureHpa: 1010,
      gasOhm: 50_000,
      iaq: 50,
      batteryMv: 4000,
    }
    const partial = readingsFromLpp(decodeLpp(encodeReadingLpp(reading)))
    expect(partial.temperatureC).toBeCloseTo(18.5, 1)
    expect(partial.humidityPct).toBe(40)
    expect(partial.pressureHpa).toBeCloseTo(1010, 1)
    expect(partial.gasOhm).toBeCloseTo(50_000, 0)
    expect(partial.iaq).toBe(50)
    expect(partial.batteryMv).toBe(4000)
    expect(partial.dewPointC).toBeCloseTo(4.6, 1)
    expect(partial.feelsLikeC).toBeGreaterThan(17)
    expect(partial.frostScore).toBe(0)
    expect(partial.fireScore).toBeGreaterThan(0)
    expect(FACTORY_BANDS.temp.mean).toBe(15)
  })

  it('ignore la température du micro et lit la ligne mto_now', () => {
    const mcu = Uint8Array.of(1, 103, 0x01, 0x86)
    expect(readingsFromLpp(decodeLpp(mcu)).temperatureC).toBeUndefined()
    const line = parseMeteoLine('F4EED-Meteo: T 15.0 HR 55.0 P 1013.2 rosée 6.0 ressenti 14.1 gel 0 feu 2 fumée 0')
    expect(line?.temperatureC).toBeCloseTo(15, 1)
    expect(line?.dewPointC).toBeCloseTo(6, 1)
    expect(line?.feelsLikeC).toBeCloseTo(14.1, 1)
    expect(line?.frostScore).toBe(0)
    expect(line?.fireScore).toBe(2)
    expect(line?.smokeScore).toBe(0)
    expect(parseMeteoLine('Pager: mto_now')).toBeNull()
  })
})
