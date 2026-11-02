import { StationFirmwareSim } from './firmware-sim'
import type { Link } from './types'

export function createDemoLink(sim = new StationFirmwareSim()): Link & { sim: StationFirmwareSim } {
  let pending: Uint8Array | null = null
  let closed = false
  const link: Link & { sim: StationFirmwareSim } = {
    kind: 'demo',
    label: 'Démonstration',
    sim,
    async send(payload) {
      if (closed) throw new Error('Lien fermé')
      pending = payload
    },
    async nextFrame() {
      if (closed) throw new Error('Lien fermé')
      if (!pending) throw new Error('Aucune commande en attente')
      const command = pending
      pending = null
      return sim.handle(command)
    },
    async close() {
      closed = true
      pending = null
    },
  }
  return link
}
