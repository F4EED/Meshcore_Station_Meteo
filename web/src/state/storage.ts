import { FACTORY_CHANNEL_KEY_HEX, FACTORY_CHANNEL_NAME, FACTORY_CHANNEL_SLOT, FACTORY_REGION } from '../protocol/codes'
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
    channelKeyHex: FACTORY_CHANNEL_KEY_HEX,
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
    const channelName = parsed.channelName === 'Germacrise' || !parsed.channelName ? base.channelName : parsed.channelName
    return {
      ...base,
      ...parsed,
      channelName,
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
