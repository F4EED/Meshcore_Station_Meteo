import { base64ToBytes, bytesToBase64 } from '../protocol/bytes'
import type { Link } from './types'

export class HttpLink implements Link {
  readonly kind = 'http' as const
  readonly label: string
  private pending: Uint8Array | null = null
  private queue: Uint8Array[] = []
  private closed = false

  constructor(private readonly baseUrl: string) {
    this.label = baseUrl
  }

  async send(payload: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Lien fermé')
    this.pending = payload
  }

  async nextFrame(timeoutMs: number): Promise<Uint8Array> {
    const queued = this.queue.shift()
    if (queued) return queued
    if (!this.pending) throw new Error('Aucune commande en attente')
    const payload = this.pending
    this.pending = null
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs))
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/frame`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: bytesToBase64(payload) }),
        signal: ctrl.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const json = (await response.json()) as { frames?: string[]; error?: string }
      if (json.error) throw new Error(json.error)
      const frames = (json.frames ?? []).map(base64ToBytes)
      if (!frames.length) throw new Error('Réponse vide')
      const [first, ...rest] = frames
      this.queue.push(...rest)
      return first
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('Délai dépassé')
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.pending = null
    this.queue = []
  }
}
