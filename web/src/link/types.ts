export type LinkKind = 'usb' | 'ble' | 'http' | 'demo'

export interface Link {
  kind: LinkKind
  label: string
  send(payload: Uint8Array): Promise<void>
  nextFrame(timeoutMs: number): Promise<Uint8Array>
  close(): Promise<void>
  onLost?: () => void
}
