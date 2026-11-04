import { describe, expect, it } from 'vitest'
import { ESPRESSIF_USB_JTAG_PRODUCT_ID, ESPRESSIF_USB_VENDOR_ID, serialPortRequest, USB_PORT_FILTERS } from './serial'

describe('filtres USB', () => {
  it('propose Espressif 0x303A et Seeed 0x2886, pas Seeed seul', () => {
    const ids = USB_PORT_FILTERS.map((filter) => filter.usbVendorId)
    expect(ids).toContain(ESPRESSIF_USB_VENDOR_ID)
    expect(ids).toContain(0x2886)
    expect(ids).toContain(0x10c4)
    expect(ids).toContain(0x1a86)
    expect(ids).toContain(0x0403)
    expect(ids).toContain(0x239a)
    expect(ids).toContain(0x2e8a)
    expect(ids).toContain(0x1915)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ESPRESSIF_USB_JTAG_PRODUCT_ID).toBe(0x1001)
    const request = serialPortRequest()
    const espressif = request.filters?.find((filter) => filter.usbVendorId === ESPRESSIF_USB_VENDOR_ID)
    expect(espressif?.usbProductId).toBeUndefined()
    expect(request.filters?.every((filter) => filter.usbVendorId !== 0)).toBe(true)
    expect(request.filters).not.toEqual([{ usbVendorId: 0x2886 }])
  })
})
