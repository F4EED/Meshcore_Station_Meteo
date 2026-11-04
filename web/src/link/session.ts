import { BAND_ORDER, type Band, type LiveReading, emptyReading, withEstimatedEco2 } from '../model'
import {
  encodeAppStart,
  encodeCustomVar,
  encodeDeviceQuery,
  encodeFloodScope,
  encodeGetBattery,
  encodeGetChannel,
  encodeGetCustomVars,
  encodeGetFloodScope,
  encodeRadioProfile,
  encodeSetChannel,
  encodeSetTime,
  isError,
  packetErrorMessage,
  parseBattery,
  parseChannel,
  parseCustomVars,
  parseDeviceInfo,
  parseFloodScope,
  parseSelfInfo,
  type ChannelInfo,
  type DeviceInfo,
  type SelfInfo,
} from '../protocol/companion'
import { CMD_SYNC_NEXT_MESSAGE, PUSH_TELEM, RESP_BATT, RESP_CHANNEL, RESP_CHANNEL_DATA, RESP_CHANNEL_MSG, RESP_CHANNEL_MSG_V3, RESP_CUSTOM_VARS, RESP_DEVICE, RESP_FLOOD, RESP_NO_MORE_MSGS, RESP_OK, RESP_SELF } from '../protocol/codes'
import { readingFromTelemetryFrame } from '../protocol/lpp'
import { readingFromCompanionFrame } from '../protocol/radio'
import { decodeBand, decodeReading, encodeGetBand, encodeGetReading, encodeSetBand } from '../protocol/station'
import { BAND_META } from '../model'
import type { Link } from './types'

export type ReadingSource = 'station' | 'lpp' | 'radio' | 'texte' | 'none'

export type Snapshot = {
  self: SelfInfo | null
  device: DeviceInfo | null
  channels: ChannelInfo[]
  region: string
  floodName: string
  reading: LiveReading | null
  readingSource: ReadingSource
  readingAt: number | null
  bands: Band[] | null
  bandsSource: 'station' | 'local'
  stationReading: boolean
  stationBands: boolean
}

function blank(): Snapshot {
  return {
    self: null,
    device: null,
    channels: [],
    region: '',
    floodName: '',
    reading: null,
    readingSource: 'none',
    readingAt: null,
    bands: null,
    bandsSource: 'local',
    stationReading: false,
    stationBands: false,
  }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Erreur inconnue'
}

const RADIO_REPLY = new Set([RESP_CHANNEL_MSG, RESP_CHANNEL_MSG_V3, RESP_CHANNEL_DATA, 0x07, 0x10])

function blankReading() {
  return withEstimatedEco2(emptyReading())
}

function mergeLive(prev: LiveReading, next: LiveReading): LiveReading {
  const out: LiveReading = { ...prev }
  const keys = [
    'temperatureC',
    'humidityPct',
    'pressureHpa',
    'gasOhm',
    'iaq',
    'eco2Ppm',
    'batteryMv',
    'intervalS',
    'epoch',
    'dewPointC',
    'feelsLikeC',
    'frostScore',
    'fireScore',
    'smokeScore',
  ] as const
  for (const key of keys) {
    const value = next[key]
    if (typeof value === 'number') out[key] = value
  }
  if (next.cadence != null) out.cadence = next.cadence
  if (next.eco2Ppm != null) out.eco2Estimated = next.eco2Estimated
  return out
}

export class StationSession {
  private tail: Promise<void> = Promise.resolve()
  private state: Snapshot = blank()
  private closed = false
  private stashedRadio: Uint8Array[] = []

  constructor(
    private readonly link: Link,
    private readonly onLog: (line: string) => void = () => undefined,
  ) {}

  snapshot(): Snapshot {
    return structuredClone(this.state)
  }

  open(): Promise<Snapshot> {
    return this.run(() => this.openInner())
  }

  poll(): Promise<Snapshot> {
    return this.run(() => this.pollInner())
  }

  createChannel(index: number, name: string, secret: Uint8Array): Promise<Snapshot> {
    return this.run(async () => {
      const accepted = await this.tryOk(encodeSetChannel(index, name, secret))
      if (!accepted) throw new Error('La station a refusé le canal')
      const frame = await this.req(encodeGetChannel(index), (item) => item[0] === RESP_CHANNEL || isError(item))
      if (isError(frame)) throw new Error('Canal écrit, relecture impossible')
      const info = parseChannel(frame)
      if (!info) throw new Error('Réponse canal illisible')
      this.state.channels = [...this.state.channels.filter((item) => item.index !== index), info].sort((a, b) => a.index - b.index)
      this.onLog(`Canal « ${name} » écrit sur l’emplacement ${index}`)
      return this.snapshot()
    })
  }

  setRegion(name: string, transportKey: Uint8Array | null): Promise<Snapshot> {
    return this.run(async () => {
      const accepted = await this.tryOk(encodeCustomVar('region', name))
      if (!accepted) throw new Error('La station n’a pas enregistré la région')
      this.state.region = name
      if (transportKey) {
        const floodOk = await this.tryOk(encodeFloodScope(name, transportKey))
        if (!floodOk) throw new Error('Région enregistrée, clé de transport refusée')
        this.state.floodName = name
      }
      this.onLog(`Région « ${name} » envoyée`)
      return this.snapshot()
    })
  }

  saveBands(bands: Band[]): Promise<Snapshot> {
    return this.run(async () => {
      if (bands.length !== 8) throw new Error('Huit bandes attendues')
      for (let i = 0; i < 8; i += 1) {
        const accepted = await this.tryOk(encodeSetBand(i, bands[i]))
        if (!accepted) throw new Error(`La station a refusé la bande ${BAND_META[BAND_ORDER[i]].label}`)
      }
      this.state.bands = bands.map((band) => ({ ...band }))
      this.state.bandsSource = 'station'
      this.state.stationBands = true
      this.onLog('Bandes enregistrées sur la station')
      return this.snapshot()
    })
  }

  reloadBands(): Promise<Snapshot> {
    return this.run(async () => {
      const bands = await this.readBands()
      this.state.bands = bands
      this.state.bandsSource = bands ? 'station' : 'local'
      this.state.stationBands = bands != null
      if (!bands) throw new Error('La station n’a pas renvoyé les bandes')
      return this.snapshot()
    })
  }

  applyRadio(): Promise<Snapshot> {
    return this.run(async () => {
      const accepted = await this.tryOk(encodeRadioProfile())
      if (!accepted) throw new Error('Profil radio refusé')
      try {
        const frame = await this.req(encodeAppStart(), (item) => item[0] === RESP_SELF)
        const self = parseSelfInfo(frame)
        if (self) this.state.self = self
      } catch (err) {
        this.onLog(errorText(err))
      }
      this.onLog('Profil meshcore.fr envoyé (869,618 MHz, SF 8, CR 8, sans répéteur)')
      return this.snapshot()
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.link.close()
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.tail.then(fn, fn)
    this.tail = job.then(
      () => undefined,
      () => undefined,
    )
    return job
  }

  private async openInner(): Promise<Snapshot> {
    const selfFrame = await this.req(encodeAppStart(), (frame) => frame[0] === RESP_SELF)
    const self = parseSelfInfo(selfFrame)
    if (!self) throw new Error('Réponse d’annonce illisible')
    this.onLog(`Annonce ${self.name || 'sans nom'} · ${self.freqMhz.toLocaleString('fr-FR')} MHz`)

    const deviceFrame = await this.req(encodeDeviceQuery(), (frame) => frame[0] === RESP_DEVICE || isError(frame))
    const device = isError(deviceFrame) ? null : parseDeviceInfo(deviceFrame)
    if (device) this.onLog(`${device.model || 'nœud'} · firmware ${device.version || device.fwVer}`)

    const now = Math.floor(Date.now() / 1000)
    await this.tryOk(encodeSetTime(now))

    const slots = Math.min(Math.max(device?.maxChannels || 8, 1), 8)
    const channels: ChannelInfo[] = []
    for (let index = 0; index < slots; index += 1) {
      const frame = await this.req(encodeGetChannel(index), (item) => item[0] === RESP_CHANNEL || isError(item))
      if (isError(frame)) break
      const info = parseChannel(frame)
      if (info) channels.push(info)
    }

    let region = ''
    try {
      const frame = await this.req(encodeGetCustomVars(), (item) => item[0] === RESP_CUSTOM_VARS || isError(item))
      if (!isError(frame)) region = parseCustomVars(frame)?.region ?? ''
    } catch (err) {
      this.onLog(errorText(err))
    }

    let floodName = ''
    try {
      const frame = await this.req(encodeGetFloodScope(), (item) => item[0] === RESP_FLOOD || isError(item))
      if (!isError(frame)) floodName = parseFloodScope(frame)?.name ?? ''
    } catch (err) {
      this.onLog(errorText(err))
    }

    const companion = self.advType !== 4
    const bands = await this.readBands()
    const heard = companion ? await this.readCompanion() : null
    if (companion && !heard) this.onLog('Compagnon en écoute sur #germacrisepublic. La sonde locale n’est pas lue.')
    const measured = companion ? (heard ?? { reading: blankReading(), source: 'none' as const }) : await this.readMeasurement()
    const reading = companion ? measured.reading : await this.mergeBattery(measured.reading)
    this.state = {
      self,
      device,
      channels,
      region,
      floodName,
      reading,
      readingSource: measured.source,
      readingAt: measured.source === 'none' ? null : Date.now(),
      bands,
      bandsSource: bands ? 'station' : 'local',
      stationReading: measured.source === 'station',
      stationBands: bands != null,
    }
    return this.snapshot()
  }

  private async pollInner(): Promise<Snapshot> {
    if (this.state.self && this.state.self.advType !== 4) {
      const measured = await this.readCompanion()
      if (!measured) return this.snapshot()
      this.state.reading = measured.reading
      this.state.readingSource = measured.source
      this.state.readingAt = Date.now()
      this.state.stationReading = false
      return this.snapshot()
    }
    const measured = await this.readMeasurement()
    this.state.reading = await this.mergeBattery(measured.reading)
    this.state.readingSource = measured.source
    this.state.readingAt = measured.source === 'none' ? this.state.readingAt : Date.now()
    this.state.stationReading = measured.source === 'station'
    return this.snapshot()
  }

  private async mergeBattery(reading: LiveReading): Promise<LiveReading> {
    if (reading.batteryMv != null) return reading
    try {
      const frame = await this.req(encodeGetBattery(), (item) => item[0] === RESP_BATT || isError(item))
      const battery = isError(frame) ? null : parseBattery(frame)
      if (battery) return { ...reading, batteryMv: battery.mv }
    } catch (err) {
      this.onLog(errorText(err))
    }
    return reading
  }

  private async readMeasurement(): Promise<{ reading: LiveReading; source: ReadingSource }> {
    try {
      const frame = await this.req(encodeGetReading(), (item) => item[0] === 0x70 || isError(item))
      if (!isError(frame)) {
        this.onLog('Mesure station reçue')
        return { reading: withEstimatedEco2(decodeReading(frame)), source: 'station' }
      }
      this.onLog('Commande station 0x70 non prise en charge, repli LPP')
    } catch (err) {
      this.onLog(errorText(err))
    }
    try {
      const frame = await this.req(Uint8Array.of(0x27, 0, 0, 0), (item) => item[0] === PUSH_TELEM || isError(item))
      if (isError(frame)) {
        this.onLog(packetErrorMessage(frame))
        return { reading: blankReading(), source: 'none' }
      }
      this.onLog('Mesure LPP reçue')
      return { reading: withEstimatedEco2(readingFromTelemetryFrame(frame)), source: 'lpp' }
    } catch (err) {
      this.onLog(errorText(err))
      return { reading: blankReading(), source: 'none' }
    }
  }

  private async readCompanion(): Promise<{ reading: LiveReading; source: 'radio' | 'texte' } | null> {
    let reading: LiveReading | null = null
    let source: 'radio' | 'texte' | null = null
    const take = (frame: Uint8Array) => {
      const hit = readingFromCompanionFrame(frame)
      if (!hit) return
      const next = withEstimatedEco2(hit.reading)
      reading = reading ? mergeLive(reading, next) : next
      source = hit.source === 'radio' || source == null ? hit.source : source
      this.onLog(hit.source === 'texte' ? 'Texte station sur #germacrisepublic' : 'Flood 0xFF42 reçu (0x1B)')
    }
    while (this.stashedRadio.length) {
      const frame = this.stashedRadio.shift()
      if (frame) take(frame)
    }
    for (let turn = 0; turn < 16; turn += 1) {
      let frame: Uint8Array
      try {
        frame = await this.req(
          Uint8Array.of(CMD_SYNC_NEXT_MESSAGE),
          (item) => item[0] === RESP_NO_MORE_MSGS || RADIO_REPLY.has(item[0]) || isError(item),
          2000,
        )
      } catch (err) {
        this.onLog(errorText(err))
        break
      }
      if (isError(frame) || frame[0] === RESP_NO_MORE_MSGS) break
      take(frame)
      while (this.stashedRadio.length) {
        const extra = this.stashedRadio.shift()
        if (extra) take(extra)
      }
    }
    if (!reading || !source) return null
    return { reading, source }
  }

  private async readBands(): Promise<Band[] | null> {
    const bands: Band[] = []
    for (let index = 0; index < 8; index += 1) {
      let frame: Uint8Array
      try {
        frame = await this.req(encodeGetBand(index), (item) => item[0] === 0x71 || isError(item))
      } catch (err) {
        this.onLog(errorText(err))
        return index === 0 ? null : bands
      }
      if (isError(frame)) {
        if (index === 0) this.onLog('Bandes station non prises en charge')
        return index === 0 ? null : bands
      }
      const decoded = decodeBand(frame)
      if (!decoded) return index === 0 ? null : bands
      bands.push(decoded.band)
    }
    return bands
  }

  private async tryOk(payload: Uint8Array): Promise<boolean> {
    try {
      const frame = await this.req(payload, (item) => item[0] === RESP_OK || isError(item))
      if (isError(frame)) {
        this.onLog(packetErrorMessage(frame))
        return false
      }
      return true
    } catch (err) {
      this.onLog(errorText(err))
      return false
    }
  }

  private async req(payload: Uint8Array, accept: (frame: Uint8Array) => boolean, timeoutMs = 5000): Promise<Uint8Array> {
    if (this.closed) throw new Error('Lien fermé')
    await this.link.send(payload)
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const left = deadline - Date.now()
      if (left <= 0) throw new Error('Délai dépassé')
      const frame = await this.link.nextFrame(left)
      if (frame[0] === PUSH_TELEM && !accept(frame)) {
        this.stashedRadio.push(frame)
        continue
      }
      if (frame[0] >= 0x80 && !accept(frame)) continue
      if (!accept(frame) && RADIO_REPLY.has(frame[0])) {
        this.stashedRadio.push(frame)
        continue
      }
      if (accept(frame)) return frame
      throw new Error(`Réponse inattendue 0x${frame[0].toString(16)}`)
    }
  }
}
