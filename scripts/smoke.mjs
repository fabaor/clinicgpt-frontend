/**
 * Teste de fumaça no navegador: sobe o build, carrega a página, confere que a
 * peça é construída, que mexer num parâmetro muda as dimensões e que o download
 * do STL produz um arquivo binário válido.
 *
 * Uso: npm run build && node scripts/smoke.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const zlibSync = (buffer) => deflateSync(buffer)

/**
 * Usa o Chromium já presente em PLAYWRIGHT_BROWSERS_PATH mesmo quando a revisão
 * não é exatamente a que este Playwright baixaria. Sem isso o teste exigiria um
 * download novo a cada atualização do pacote.
 */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined

  const candidates = readdirSync(root)
    .filter((entry) => entry.startsWith('chromium-'))
    .map((entry) => join(root, entry, 'chrome-linux', 'chrome'))
    .filter((path) => existsSync(path))

  return candidates.at(-1)
}

const DIST = join(fileURLToPath(new URL('../dist', import.meta.url)))
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  // Sem este, o navegador recusa a compilação em streaming do WASM.
  '.wasm': 'application/wasm',
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
}

/** Resposta que a API devolveria: uma única chamada da ferramenta emitir_modelo. */
const FAKE_RESPONSE = {
  content: [
    {
      type: 'tool_use',
      name: 'emitir_modelo',
      input: {
        name: 'Espaçador vazado',
        summary: 'Cilindro com furo passante central.',
        printNotes: 'Imprima em pé, sem suporte.',
        params: [
          { name: 'diametro', label: 'Diâmetro externo', type: 'number', default: 30, min: 10, max: 80, step: 1, unit: 'mm' },
          { name: 'furo', label: 'Diâmetro do furo', type: 'number', default: 8, min: 2, max: 40, step: 0.5, unit: 'mm' },
          { name: 'altura', label: 'Altura', type: 'number', default: 12, min: 2, max: 60, step: 0.5, unit: 'mm' },
        ],
        code: `function main(params = {}) {
  const { diametro = 30, furo = 8, altura = 12 } = params
  const corpo = cylinder({ radius: diametro / 2, height: altura, segments: 64 })
  const passante = cylinder({ radius: furo / 2, height: altura + 2, segments: 48 })
  return translate([0, 0, altura / 2], subtract(corpo, passante))
}`,
      },
    },
  ],
}

const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname))
  const file = join(DIST, path === '/' ? 'index.html' : path)
  try {
    const body = await readFile(file)
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404).end('nao encontrado')
  }
})

await new Promise((resolve) => server.listen(0, resolve))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({
  executablePath: findChromium(),
  // O visualizador precisa de WebGL; no headless quem entrega isso é o SwiftShader.
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage()

const problems = []
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

const step = (name) => console.log(`  ${name}`)

/** PNG cinza montado à mão, com um quadrado escuro no meio para a silhueta ter o que traçar. */
function pngDeTeste() {
  const crcTabela = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTabela[n] = c >>> 0
  }
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTabela[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const bloco = (tipo, dados) => {
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados])
    const tamanho = Buffer.alloc(4)
    tamanho.writeUInt32BE(dados.length)
    const checagem = Buffer.alloc(4)
    checagem.writeUInt32BE(crc(corpo))
    return Buffer.concat([tamanho, corpo, checagem])
  }

  const lado = 64
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(lado, 0)
  ihdr.writeUInt32BE(lado, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 0 // escala de cinza

  // Quadrado escuro centrado: forma única, fechada, longe das bordas.
  const linhas = []
  for (let y = 0; y < lado; y++) {
    const linha = Buffer.alloc(lado + 1)
    linha[0] = 0 // sem filtro
    for (let x = 0; x < lado; x++) {
      const dentro = x >= 16 && x < 48 && y >= 16 && y < 48
      linha[x + 1] = dentro ? 0x20 : 0xe8
    }
    linhas.push(linha)
  }
  const comprimido = zlibSync(Buffer.concat(linhas))

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', comprimido),
    bloco('IEND', Buffer.alloc(0)),
  ])
}

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  step('página carregada')

  // A peça de exemplo precisa construir sozinha e preencher as métricas.
  const dimensions = page.locator('.metric', { hasText: 'Dimensões' }).locator('dd')
  await dimensions.waitFor({ timeout: 15000 })
  const initial = await dimensions.innerText()
  step(`dimensões iniciais: ${initial.replace(/\s+/g, ' ')}`)
  if (!/\d/.test(initial)) throw new Error('métricas vazias após a construção inicial')

  // O canvas do three.js deve estar renderizando.
  const canvas = await page.locator('.viewer canvas').boundingBox()
  if (!canvas || canvas.width < 100) throw new Error('canvas do visualizador não renderizou')
  step(`canvas ${Math.round(canvas.width)} × ${Math.round(canvas.height)}`)

  // Mexer num parâmetro tem que reconstruir e mudar as dimensões.
  const altura = page.locator('#param-altura')
  await altura.fill('150')
  await altura.dispatchEvent('change')
  await page.waitForFunction(
    (before) => {
      const cells = [...document.querySelectorAll('.metric')]
      const cell = cells.find((item) => item.textContent?.includes('Dimensões'))
      return cell && cell.querySelector('dd')?.textContent !== before
    },
    initial,
    { timeout: 15000 },
  )
  const updated = await dimensions.innerText()
  step(`após altura = 150 mm: ${updated.replace(/\s+/g, ' ')}`)
  if (!updated.includes('150')) throw new Error(`esperava 150 mm na altura, veio "${updated}"`)

  // Troca de exemplo: exercita um caminho de código diferente (extrusão + texto).
  await page.getByRole('button', { name: 'Chaveiro com nome' }).click()
  await page.waitForFunction(
    () => document.querySelector('.stage__title')?.textContent === 'Chaveiro com nome',
    { timeout: 10000 },
  )
  await page.waitForTimeout(1200)
  const keychain = await dimensions.innerText()
  step(`chaveiro: ${keychain.replace(/\s+/g, ' ')}`)

  // Download do STL binário.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.getByRole('button', { name: 'Baixar STL' }).click(),
  ])
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const stl = Buffer.concat(chunks)

  const triangles = stl.readUInt32LE(80)
  const expected = 84 + triangles * 50
  step(`${download.suggestedFilename()}: ${stl.length} bytes, ${triangles} triângulos`)
  if (stl.length !== expected) {
    throw new Error(`STL binário inconsistente: ${stl.length} bytes para ${triangles} triângulos`)
  }
  if (triangles < 100) throw new Error('STL com poucos triângulos demais para a peça')

  // Caminho da geração, com a API mockada: prova que a resposta em tool_use vira
  // parâmetros na tela e peça no visualizador.
  let corpoEnviado = null
  await page.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS })
    }
    corpoEnviado = JSON.parse(route.request().postData() ?? '{}')
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(FAKE_RESPONSE),
    })
  })

  await page.getByPlaceholder('sk-ant-...').fill('sk-ant-teste')
  await page.locator('#instrucao').fill('um espaçador de 30 mm com furo no meio')
  await page.getByRole('button', { name: 'Ajustar peça' }).click()

  await page.waitForFunction(
    () => document.querySelector('.stage__title')?.textContent === 'Espaçador vazado',
    { timeout: 20000 },
  )
  await page.waitForTimeout(1200)
  const generated = await dimensions.innerText()
  step(`gerado: ${generated.replace(/\s+/g, ' ')}`)
  if (!generated.includes('30')) throw new Error(`peça gerada com dimensão inesperada: ${generated}`)

  const sliders = await page.locator('.param__slider').count()
  step(`${sliders} parâmetros renderizados`)
  if (sliders !== 3) throw new Error(`esperava 3 parâmetros, vieram ${sliders}`)

  // Foto como especificação: o arquivo tem que virar bloco `image` na requisição.
  await page.setInputFiles('.anexos__input', {
    name: 'peca.png',
    mimeType: 'image/png',
    buffer: pngDeTeste(),
  })
  await page.locator('.anexo img').waitFor({ timeout: 10000 })
  const miniaturas = await page.locator('.anexo').count()
  step(`${miniaturas} miniatura(s) anexada(s)`)

  await page.locator('#instrucao').fill('faça uma peça como a da foto')
  await page.getByRole('button', { name: 'Ajustar peça' }).click()
  await page.waitForFunction(() => !document.querySelector('.stage__status'), { timeout: 20000 })

  const ultima = corpoEnviado?.messages?.at(-1)
  const blocos = Array.isArray(ultima?.content) ? ultima.content : []
  const imagem = blocos.find((bloco) => bloco.type === 'image')
  const texto = blocos.find((bloco) => bloco.type === 'text')

  if (!imagem) throw new Error('a requisição não levou nenhum bloco de imagem')
  if (imagem.source?.type !== 'base64') throw new Error('bloco de imagem sem source base64')
  // Reencodamos tudo para JPEG antes de enviar, mesmo tendo anexado um PNG.
  if (imagem.source.media_type !== 'image/jpeg') {
    throw new Error(`esperava image/jpeg, veio ${imagem.source.media_type}`)
  }
  if (!imagem.source.data || imagem.source.data.length < 100) {
    throw new Error('bloco de imagem sem dados')
  }
  if (blocos.indexOf(imagem) > blocos.indexOf(texto)) {
    throw new Error('a imagem deveria vir antes do texto')
  }
  step(`bloco image enviado: ${imagem.source.media_type}, ${Math.round(imagem.source.data.length * 0.75 / 1024)} KB`)

  // Anexos limpam após o envio, para a foto não grudar no próximo pedido.
  if ((await page.locator('.anexo').count()) !== 0) {
    throw new Error('as miniaturas continuaram na tela depois de gerar')
  }

  // Silhueta → extrusão: traçado local, sem chamar a API.
  await page.setInputFiles('.anexos__input', {
    name: 'logotipo.png',
    mimeType: 'image/png',
    buffer: pngDeTeste(),
  })
  await page.locator('.anexo img').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Traçar silhueta' }).click()
  await page.locator('.silhueta__previa').waitFor({ timeout: 10000 })
  await page.waitForTimeout(800)

  const resumo = await page.locator('.silhueta .hint').first().innerText()
  step(`traçado: ${resumo.replace(/\s+/g, ' ')}`)
  if (!/contorno/.test(resumo)) throw new Error(`o painel não traçou nada: "${resumo}"`)

  await page.getByRole('button', { name: 'Usar esta silhueta' }).click()
  await page.waitForFunction(
    () => document.querySelector('.stage__title')?.textContent?.startsWith('Silhueta:'),
    { timeout: 15000 },
  )
  await page.waitForTimeout(1200)

  const silhueta = await dimensions.innerText()
  step(`peça da silhueta: ${silhueta.replace(/\s+/g, ' ')}`)
  // O quadrado ocupa metade da imagem; com 60 mm de largura alvo, ~30 mm de lado.
  const [larguraSilhueta] = silhueta.split('×').map((valor) => parseFloat(valor.replace(',', '.')))
  if (!(larguraSilhueta > 20 && larguraSilhueta < 40)) {
    throw new Error(`largura da silhueta fora do esperado: ${larguraSilhueta} mm`)
  }

  // Mexer no slider de largura tem que reescalar a peça traçada.
  await page.locator('#param-largura').fill('120')
  await page.locator('#param-largura').dispatchEvent('change')
  await page.waitForFunction(
    (antes) => {
      const celula = [...document.querySelectorAll('.metric')].find((c) =>
        c.textContent?.includes('Dimensões'),
      )
      return celula && celula.querySelector('dd')?.textContent !== antes
    },
    silhueta,
    { timeout: 15000 },
  )
  const reescalada = await dimensions.innerText()
  step(`após largura = 120 mm: ${reescalada.replace(/\s+/g, ' ')}`)
  const [larguraNova] = reescalada.split('×').map((valor) => parseFloat(valor.replace(',', '.')))
  if (!(larguraNova > larguraSilhueta * 1.8)) {
    throw new Error(`a silhueta não reescalou: ${larguraSilhueta} → ${larguraNova} mm`)
  }

  if (problems.length > 0) throw new Error(`erros no console:\n${problems.join('\n')}`)

  console.log('\nTeste de fumaça passou.')
} catch (error) {
  console.error(`\nFALHOU: ${error.message}`)
  if (problems.length > 0) console.error(problems.join('\n'))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
