/**
 * Verifica a configuração que vai ao ar no Netlify: build com
 * VITE_API_PROXY_URL, campo de chave escondido e geração passando pela função
 * serverless na mesma origem.
 *
 * Uso: node scripts/check-proxy-build.mjs
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pngDeTeste, stlDeCaixa } from './fixtures.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')
const PROXY_PATH = '/api/gerar'
const MALHA_PATH = '/api/malha'
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  // Sem este, o navegador recusa a compilação em streaming do WASM.
  '.wasm': 'application/wasm',
}

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  return readdirSync(root)
    .filter((entry) => entry.startsWith('chromium-'))
    .map((entry) => join(root, entry, 'chrome-linux', 'chrome'))
    .filter(existsSync)
    .at(-1)
}

const RESPOSTA = {
  content: [
    {
      type: 'tool_use',
      name: 'emitir_modelo',
      input: {
        name: 'Anel de teste',
        summary: 'Cilindro vazado.',
        printNotes: 'Sem suportes.',
        params: [
          { name: 'diametro', label: 'Diâmetro', type: 'number', default: 40, min: 10, max: 90, step: 1, unit: 'mm' },
          { name: 'altura', label: 'Altura', type: 'number', default: 10, min: 2, max: 40, step: 0.5, unit: 'mm' },
        ],
        code: `function main(params = {}) {
  const { diametro = 40, altura = 10 } = params
  return translate([0, 0, altura / 2], subtract(
    cylinder({ radius: diametro / 2, height: altura, segments: 64 }),
    cylinder({ radius: diametro / 4, height: altura + 2, segments: 48 })
  ))
}`,
      },
    },
  ],
}

console.log('build com VITE_API_PROXY_URL...')
execFileSync('npx', ['vite', 'build'], {
  cwd: ROOT,
  env: { ...process.env, VITE_API_PROXY_URL: PROXY_PATH },
  stdio: 'pipe',
})

const CODIGO = 'codigo-de-teste'
let codigoRecebido = null

// Faz o papel do serviço de imagem-para-3D: a tarefa fica "gerando" numa
// consulta e conclui na seguinte, para exercitar o laço de espera de verdade.
const MODELO_STL = stlDeCaixa(10, 20, 30)
let consultasMalha = 0
const acoesMalha = []

const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname))

  // Faz o papel da função serverless do Netlify, portão de acesso incluído.
  if (path === PROXY_PATH) {
    codigoRecebido = request.headers['x-codigo-acesso'] ?? null
    if (codigoRecebido !== CODIGO) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Código de acesso inválido.' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(RESPOSTA))
    return
  }

  if (path === MALHA_PATH) {
    const corpo = JSON.parse(await lerCorpo(request))
    acoesMalha.push(corpo.acao)

    if (request.headers['x-codigo-acesso'] !== CODIGO) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Código de acesso inválido.' } }))
      return
    }

    if (corpo.acao === 'criar') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ tarefa: 'tarefa-1', provedor: 'ServicoDeTeste' }))
      return
    }
    if (corpo.acao === 'status') {
      consultasMalha++
      const pronto = consultasMalha >= 2
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify(
          pronto
            ? { estado: 'success', progresso: 100, url: 'https://exemplo.tripo3d.ai/modelo.stl' }
            : { estado: 'running', progresso: 45 },
        ),
      )
      return
    }
    if (corpo.acao === 'baixar') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(MODELO_STL)
      return
    }
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'ação desconhecida' } }))
    return
  }

  try {
    const file = join(DIST, path === '/' ? 'index.html' : path)
    const body = await readFile(file)
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404).end('nao encontrado')
  }
})

function lerCorpo(request) {
  return new Promise((resolve, reject) => {
    const pedacos = []
    request.on('data', (pedaco) => pedacos.push(pedaco))
    request.on('end', () => resolve(Buffer.concat(pedacos).toString('utf8')))
    request.on('error', reject)
  })
}

await new Promise((resolve) => server.listen(0, resolve))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage()

const problems = []
page.on('console', (message) => {
  if (message.type() !== 'error') return
  // O teste do código errado provoca um 401 de propósito; o navegador registra
  // todo recurso que falha, e essa entrada não é defeito.
  if (/Failed to load resource.*401/.test(message.text())) return
  problems.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

try {
  await page.goto(base, { waitUntil: 'networkidle' })

  // Em modo proxy a chave da API não aparece: quem paga é o dono do site.
  if ((await page.getByPlaceholder('sk-ant-...').count()) !== 0) {
    throw new Error('o campo de chave da API continua visível em modo proxy')
  }
  console.log('  campo de chave da API ausente')

  // Sem código de acesso, a função recusa.
  await page.locator('#instrucao').fill('um anel de 40 mm')
  await page.getByPlaceholder('código do site').fill('errado')
  await page.getByRole('button', { name: 'Ajustar peça' }).click()
  await page.locator('.prompt .alert--erro').waitFor({ timeout: 15000 })
  const recusa = await page.locator('.prompt .alert--erro').innerText()
  if (!/c[óo]digo de acesso/i.test(recusa)) {
    throw new Error(`esperava recusa por código inválido, veio: ${recusa}`)
  }
  console.log(`  código errado barrado: "${recusa.trim()}"`)

  await page.getByPlaceholder('código do site').fill(CODIGO)
  await page.getByRole('button', { name: 'Ajustar peça' }).click()

  await page.waitForFunction(
    () => document.querySelector('.stage__title')?.textContent === 'Anel de teste',
    { timeout: 20000 },
  )
  await page.waitForTimeout(1200)
  console.log('  peça gerada pela função serverless')

  if (codigoRecebido !== CODIGO) {
    throw new Error(`a função não recebeu o código de acesso via ${PROXY_PATH}`)
  }

  const dimensoes = await page.locator('.metric', { hasText: 'Dimensões' }).locator('dd').innerText()
  console.log(`  dimensões: ${dimensoes.replace(/\s+/g, ' ')}`)
  if (!dimensoes.includes('40')) throw new Error(`dimensão inesperada: ${dimensoes}`)

  // Foto → malha generativa, com o serviço mockado. Prova o ciclo completo:
  // criar tarefa, esperar a fila, baixar os bytes e importar no pipeline.
  await page.setInputFiles('.anexos__input', {
    name: 'objeto.png',
    mimeType: 'image/png',
    buffer: pngDeTeste(),
  })
  await page.locator('.anexo img').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Gerar malha 3D' }).click()

  // O botão precisa mostrar andamento enquanto a tarefa roda.
  await page.waitForFunction(
    () => /gerando|na fila|enviando|baixando/i.test(document.body.textContent ?? ''),
    { timeout: 15000 },
  )
  console.log('  andamento exibido durante a geração')

  await page.waitForFunction(
    () => document.querySelector('.stage__title')?.textContent?.startsWith('Malha de'),
    { timeout: 60000 },
  )
  await page.waitForTimeout(1500)

  const ciclo = ['criar', 'status', 'status', 'baixar']
  if (ciclo.some((acao, i) => acoesMalha[i] !== acao)) {
    throw new Error(`ciclo inesperado: ${acoesMalha.join(' → ')}`)
  }
  console.log(`  ciclo do serviço: ${acoesMalha.join(' → ')}`)

  const medidas = await page.locator('.metric', { hasText: 'Dimensões' }).locator('dd').innerText()
  console.log(`  malha gerada: ${medidas.replace(/\s+/g, ' ')}`)
  // A caixa 10×20×30 vem em Y-para-cima; convertida fica 10 × 30 × 20, e a
  // altura alvo de 60 mm triplica tudo: 30 × 90 × 60.
  const [mx, my, mz] = medidas.split('×').map((valor) => parseFloat(valor.replace(',', '.')))
  if (Math.abs(mx - 30) > 2 || Math.abs(my - 90) > 2 || Math.abs(mz - 60) > 2) {
    throw new Error(`esperava ~30 × 90 × 60 após converter e escalar, veio ${mx} × ${my} × ${mz}`)
  }

  if (problems.length > 0) throw new Error(`erros no console:\n${problems.join('\n')}`)

  console.log('\nBuild de produção (modo proxy) verificado.')
} catch (error) {
  console.error(`\nFALHOU: ${error.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
