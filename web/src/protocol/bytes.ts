export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function parseHex(input: string): Uint8Array | null {
  const clean = input.trim().toLowerCase().replace(/\s+/g, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) return null
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function isZero(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0)
}

export function readCString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  const slice = end === -1 ? bytes : bytes.subarray(0, end)
  return new TextDecoder().decode(slice).trim()
}

export function writeCString(target: Uint8Array, text: string): void {
  target.fill(0)
  const encoded = new TextEncoder().encode(text)
  target.set(encoded.subarray(0, target.length))
}

export function utf8Size(text: string): number {
  return new TextEncoder().encode(text).length
}

export function bytesToBase64(bytes: Uint8Array): string {
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw)
}

export function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
