import { encodeHostFrame, StreamFrameParser } from '../protocol/frame'
import { FrameQueue } from './queue'
import type { Link } from './types'

/** VID proposés par `requestPort`. Pas seulement Seeed : le compagnon USB JTAG est Espressif 0x303A / PID 0x1001. */
export const USB_PORT_FILTERS: SerialPortFilter[] = [
  { usbVendorId: 0x303a },
  { usbVendorId: 0x2886 },
  { usbVendorId: 0x10c4 },
  { usbVendorId: 0x1a86 },
  { usbVendorId: 0x0403 },
  { usbVendorId: 0x239a },
  { usbVendorId: 0x2e8a },
  { usbVendorId: 0x1915 },
]

export const ESPRESSIF_USB_VENDOR_ID = 0x303a
export const ESPRESSIF_USB_JTAG_PRODUCT_ID = 0x1001

export function serialPortRequest(): SerialPortRequestOptions {
  return { filters: USB_PORT_FILTERS }
}

export async function openSerialLink(port: SerialPort): Promise<Link> {
  await port.open({ baudRate: 115200 })
  const parser = new StreamFrameParser()
  const queue = new FrameQueue()
  const reader = port.readable?.getReader()
  const writer = port.writable?.getWriter()
  if (!reader || !writer) throw new Error('Port série indisponible')
  let closed = false
  const link: Link = {
    kind: 'usb',
    label: 'USB',
    async send(payload) {
      if (closed) throw new Error('Lien fermé')
      await writer.write(encodeHostFrame(payload))
    },
    nextFrame: (timeoutMs) => queue.next(timeoutMs),
    async close() {
      if (closed) return
      closed = true
      queue.fail(new Error('Port USB fermé'))
      try {
        await reader.cancel()
      } catch {
        /* déjà relâché */
      }
      try {
        writer.releaseLock()
      } catch {
        /* déjà relâché */
      }
      try {
        await port.close()
      } catch {
        /* Chrome a déjà lâché le port */
      }
    },
  }
  port.addEventListener('disconnect', () => {
    link.onLost?.()
    void link.close()
  })
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          for (const frame of parser.push(value)) queue.push(frame)
        }
      }
    } catch (err) {
      queue.fail(err instanceof Error ? err : new Error('Lecture USB interrompue'))
    } finally {
      if (!closed) link.onLost?.()
    }
  })()
  return link
}
