/**
 * Ensaio de aceitação: gera peças reais, mede o encaixe entre elas e escreve os
 * STLs em `saida/`. Serve para conferir na mão o que os testes automatizados
 * afirmam — se o parafuso rosqueia na porca, se as engrenagens engrenam.
 *
 * Uso: node --experimental-strip-types scripts/demo.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ManifoldModule from 'manifold-3d'
import { engrenagemReta, parafusoSextavado, porcaRoscada, passoGrosso } from '../src/lib/standardParts.ts'
import { createManifoldOps } from '../src/lib/manifoldOps.ts'

const require = createRequire(import.meta.url)
const jscad = require('@jscad/modeling')
const stlSerializer = require('@jscad/stl-serializer')

const wasm = await ManifoldModule()
wasm.setup()
const ops = createManifoldOps(wasm)

const SAIDA = join(fileURLToPath(new URL('..', import.meta.url)), 'saida')
mkdirSync(SAIDA, { recursive: true })

function salvar(nome, geometria) {
  const partes = stlSerializer.serialize({ binary: true }, geometria)
  const bytes = Buffer.concat(partes.map((parte) => Buffer.from(parte)))
  writeFileSync(join(SAIDA, nome), bytes)
  const triangulos = jscad.geometries.geom3.toPolygons(geometria).length
  return { nome, kb: (bytes.length / 1024).toFixed(0), triangulos }
}

/** Raios dos vértices num intervalo de altura — é como se mede uma rosca. */
function raios(geometria, zMin, zMax, filtro = () => true) {
  let menor = Infinity
  let maior = 0
  for (const poligono of jscad.geometries.geom3.toPolygons(geometria)) {
    for (const [x, y, z] of poligono.vertices) {
      if (z < zMin || z > zMax) continue
      const r = Math.hypot(x, y)
      if (!filtro(r)) continue
      menor = Math.min(menor, r)
      maior = Math.max(maior, r)
    }
  }
  return { menor, maior }
}

const D = 8
const PASSO = passoGrosso(D)
const FOLGA = 0.25

console.log(`\n=== Parafuso M${D}×${PASSO} e porca correspondente ===\n`)

const parafuso = parafusoSextavado({ diametro: D, comprimento: 25, alturaCabeca: 5.5 })
const porca = porcaRoscada({ tamanho: D, folga: FOLGA })

// Rosca do parafuso: acima da cabeça. Rosca da porca: tudo abaixo do apótema.
const apotema = 13 / 2
const rosca = raios(parafuso, 7, 29)
const interno = raios(porca, 0.5, 6, (r) => r < apotema - 0.2)

console.log(`Parafuso  crista ⌀${(rosca.maior * 2).toFixed(3)}  raiz ⌀${(rosca.menor * 2).toFixed(3)}`)
console.log(`Porca     crista ⌀${(interno.menor * 2).toFixed(3)}  vale ⌀${(interno.maior * 2).toFixed(3)}`)

// Para rosquear: a crista da porca tem que passar por cima da raiz do parafuso,
// e a crista do parafuso tem que caber dentro do vale da porca.
const folgaRaiz = interno.menor - rosca.menor
const folgaCrista = interno.maior - rosca.maior
const rosqueia = folgaRaiz > 0.05 && folgaCrista > 0.05

console.log(`\nFolga na raiz    ${folgaRaiz.toFixed(3)} mm  (crista da porca sobre a raiz do parafuso)`)
console.log(`Folga na crista  ${folgaCrista.toFixed(3)} mm  (crista do parafuso dentro do vale da porca)`)
console.log(rosqueia ? '\n=> ROSQUEIA: há folga radial nos dois contatos.' : '\n=> INTERFERE: as roscas se cruzam.')

console.log(`\nDiâmetro nominal conferido: ${(rosca.maior * 2).toFixed(3)} mm (esperado ${D})`)

console.log('\n=== Par de engrenagens módulo 2 ===\n')

const MODULO = 2
const A = 20
const B = 30
const distanciaCentros = (MODULO * (A + B)) / 2

const engrenagemA = ops.subtract(
  engrenagemReta({ modulo: MODULO, dentes: A, largura: 8, folga: 0.1 }),
  jscad.transforms.translate([0, 0, 4], jscad.primitives.cylinder({ radius: 3, height: 10, segments: 48 })),
)
const engrenagemB = ops.subtract(
  engrenagemReta({ modulo: MODULO, dentes: B, largura: 8, folga: 0.1 }),
  jscad.transforms.translate([0, 0, 4], jscad.primitives.cylinder({ radius: 3, height: 10, segments: 48 })),
)

const raioA = raios(engrenagemA, 0, 8).maior
const raioB = raios(engrenagemB, 0, 8).maior
const somaAdendos = raioA + raioB

console.log(`Engrenagem A: ${A} dentes, ⌀ externo ${(raioA * 2).toFixed(2)} mm`)
console.log(`Engrenagem B: ${B} dentes, ⌀ externo ${(raioB * 2).toFixed(2)} mm`)
console.log(`Distância entre centros: ${distanciaCentros} mm (módulo × (${A} + ${B}) ÷ 2)`)
console.log(`Soma dos raios de adendo: ${somaAdendos.toFixed(2)} mm`)
console.log(
  somaAdendos > distanciaCentros
    ? '=> ENGRENAM: os dentes de uma alcançam os vãos da outra.'
    : '=> NÃO ALCANÇAM: haveria folga entre os dentes.',
)

console.log('\n=== Verificação de malha e arquivos ===\n')

const pecas = [
  ['parafuso-m8x25.stl', parafuso],
  ['porca-m8.stl', porca],
  ['engrenagem-20d.stl', engrenagemA],
  ['engrenagem-30d.stl', engrenagemB],
]

for (const [nome, geometria] of pecas) {
  const poligonos = jscad.geometries.geom3.toPolygons(geometria)
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
  const [min, max] = jscad.measurements.measureBoundingBox(geometria)
  const info = salvar(nome, geometria)
  const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    .map((d) => d.toFixed(1))
    .join(' × ')
  const massa = ((jscad.measurements.measureVolume(geometria) / 1000) * 1.24).toFixed(1)

  console.log(
    `${nome.padEnd(22)} ${dims.padEnd(22)} mm | ${info.triangulos.toString().padStart(6)} tri | ` +
      `vazamento ${fuga.toExponential(1)} | ${ops.contarPartes(geometria) ?? '?'} peça | ${massa} g | ${info.kb} KB`,
  )
}

console.log('\n=== Montagem para conferir a olho ===\n')

// A porca sobe um múltiplo exato do passo. Qualquer outra altura deixa as duas
// hélices fora de fase e os sólidos se atravessam — foi assim na primeira
// tentativa, e o aviso de malha não-analisável do app pegou.
const passosDeSubida = 12
const alturaPorca = passosDeSubida * PASSO
console.log(`Porca a ${alturaPorca} mm = ${passosDeSubida} passos exatos (fora disso as hélices se cruzam)`)

const conjunto = jscad.geometries.geom3.create([
  ...jscad.geometries.geom3.toPolygons(parafuso),
  ...jscad.geometries.geom3.toPolygons(jscad.transforms.translate([0, 0, alturaPorca], porca)),
])
const partesConjunto = ops.contarPartes(conjunto)
console.log(`Conjunto parafuso+porca: ${partesConjunto ?? 'não analisável'} peças separadas (esperado 2)`)

const cena = jscad.geometries.geom3.create([
  ...jscad.geometries.geom3.toPolygons(jscad.transforms.translate([-30, 40, 0], conjunto)),
  ...jscad.geometries.geom3.toPolygons(jscad.transforms.translate([-25, -20, 0], engrenagemA)),
  ...jscad.geometries.geom3.toPolygons(
    jscad.transforms.translate(
      [-25 + distanciaCentros, -20, 0],
      // Meio passo angular: põe dente da grande no vão da pequena.
      jscad.transforms.rotateZ(Math.PI / B, engrenagemB),
    ),
  ),
])
const infoCena = salvar('montagem.stl', cena)
console.log(`montagem.stl: ${infoCena.triangulos} triângulos, ${infoCena.kb} KB`)

ops.liberar()
console.log(`\nArquivos em ${SAIDA}\n`)
