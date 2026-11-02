import { FACTORY_CHANNEL_NAME, FACTORY_CHANNEL_SLOT, FACTORY_REGION } from '../protocol/codes'
import { FACTORY_BANDS, bandsToList, cloneBandSet, type BandSet } from '../weather/factory'
import type { Band } from '../model'

export type Settings = {
  httpUrl: string
  channelName: string
  channelKeyHex: string
  channelSlot: number
  region: string
  floodKeyHex: string
  bands: BandSet
}

const KEY = 'stmeteo.v1'

export function factorySettings(): Settings {
  return {
    httpUrl: 'http://127.0.0.1:5174',
    channelName: FACTORY_CHANNEL_NAME,
    channelKeyHex: '',
    channelSlot: FACTORY_CHANNEL_SLOT,
    region: FACTORY_REGION,
    floodKeyHex: '',
    bands: cloneBandSet(FACTORY_BANDS),
  }
}

export function loadSettings(): Settings {
  const base = factorySettings()
  if (typeof localStorage === 'undefined') return base
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<Settings>
    const legacyName = !parsed.channelName || parsed.channelName === 'Germacrise' || parsed.channelName === '#GerMaCrise_publique'
    const legacyKey = !parsed.channelKeyHex || parsed.channelKeyHex.toLowerCase() === 'dce843f4d5c2ed416b4ce17db83df618'
    return {
      ...base,
      ...parsed,
      channelName: legacyName ? base.channelName : (parsed.channelName ?? base.channelName),
      channelKeyHex: legacyKey ? '' : (parsed.channelKeyHex ?? ''),
      bands: parsed.bands ? { ...base.bands, ...parsed.bands } : base.bands,
    }
  } catch {
    return base
  }
}

export function saveSettings(settings: Settings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* quota ou navigation privée */
  }
}

export function bandsList(settings: Settings): Band[] {
  return bandsToList(settings.bands)
}
