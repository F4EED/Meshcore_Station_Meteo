import { NUS_RX, NUS_SERVICE, NUS_TX } from '../protocol/codes'
import { FrameQueue } from './queue'
import type { Link } from './types'

export async function openBleLink(device: BluetoothDevice): Promise<Link> {
  if (!device.gatt) throw new Error('Bluetooth indisponible')
  const server = await device.gatt.connect()
  const service = await server.getPrimaryService(NUS_SERVICE)
  const rx = await service.getCharacteristic(NUS_RX)
  const tx = await service.getCharacteristic(NUS_TX)
  const queue = new FrameQueue()
  await tx.startNotifications()
  const onValue = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value
    if (!value) return
    const copy = new Uint8Array(value.byteLength)
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    queue.push(copy)
  }
  tx.addEventListener('characteristicvaluechanged', onValue)
  let closed = false
  const link: Link = {
    kind: 'ble',
    label: device.name || 'Bluetooth',
    async send(payload) {
      if (closed) throw new Error('Lien fermé')
      try {
        await rx.writeValue(payload)
      } catch {
        await rx.writeValueWithoutResponse(payload)
      }
    },
    nextFrame: (timeoutMs) => queue.next(timeoutMs),
    async close() {
      if (closed) return
      closed = true
      tx.removeEventListener('characteristicvaluechanged', onValue)
      queue.fail(new Error('Bluetooth fermé'))
      try {
        await tx.stopNotifications()
      } catch {
        /* notification déjà arrêtée */
      }
      server.disconnect()
    },
  }
  device.addEventListener('gattserverdisconnected', () => {
    if (closed) return
    closed = true
    queue.fail(new Error('Bluetooth déconnecté'))
    link.onLost?.()
  })
  return link
}
