import http from 'node:http'
import { base64ToBytes, bytesToBase64 } from '../protocol/bytes'
import { StationFirmwareSim } from '../link/firmware-sim'

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 65_536) {
        reject(new Error('corps trop grand'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  res.end(raw)
}

export function startMock(port = 0): Promise<{ url: string; sim: StationFirmwareSim; close: () => Promise<void> }> {
  const sim = new StationFirmwareSim()
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {})
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      sendJson(res, 200, { ok: true, role: 'station-sim' })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/frame') {
      try {
        const json = JSON.parse(await readBody(req)) as { payload?: string }
        if (!json.payload) {
          sendJson(res, 400, { error: 'payload base64 manquant' })
          return
        }
        const reply = sim.handle(base64ToBytes(json.payload))
        sendJson(res, 200, { frames: [bytesToBase64(reply)] })
      } catch {
        sendJson(res, 400, { error: 'requête illisible' })
      }
      return
    }
    sendJson(res, 404, { error: 'introuvable' })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const chosen = typeof address === 'object' && address ? address.port : port
      resolve({
        url: `http://127.0.0.1:${chosen}`,
        sim,
        close: () =>
          new Promise((done, reject) => {
            server.close((err) => (err ? reject(err) : done()))
          }),
      })
    })
  })
}

const invoked = process.argv[1]?.includes('http-server')
if (invoked) {
  const port = 5174
  void startMock(port).then(() => {
    console.log(`Simulateur station sur http://127.0.0.1:${port}`)
  })
}
