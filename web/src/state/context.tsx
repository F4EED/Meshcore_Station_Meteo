import { createContext, useContext } from 'react'
import type { Snapshot } from '../link/session'
import type { LinkKind } from '../link/types'
import type { Band } from '../model'
import type { Settings } from './storage'

export type StationContextValue = {
  status: 'disconnected' | 'connecting' | 'connected'
  linkKind: LinkKind | null
  linkLabel: string
  error: string | null
  log: string[]
  snapshot: Snapshot | null
  settings: Settings
  busy: boolean
  epoch: number
  updateSettings: (patch: Partial<Settings>) => void
  connectDemo: () => void
  connectHttp: () => void
  connectUsb: () => void
  connectBle: (acceptAll: boolean) => void
  disconnect: () => Promise<void>
  poll: () => Promise<void>
  createChannel: (index: number, name: string, secret: Uint8Array) => Promise<void>
  saveRegion: (name: string, transportKey: Uint8Array | null) => Promise<void>
  saveBands: (bands: Band[]) => Promise<void>
  reloadBands: () => Promise<void>
  applyRadio: () => Promise<void>
}

export const StationContext = createContext<StationContextValue | null>(null)

export function useStation(): StationContextValue {
  const value = useContext(StationContext)
  if (!value) throw new Error('Contexte station manquant')
  return value
}
