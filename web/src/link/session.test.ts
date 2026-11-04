import { afterEach, describe, expect, it } from 'vitest'
import { FACTORY_CHANNEL_NAME, STMET_DATA_TYPE } from '../protocol/codes'
import { emptyReading } from '../model'
import { encodeReadingLpp } from '../protocol/lpp'
import { encodeChannelDataFrame, encodeChannelTextFrame } from '../protocol/radio'
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
    expect(created.channels.find((channel) => channel.index === 1)?.name).toBe(FACTORY_CHANNEL_NAME)
    expect(created.channels.find((channel) => channel.index === 1)?.secretHex).toBe('00'.repeat(16))

    const region = await session.setRegion('fr-42', null)
    expect(region.region).toBe('fr-42')
    expect(sim.region).toBe('fr-42')
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

  it('décode le 0x1B 0xFF42 du compagnon sans sonder le LPP local', async () => {
    const sim = new StationFirmwareSim()
    sim.advType = 1
    sim.stationExtension = false
    const lpp = encodeReadingLpp({
      ...emptyReading(),
      temperatureC: 15,
      humidityPct: 55,
      pressureHpa: 1013.2,
      gasOhm: 50_000,
      iaq: 42,
      batteryMv: 3900,
      dewPointC: 6,
      feelsLikeC: 14.1,
      frostScore: 0,
      fireScore: 2,
      smokeScore: 0,
    })
    sim.radioQueue.push(encodeChannelDataFrame(1, STMET_DATA_TYPE, lpp))
    sim.radioQueue.push(encodeChannelTextFrame(1, 'F4EED-Meteo: T 15.0 HR 55.0 P 1013.2 rosée 6.0 ressenti 14.1 gel 0 feu 2 fumée 0'))
    const session = new StationSession(createDemoLink(sim))
    const snap = await session.open()
    expect(sim.selfTelemetryHits).toBe(0)
    expect(snap.self?.advType).toBe(1)
    expect(snap.readingSource).toBe('radio')
    expect(snap.reading?.temperatureC).toBeCloseTo(15, 1)
    expect(snap.reading?.humidityPct).toBeCloseTo(55, 1)
    expect(snap.reading?.pressureHpa).toBeCloseTo(1013.2, 1)
    expect(snap.reading?.gasOhm).toBeCloseTo(50_000, 0)
    expect(snap.reading?.iaq).toBe(42)
    expect(snap.reading?.dewPointC).toBeCloseTo(6, 1)
    expect(snap.reading?.feelsLikeC).toBeCloseTo(14.1, 1)
    expect(snap.reading?.frostScore).toBe(0)
    expect(snap.reading?.fireScore).toBe(2)
    expect(snap.reading?.smokeScore).toBe(0)
    expect(snap.reading?.batteryMv).toBe(3900)
    const kept = await session.poll()
    expect(kept.reading?.gasOhm).toBeCloseTo(50_000, 0)
    expect(sim.selfTelemetryHits).toBe(0)
  })

  it('lit le texte mto_now et ignore la commande seule', async () => {
    const sim = new StationFirmwareSim()
    sim.advType = 1
    sim.stationExtension = false
    sim.radioQueue.push(encodeChannelTextFrame(0, 'Pager: mto_now'))
    sim.radioQueue.push(encodeChannelTextFrame(1, 'F4EED-Meteo: T 12.5 HR 80.0 P 1008.0 rosée 9.1 ressenti 12.0 gel 40 feu 0 fumée 5'))
    const session = new StationSession(createDemoLink(sim))
    const snap = await session.open()
    expect(snap.readingSource).toBe('texte')
    expect(snap.reading?.temperatureC).toBeCloseTo(12.5, 1)
    expect(snap.reading?.humidityPct).toBeCloseTo(80, 1)
    expect(snap.reading?.dewPointC).toBeCloseTo(9.1, 1)
    expect(snap.reading?.feelsLikeC).toBeCloseTo(12, 1)
    expect(snap.reading?.frostScore).toBe(40)
    expect(snap.reading?.fireScore).toBe(0)
    expect(snap.reading?.smokeScore).toBe(5)
    expect(sim.selfTelemetryHits).toBe(0)
  })

  it('lit RH, gaz, IAQ, eCO2 et batterie dans le texte', async () => {
    const sim = new StationFirmwareSim()
    sim.advType = 1
    sim.stationExtension = false
    sim.radioQueue.push(encodeChannelTextFrame(1, 'F4EED-Meteo: T 15.0 RH 55.0 P 1013.2 gaz 50000 iaq 42 eco2 568 batterie 3.9'))
    const session = new StationSession(createDemoLink(sim))
    const snap = await session.open()
    expect(sim.selfTelemetryHits).toBe(0)
    expect(snap.reading?.temperatureC).toBeCloseTo(15, 1)
    expect(snap.reading?.humidityPct).toBeCloseTo(55, 1)
    expect(snap.reading?.pressureHpa).toBeCloseTo(1013.2, 1)
    expect(snap.reading?.gasOhm).toBe(50_000)
    expect(snap.reading?.iaq).toBe(42)
    expect(snap.reading?.eco2Ppm).toBe(568)
    expect(snap.reading?.batteryMv).toBe(3900)
  })
})
