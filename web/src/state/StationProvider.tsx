import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createDemoLink } from '../link/demo'
import { openBleLink } from '../link/ble'
import { HttpLink } from '../link/http'
import { openSerialLink, serialPortRequest } from '../link/serial'
import { StationSession, type Snapshot } from '../link/session'
import type { Link, LinkKind } from '../link/types'
import type { Band } from '../model'
import { listToBandSet } from '../weather/factory'
import { loadSettings, saveSettings, type Settings } from './storage'
import { StationContext, type StationContextValue } from './context'

function humanize(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotFoundError') return 'Sélection annulée.'
    if (err.name === 'NotAllowedError') return 'Accès refusé par le navigateur.'
    if (err.name === 'SecurityError') return 'Contexte non sécurisé. Ouvrez la page en HTTPS ou sur localhost.'
  }
  if (err instanceof Error) {
    if (err.name === 'NotFoundError') return 'Sélection annulée.'
    return err.message
  }
  return 'Erreur inconnue'
}

export function StationProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<StationSession | null>(null)
  const [status, setStatus] = useState<StationContextValue['status']>('disconnected')
  const [linkKind, setLinkKind] = useState<LinkKind | null>(null)
  const [linkLabel, setLinkLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [busy, setBusy] = useState(false)
  const [epoch, setEpoch] = useState(0)

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [...prev, line].slice(-30))
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  const absorb = useCallback((snap: Snapshot) => {
    setSettings((prev) => {
      const next = { ...prev }
      if (snap.bands && snap.bandsSource === 'station') next.bands = listToBandSet(snap.bands)
      if (snap.region) next.region = snap.region
      saveSettings(next)
      return next
    })
    setEpoch((value) => value + 1)
  }, [])

  const attach = useCallback(
    async (link: Link) => {
      const session = new StationSession(link, pushLog)
      link.onLost = () => {
        if (sessionRef.current !== session) return
        sessionRef.current = null
        setStatus('disconnected')
        setLinkKind(null)
        setError('Lien coupé. Le port a été libéré.')
        pushLog('Lien coupé')
        void session.close()
      }
      sessionRef.current = session
      try {
        const snap = await session.open()
        setSnapshot(snap)
        absorb(snap)
        setLinkKind(link.kind)
        setLinkLabel(link.label)
        setStatus('connected')
      } catch (err) {
        sessionRef.current = null
        await session.close()
        throw err
      }
    },
    [absorb, pushLog],
  )

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setStatus((prev) => (prev === 'connected' ? prev : 'connecting'))
    try {
      await action()
    } catch (err) {
      if (!sessionRef.current) setStatus('disconnected')
      setError(humanize(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const connectDemo = useCallback(() => {
    void run(() => attach(createDemoLink()))
  }, [attach, run])

  const connectHttp = useCallback(() => {
    void run(async () => {
      const url = settings.httpUrl.replace(/\/$/, '')
      await attach(new HttpLink(url))
    })
  }, [attach, run, settings.httpUrl])

  const connectUsb = useCallback(() => {
    void run(async () => {
      if (!navigator.serial) throw new Error('Web Serial est indisponible. Utilisez Chrome ou Edge.')
      const port = await navigator.serial.requestPort(serialPortRequest())
      await attach(await openSerialLink(port))
    })
  }, [attach, run])

  const connectBle = useCallback(
    (acceptAll: boolean) => {
      void run(async () => {
        if (!navigator.bluetooth) throw new Error('Web Bluetooth est indisponible. Utilisez Chrome.')
        const device = await navigator.bluetooth.requestDevice(
          acceptAll
            ? { acceptAllDevices: true, optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }
            : { filters: [{ services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }] },
        )
        await attach(await openBleLink(device))
      })
    },
    [attach, run],
  )

  const disconnect = useCallback(async () => {
    const session = sessionRef.current
    sessionRef.current = null
    setStatus('disconnected')
    setLinkKind(null)
    setError(null)
    await session?.close()
    pushLog('Déconnecté')
  }, [pushLog])

  const poll = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    try {
      const snap = await session.poll()
      if (sessionRef.current === session) setSnapshot(snap)
    } catch (err) {
      if (sessionRef.current === session) setError(humanize(err))
    }
  }, [])

  const withSession = useCallback(
    async (action: (session: StationSession) => Promise<Snapshot>) => {
      const session = sessionRef.current
      if (!session) throw new Error('Pas connecté')
      setBusy(true)
      setError(null)
      try {
        const snap = await action(session)
        setSnapshot(snap)
        return snap
      } catch (err) {
        setError(humanize(err))
        throw err
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const createChannel = useCallback(
    async (index: number, name: string, secret: Uint8Array) => {
      await withSession((session) => session.createChannel(index, name, secret))
    },
    [withSession],
  )

  const saveRegion = useCallback(
    async (name: string, transportKey: Uint8Array | null) => {
      const snap = await withSession((session) => session.setRegion(name, transportKey))
      if (snap) absorb(snap)
    },
    [absorb, withSession],
  )

  const saveBands = useCallback(
    async (bands: Band[]) => {
      updateSettings({ bands: listToBandSet(bands) })
      const snap = await withSession((session) => session.saveBands(bands))
      if (snap) absorb(snap)
    },
    [absorb, updateSettings, withSession],
  )

  const reloadBands = useCallback(async () => {
    const snap = await withSession((session) => session.reloadBands())
    if (snap) absorb(snap)
  }, [absorb, withSession])

  const applyRadio = useCallback(async () => {
    await withSession((session) => session.applyRadio())
  }, [withSession])

  const value = useMemo<StationContextValue>(
    () => ({
      status,
      linkKind,
      linkLabel,
      error,
      log,
      snapshot,
      settings,
      busy,
      epoch,
      updateSettings,
      connectDemo,
      connectHttp,
      connectUsb,
      connectBle,
      disconnect,
      poll,
      createChannel,
      saveRegion,
      saveBands,
      reloadBands,
      applyRadio,
    }),
    [
      status,
      linkKind,
      linkLabel,
      error,
      log,
      snapshot,
      settings,
      busy,
      epoch,
      updateSettings,
      connectDemo,
      connectHttp,
      connectUsb,
      connectBle,
      disconnect,
      poll,
      createChannel,
      saveRegion,
      saveBands,
      reloadBands,
      applyRadio,
    ],
  )

  return <StationContext.Provider value={value}>{children}</StationContext.Provider>
}
