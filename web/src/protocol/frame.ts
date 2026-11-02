const MAX_PAYLOAD = 512

export function encodeHostFrame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(3 + payload.length)
  out[0] = 0x3c
  out[1] = payload.length & 0xff
  out[2] = (payload.length >> 8) & 0xff
  out.set(payload, 3)
  return out
}

export class StreamFrameParser {
  private buf: number[] = []

  push(chunk: Uint8Array): Uint8Array[] {
    for (const byte of chunk) this.buf.push(byte)
    const frames: Uint8Array[] = []
    while (this.buf.length >= 3) {
      if (this.buf[0] !== 0x3e) {
        this.buf.shift()
        continue
      }
      const len = this.buf[1] | (this.buf[2] << 8)
      if (len > MAX_PAYLOAD) {
        this.buf.shift()
        continue
      }
      if (this.buf.length < 3 + len) break
      frames.push(Uint8Array.from(this.buf.slice(3, 3 + len)))
      this.buf.splice(0, 3 + len)
    }
    return frames
  }
}
