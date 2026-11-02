import { afterEach, describe, expect, it } from 'vitest'
import { FACTORY_CHANNEL_NAME } from '../protocol/codes'
import { emptyReading } from '../model'
import { createDemoLink } from './demo'
import { StationFirmwareSim } from './firmware-sim'
import { HttpLink } from './http'
import { StationSession } from './session'
import { startMock } from '../mock/http-server'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (closers.length) await closers.pop()?.()
})

describe('session station', () => {
  it('ouvre, crée le canal et enregistre la région', async () => {
    const sim = new StationFirmwareSim()
    sim.fixedReading = {
      ...emptyReading(),
      temperatureC: 11.4,
      humidityPct: 60,
      pressureHpa: 1012,
      gasOhm: 80_000,
      iaq: 42,
      batteryMv: 3920,
      cadence: 'normal',
      intervalS: 600,
      epoch: 1_700_000_000,
    }
    const session = new StationSession(createDemoLink(sim))
    const opened = await session.open()
    expect(opened.self?.name).toBe('Station meteo')
    expect(opened.self?.freqMhz).toBeCloseTo(869.618, 3)
    expect(opened.self?.sf).toBe(8)
    expect(opened.self?.advType).toBe(4)
    expect(opened.readingSource).toBe('station')
    expect(opened.reading?.temperatureC).toBeCloseTo(11.4, 2)
    expect(opened.reading?.eco2Ppm).toBe(400 + 42 * 4)
    expect(opened.reading?.eco2Estimated).toBe(true)
    expect(opened.bands).toHaveLength(8)
    expect(opened.bands?.[0].mean).toBe(15)
    expect(opened.bands?.[3].veryHigh).toBeNull()

    const created = await session.createChannel(1, FACTORY_CHANNEL_NAME, new Uint8Array(16))
    expect(created.channels.find((channel) => channel.index === 1)?.name).toBe('#germacrise_publique')
    expect(created.channels.find((channel) => channel.index === 1)?.secretHex).toBe('00'.repeat(16))

    const region = await session.setRegion('fr-ara', null)
    expect(region.region).toBe('fr-ara')
    expect(sim.region).toBe('fr-ara')
    expect(sim.hasFlood).toBe(false)

    const bands = opened.bands!.map((band) => ({ ...band }))
    bands[0] = { ...bands[0], mean: 16 }
    await session.saveBands(bands)
    const again = new StationSession(createDemoLink(sim))
    const reread = await again.open()
    expect(reread.bands?.[0].mean).toBe(16)
  })

  it('retombe sur le LPP si les commandes station manquent', async () => {
    const sim = new StationFirmwareSim()
    sim.stationExtension = false
    sim.fixedReading = {
      ...emptyReading(),
      temperatureC: 18.5,
      humidityPct: 40,
      pressureHpa: 1010,
      gasOhm: 50_000,
      iaq: 50,
      batteryMv: 4000,
    }
    const session = new StationSession(createDemoLink(sim))
    const snap = await session.open()
    expect(snap.readingSource).toBe('lpp')
    expect(snap.stationBands).toBe(false)
    expect(snap.reading?.temperatureC).toBeCloseTo(18.5, 1)
    expect(snap.reading?.gasOhm).toBeCloseTo(50_000, 0)
    expect(snap.reading?.eco2Estimated).toBe(true)
    expect(snap.reading?.eco2Ppm).toBe(600)
  })

  it('applique le profil radio et parle en HTTP', async () => {
    const mock = await startMock(0)
    closers.push(mock.close)
    mock.sim.freqMhz = 868
    const session = new StationSession(new HttpLink(mock.url))
    const opened = await session.open()
    expect(opened.self?.freqMhz).toBeCloseTo(868, 3)
    const applied = await session.applyRadio()
    expect(applied.self?.freqMhz).toBeCloseTo(869.618, 3)
    expect(applied.self?.bwKhz).toBeCloseTo(62.5, 2)
    expect(applied.self?.cr).toBe(8)
    expect(mock.sim.repeat).toBe(false)
  })
})
