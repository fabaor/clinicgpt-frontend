/**
 * Proxy mínimo para a API da Anthropic.
 *
 * Em produção a chave não deve ficar no navegador. Suba este processo com a
 * chave no ambiente e aponte o front para ele:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npm run proxy
 *   # .env.local do front:
 *   VITE_API_PROXY_URL=http://localhost:8787/api/gerar
 *
 * O mesmo formato serve de molde para uma function na Vercel, Cloudflare ou
 * Netlify: receba o corpo, acrescente a chave, repasse a resposta.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)
const API_KEY = process.env.ANTHROPIC_API_KEY
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173'
const MAX_BODY_BYTES = 1_000_000

if (!API_KEY) {
  console.error('Defina ANTHROPIC_API_KEY antes de subir o proxy.')
  process.exit(1)
}

const server = createServer(async (request, response) => {
  const cors = {
    'access-control-allow-origin': ORIGIN,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors).end()
    return
  }

  if (request.method !== 'POST' || !request.url?.startsWith('/api/gerar')) {
    response.writeHead(404, cors).end('não encontrado')
    return
  }

  try {
    const body = await readBody(request)

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body,
    })

    const text = await upstream.text()
    response.writeHead(upstream.status, { ...cors, 'content-type': 'application/json' }).end(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    response
      .writeHead(502, { ...cors, 'content-type': 'application/json' })
      .end(JSON.stringify({ error: { message } }))
  }
})

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('corpo da requisição grande demais'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

server.listen(PORT, () => {
  console.log(`Proxy ouvindo em http://localhost:${PORT}/api/gerar`)
})
