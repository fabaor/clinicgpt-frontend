/**
 * Confere as peças normalizadas contra a tabela, não só se o código roda.
 * Uma rosca com o diâmetro errado por 0,3 mm compila igual e não rosqueia.
 *
 * Uso: node --experimental-strip-types scripts/check-standard-parts.mjs
 */
import { createRequire } from 'node:module'
import ManifoldModule from 'manifold-3d'
import { createManifoldOps } from '../src/lib/manifoldOps.ts'
import {
  bolsaPorca,
  engrenagemReta,
  furoInserto,
  furoParafuso,
  passoGrosso,
  porcaRoscada,
  roscaMetrica,
} from '../src/lib/standardParts.ts'

const require = createRequire(import.meta.url)
const jscad = require('@jscad/modeling')

// A contagem de partes usa o mesmo kernel do app. Com o scission do JSCAD, uma
// peça que o Manifold recusa passava como saudável — foi assim que a engrenagem
// com furo e o furo rebaixado escaparam.
const wasm = await ManifoldModule()
wasm.setup()
const ops = createManifoldOps(wasm)

let falhas = 0

function medir(geometria) {
  const [min, max] = jscad.measurements.measureBoundingBox(geometria)
  const poligonos = jscad.geometries.geom3.toPolygons(geometria)

  // Raio máximo de qualquer vértice: para peça com dentes, a caixa envolvente
  // só toca o diâmetro externo se um dente calhar de cair no eixo.
  let raioMax = 0
  for (const p of poligonos) {
    for (const v of p.vertices) raioMax = Math.max(raioMax, Math.hypot(v[0], v[1]))
  }

  return {
    min,
    max,
    dim: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    raioMax,
    volume: jscad.measurements.measureVolume(geometria),
    poligonos: poligonos.length,
    vazamento: vazamento(poligonos),
    pedacos: ops.contarPartes(geometria),
  }
}

function vazamento(poligonos) {
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
  return area === 0 ? 1 : Math.hypot(sx, sy, sz) / area
}

function conferir(nome, valor, esperado, tolerancia) {
  const ok = Math.abs(valor - esperado) <= tolerancia
  if (!ok) falhas++
  console.log(
    `  ${ok ? 'ok  ' : 'FALHA'} ${nome}: ${valor.toFixed(3)} (esperado ${esperado.toFixed(3)} ± ${tolerancia})`,
  )
}

/**
 * @param apoiada peças acabadas nascem em z=0; ferramenta de corte tem que
 *   ultrapassar a face que atravessa, então começa abaixo de propósito.
 */
function conferirSaude(nome, m, { apoiada = true } = {}) {
  if (m.vazamento > 1e-4) {
    falhas++
    console.log(`  FALHA ${nome}: malha aberta (${m.vazamento.toExponential(1)})`)
  }
  if (m.pedacos === null) {
    falhas++
    console.log(`  FALHA ${nome}: o kernel de booleanos não analisa esta malha`)
  } else if (m.pedacos > 1) {
    falhas++
    console.log(`  FALHA ${nome}: ${m.pedacos} pedaços soltos`)
  }
  if (m.volume <= 0) {
    falhas++
    console.log(`  FALHA ${nome}: volume ${m.volume.toFixed(2)} — faces invertidas`)
  }
  if (apoiada && Math.abs(m.min[2]) > 0.05) {
    falhas++
    console.log(`  FALHA ${nome}: base em z=${m.min[2].toFixed(3)}, deveria ser 0`)
  }
}

console.log('\nRosca métrica externa')
for (const [diametro, altura] of [[3, 8], [6, 12], [8, 16], [12, 20]]) {
  const inicio = Date.now()
  const m = medir(roscaMetrica({ diametro, altura }))
  console.log(` M${diametro}×${passoGrosso(diametro)} h=${altura} — ${m.poligonos} pol, ${Date.now() - inicio}ms`)
  conferir('diâmetro externo', m.raioMax * 2, diametro, 0.02)
  conferir('altura', m.dim[2], altura, 0.01)
  conferirSaude(`M${diametro}`, m)
}

console.log('\nPorca sextavada com rosca interna')
for (const [tamanho, chave, altura] of [[3, 5.5, 2.4], [6, 10, 5], [8, 13, 6.5]]) {
  const inicio = Date.now()
  const m = medir(porcaRoscada({ tamanho }))
  console.log(` M${tamanho} — ${m.poligonos} pol, ${Date.now() - inicio}ms`)
  conferir('abertura de chave', m.dim[1], chave, 0.02)
  conferir('altura', m.dim[2], altura, 0.01)
  conferirSaude(`porca M${tamanho}`, m)
}

console.log('\nPorca: a folga precisa chegar na rosca')
{
  const apertada = medir(porcaRoscada({ tamanho: 6, folga: 0.1 }))
  const folgada = medir(porcaRoscada({ tamanho: 6, folga: 0.4 }))
  if (folgada.volume >= apertada.volume) {
    falhas++
    console.log('  FALHA mais folga deveria remover mais material')
  } else {
    console.log(`  ok   folga 0,1 → ${apertada.volume.toFixed(1)} mm³ | folga 0,4 → ${folgada.volume.toFixed(1)} mm³`)
  }
}

console.log('\nEngrenagem reta')
for (const [modulo, dentes] of [[1, 12], [2, 20], [1.5, 31]]) {
  const inicio = Date.now()
  const m = medir(engrenagemReta({ modulo, dentes, largura: 8, furo: 5 }))
  const primitivo = modulo * dentes
  console.log(` módulo ${modulo}, ${dentes} dentes — primitivo ⌀${primitivo}, ${m.poligonos} pol, ${Date.now() - inicio}ms`)
  conferir('diâmetro de adendo', m.raioMax * 2, primitivo + 2 * modulo, 0.02)
  conferir('largura', m.dim[2], 8, 0.01)
  conferirSaude(`engrenagem m${modulo}`, m)
}

console.log('\nBolsa de porca (abertura de chave entre faces)')
for (const [tamanho, chave] of [[3, 5.5], [4, 7], [5, 8], [6, 10], [8, 13]]) {
  const folga = 0.2
  const m = medir(bolsaPorca({ tamanho, folga }))
  conferir(`M${tamanho} chave`, m.dim[1], chave + folga, 0.02)
  conferirSaude(`bolsa M${tamanho}`, m)
}

console.log('\nBolsa com canal de inserção')
{
  const m = medir(bolsaPorca({ tamanho: 4, folga: 0.2, canal: 12 }))
  conferirSaude('bolsa M4 com canal', m)
  if (m.dim[0] < 12) {
    falhas++
    console.log(`  FALHA canal não alongou a bolsa: ${m.dim[0].toFixed(2)} mm`)
  } else {
    console.log(`  ok   canal presente: ${m.dim[0].toFixed(2)} mm em X`)
  }
}

console.log('\nFuro de parafuso (ferramenta de corte)')
{
  const folga = 0.4
  const passante = medir(furoParafuso({ tamanho: 5, profundidade: 20 }))
  conferir('M5 passante ⌀', passante.dim[0], 5 + folga, 0.02)
  conferirSaude('furo M5 passante', passante, { apoiada: false })

  const rebaixado = medir(furoParafuso({ tamanho: 5, profundidade: 20, cabeca: 'rebaixado' }))
  conferir('M5 rebaixo ⌀', rebaixado.dim[0], 8.5 + folga, 0.02)
  conferirSaude('furo M5 rebaixado', rebaixado, { apoiada: false })
  if (rebaixado.max[2] < 20) {
    falhas++
    console.log('  FALHA o rebaixo não chega no topo do furo')
  }
}

console.log('\nFuro para inserto de latão')
for (const [tamanho, furoEsperado] of [[3, 4], [4, 5.6], [5, 6.4]]) {
  const m = medir(furoInserto({ tamanho }))
  conferir(`M${tamanho} ⌀ do furo`, m.dim[0], furoEsperado, 0.02)
  conferirSaude(`inserto M${tamanho}`, m, { apoiada: false })
}

ops.liberar()

console.log(
  falhas === 0
    ? '\nTodas as peças normalizadas conferem com a tabela.'
    : `\n${falhas} verificação(ões) falharam.`,
)
process.exit(falhas === 0 ? 0 : 1)
