/**
 * Traça imagens sintéticas de geometria conhecida e confere o resultado contra
 * a área que a matemática manda. Um traçador que "roda" mas devolve contorno
 * torto passa despercebido sem isto.
 *
 * Uso: node --experimental-strip-types scripts/check-trace.mjs
 */
import { createRequire } from 'node:module'
import ManifoldModule from 'manifold-3d'
import { tracar, otsu } from '../src/lib/trace.ts'
import { modeloDaSilhueta } from '../src/lib/silhouetteModel.ts'
import { createManifoldOps } from '../src/lib/manifoldOps.ts'
import { STANDARD_PARTS } from '../src/lib/standardParts.ts'

const require = createRequire(import.meta.url)
const jscad = require('@jscad/modeling')
const wasm = await ManifoldModule()
wasm.setup()
const ops = createManifoldOps(wasm)

/** Mesmo escopo do worker: o código da silhueta roda exatamente como no app. */
const SCOPE = {
  ...jscad.primitives, ...jscad.booleans, ...jscad.transforms, ...jscad.extrusions,
  ...jscad.expansions, ...jscad.hulls, ...jscad.text, ...jscad.measurements,
  ...jscad.modifiers, ...jscad.utils, ...STANDARD_PARTS,
  maths: jscad.maths, geometries: jscad.geometries, jscad, TAU: Math.PI * 2,
  union: ops.union, subtract: ops.subtract, intersect: ops.intersect,
}

function construir(codigo, params) {
  const nomes = Object.keys(SCOPE)
  const fabrica = new Function(...nomes, `"use strict";\n${codigo}\n;return main;`)
  return fabrica(...nomes.map((n) => SCOPE[n]))(params)
}

let falhas = 0

/** Monta pixels RGBA a partir de uma função que diz se o pixel é tinta. */
function desenhar(width, height, ehTinta) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = (y * width + x) * 4
      const valor = ehTinta(x, y) ? 0 : 255
      data[base] = data[base + 1] = data[base + 2] = valor
      data[base + 3] = 255
    }
  }
  return { width, height, data }
}

/** Área do sólido: soma dos níveis pares menos os ímpares. */
function areaLiquida(contornos) {
  let total = 0
  for (const { nivel, pontos } of contornos) {
    let area = 0
    for (let i = 0; i < pontos.length; i++) {
      const [x1, y1] = pontos[i]
      const [x2, y2] = pontos[(i + 1) % pontos.length]
      area += x1 * y2 - x2 * y1
    }
    total += (nivel % 2 === 0 ? 1 : -1) * Math.abs(area / 2)
  }
  return total
}

function conferir(nome, valor, esperado, tolerancia) {
  const ok = Math.abs(valor - esperado) <= tolerancia
  if (!ok) falhas++
  console.log(
    `  ${ok ? 'ok  ' : 'FALHA'} ${nome}: ${valor.toFixed(2)} (esperado ${esperado.toFixed(2)} ± ${tolerancia})`,
  )
}

console.log('\nQuadrado sólido')
{
  // Quadrado de 100 px num campo de 200, largura alvo 200 mm → 1 px = 1 mm.
  const pixels = desenhar(200, 200, (x, y) => x >= 50 && x < 150 && y >= 50 && y < 150)
  const r = tracar(pixels, { larguraAlvo: 200, suavizacao: 0.5 })
  conferir('contornos', r.contornos.length, 1, 0)
  conferir('nível', r.contornos[0].nivel, 0, 0)
  conferir('área (mm²)', areaLiquida(r.contornos), 100 * 100, 250)
  conferir('pontos após simplificar', r.contornos[0].pontos.length, 4, 2)
}

console.log('\nAnel: furo tem que virar nível 1')
{
  const centro = 150
  const pixels = desenhar(300, 300, (x, y) => {
    const d = Math.hypot(x - centro, y - centro)
    return d <= 100 && d >= 50
  })
  const r = tracar(pixels, { larguraAlvo: 300, suavizacao: 0.4 })
  conferir('contornos', r.contornos.length, 2, 0)
  conferir('externo nível 0', r.contornos.filter((c) => c.nivel === 0).length, 1, 0)
  conferir('furo nível 1', r.contornos.filter((c) => c.nivel === 1).length, 1, 0)
  conferir('área (mm²)', areaLiquida(r.contornos), Math.PI * (100 ** 2 - 50 ** 2), 600)
}

console.log('\nIlha dentro do furo: nível 2 volta a ser material')
{
  const centro = 150
  const pixels = desenhar(300, 300, (x, y) => {
    const d = Math.hypot(x - centro, y - centro)
    return (d <= 120 && d >= 60) || d <= 30
  })
  const r = tracar(pixels, { larguraAlvo: 300, suavizacao: 0.4 })
  conferir('contornos', r.contornos.length, 3, 0)
  conferir('nível 2 presente', r.contornos.filter((c) => c.nivel === 2).length, 1, 0)
  conferir(
    'área (mm²)',
    areaLiquida(r.contornos),
    Math.PI * (120 ** 2 - 60 ** 2 + 30 ** 2),
    900,
  )
}

console.log('\nDuas formas separadas')
{
  const pixels = desenhar(300, 150, (x, y) => {
    const dentro = (cx) => Math.hypot(x - cx, y - 75) <= 40
    return dentro(70) || dentro(230)
  })
  const r = tracar(pixels, { larguraAlvo: 300, suavizacao: 0.4 })
  conferir('contornos', r.contornos.length, 2, 0)
  conferir('ambos nível 0', r.contornos.filter((c) => c.nivel === 0).length, 2, 0)
  conferir('área (mm²)', areaLiquida(r.contornos), 2 * Math.PI * 40 ** 2, 500)
}

console.log('\nForma encostada na borda ainda fecha')
{
  const pixels = desenhar(200, 200, (x, y) => x < 120 && y < 120)
  const r = tracar(pixels, { larguraAlvo: 200, suavizacao: 0.5 })
  conferir('contornos', r.contornos.length, 1, 0)
  conferir('área (mm²)', areaLiquida(r.contornos), 120 * 120, 300)
}

console.log('\nRuído fino é descartado')
{
  const pixels = desenhar(200, 200, (x, y) => {
    if (x >= 60 && x < 140 && y >= 60 && y < 140) return true
    // Poeira: pixels isolados espalhados.
    return (x * 7 + y * 13) % 977 === 0
  })
  const r = tracar(pixels, { larguraAlvo: 200, suavizacao: 0.5, areaMinima: 20 })
  conferir('só a forma grande sobra', r.contornos.length, 1, 0)
}

console.log('\nInverter troca o que é tinta')
{
  const pixels = desenhar(200, 200, (x, y) => !(x >= 50 && x < 150 && y >= 50 && y < 150))
  const r = tracar(pixels, { larguraAlvo: 200, suavizacao: 0.5, inverter: true })
  conferir('contornos', r.contornos.length, 1, 0)
  conferir('área (mm²)', areaLiquida(r.contornos), 100 * 100, 250)
}

console.log('\nOtsu acha o corte entre os dois grupos')
{
  const cinzas = new Uint8Array(1000)
  cinzas.fill(30, 0, 400)
  cinzas.fill(220, 400)
  const limiar = otsu(cinzas)
  const ok = limiar > 30 && limiar < 220
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} limiar entre os picos: ${limiar}`)
}

console.log('\nSentido anti-horário, como o polygon() do JSCAD espera')
{
  const pixels = desenhar(200, 200, (x, y) => x >= 50 && x < 150 && y >= 50 && y < 150)
  const r = tracar(pixels, { larguraAlvo: 200 })
  const pontos = r.contornos[0].pontos
  let area = 0
  for (let i = 0; i < pontos.length; i++) {
    const [x1, y1] = pontos[i]
    const [x2, y2] = pontos[(i + 1) % pontos.length]
    area += x1 * y2 - x2 * y1
  }
  const ok = area > 0
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} área com sinal positiva: ${(area / 2).toFixed(0)}`)
}

console.log('\nO código gerado constrói um sólido com o volume certo')
{
  // Anel: área conhecida, extrudado em 3 mm.
  const centro = 150
  const pixels = desenhar(300, 300, (x, y) => {
    const d = Math.hypot(x - centro, y - centro)
    return d <= 100 && d >= 50
  })
  const traco = tracar(pixels, { larguraAlvo: 300, suavizacao: 0.4 })
  const modelo = modeloDaSilhueta(traco, 'anel.png', 300)

  const espessura = 3
  const geometria = construir(modelo.code, { largura: 300, espessura, placa: 0 })
  const poligonos = jscad.geometries.geom3.toPolygons(geometria)
  const [min, max] = jscad.measurements.measureBoundingBox(geometria)
  const volume = jscad.measurements.measureVolume(geometria)

  conferir('volume (mm³)', volume, areaLiquida(traco.contornos) * espessura, 200)
  conferir('largura (mm)', max[0] - min[0], 200, 3)
  conferir('espessura (mm)', max[2] - min[2], espessura, 0.01)
  conferir('partes soltas', ops.contarPartes(geometria), 1, 0)

  let sx = 0, sy = 0, sz = 0, area = 0
  for (const p of poligonos) {
    const vs = p.vertices
    const [ox, oy, oz] = vs[0]
    for (let i = 2; i < vs.length; i++) {
      const [ax, ay, az] = vs[i - 1]
      const [bx, by, bz] = vs[i]
      const ux = ax - ox, uy = ay - oy, uz = az - oz
      const vx = bx - ox, vy = by - oy, vz = bz - oz
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
      sx += cx; sy += cy; sz += cz
      area += Math.hypot(cx, cy, cz)
    }
  }
  const fuga = area === 0 ? 1 : Math.hypot(sx, sy, sz) / area
  const fechada = fuga < 1e-4
  if (!fechada) falhas++
  console.log(`  ${fechada ? 'ok  ' : 'FALHA'} malha fechada: vazamento ${fuga.toExponential(1)}`)

  // A largura tem que responder ao slider.
  const grande = construir(modelo.code, { largura: 600, espessura, placa: 0 })
  const [gmin, gmax] = jscad.measurements.measureBoundingBox(grande)
  conferir('largura dobrada (mm)', gmax[0] - gmin[0], 400, 6)

  // Placa de fundo deve tapar o furo e apoiar a peça em z = 0.
  const comPlaca = construir(modelo.code, { largura: 300, espessura, placa: 2, margemPlaca: 3 })
  const [pmin, pmax] = jscad.measurements.measureBoundingBox(comPlaca)
  conferir('altura com placa (mm)', pmax[2] - pmin[2], espessura + 2, 0.02)
  conferir('base em z=0', pmin[2], 0, 0.02)
  conferir('placa mais larga que a peça', pmax[0] - pmin[0], 306, 4)
  conferir('partes com placa', ops.contarPartes(comPlaca), 1, 0)
}

ops.liberar()

console.log(
  falhas === 0 ? '\nTraçado confere com a geometria esperada.' : `\n${falhas} verificação(ões) falharam.`,
)
process.exit(falhas === 0 ? 0 : 1)
