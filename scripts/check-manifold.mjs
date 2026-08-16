/**
 * Trava as operações que o BSP do JSCAD não conseguia fazer.
 *
 * Cada caso aqui produzia malha aberta e peça em pedaços antes da troca do
 * kernel de booleanos para o Manifold. Se algum voltar a falhar, a troca
 * regrediu — e o sintoma no app seria peça que não fatia.
 *
 * Uso: node --experimental-strip-types scripts/check-manifold.mjs
 */
import { createRequire } from 'node:module'
import ManifoldModule from 'manifold-3d'
import {
  engrenagemReta,
  furoRoscado,
  parafusoSextavado,
  porcaRoscada,
  roscaMetrica,
} from '../src/lib/standardParts.ts'
import { createManifoldOps } from '../src/lib/manifoldOps.ts'

const require = createRequire(import.meta.url)
const jscad = require('@jscad/modeling')
const { cuboid, cylinder, sphere } = jscad.primitives
const { translate, rotateY } = jscad.transforms

const wasm = await ManifoldModule()
wasm.setup()
const ops = createManifoldOps(wasm)

let falhas = 0

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

/**
 * @param esperado.furos quantos furos passantes a peça deve ter (genus). Pega
 *   o caso em que a operação "funciona" mas não abriu o furo que devia.
 */
function conferir(nome, construir, esperado = {}) {
  const inicio = Date.now()
  let geometria
  try {
    geometria = construir()
  } catch (erro) {
    falhas++
    console.log(`  FALHA ${nome}: ${erro.message}`)
    return
  }

  const poligonos = jscad.geometries.geom3.toPolygons(geometria)
  const fuga = vazamento(poligonos)
  const partes = ops.contarPartes(geometria)
  const volume = jscad.measurements.measureVolume(geometria)

  const problemas = []
  if (fuga > 1e-4) problemas.push(`malha aberta (${fuga.toExponential(1)})`)
  if (partes !== 1) problemas.push(`${partes} pedaços soltos`)
  if (volume <= 0) problemas.push(`volume ${volume.toFixed(1)}`)
  if (esperado.volumeMin && volume < esperado.volumeMin) {
    problemas.push(`volume ${volume.toFixed(0)} abaixo do mínimo ${esperado.volumeMin}`)
  }

  if (problemas.length > 0) {
    falhas++
    console.log(`  FALHA ${nome}: ${problemas.join(', ')}`)
  } else {
    console.log(
      `  ok    ${nome}: ${poligonos.length} tri, volume ${volume.toFixed(0)} mm³, ${Date.now() - inicio}ms`,
    )
  }
}

console.log('\nBooleanos com rosca — todos falhavam com o BSP do JSCAD')

conferir('furo roscado M8 num bloco', () =>
  ops.subtract(
    translate([0, 0, 6], cuboid({ size: [24, 24, 12] })),
    furoRoscado({ tamanho: 8, profundidade: 12 }),
  ),
)

conferir('flange unida a haste roscada', () =>
  ops.union(
    translate([0, 0, 2], cylinder({ radius: 9, height: 4, segments: 48 })),
    translate([0, 0, 3.5], roscaMetrica({ diametro: 8, altura: 20 })),
  ),
)

conferir('parafuso M10 com furo transversal', () =>
  ops.subtract(
    parafusoSextavado({ diametro: 10, comprimento: 30 }),
    translate([0, 0, 30], rotateY(Math.PI / 2, cylinder({ radius: 1.2, height: 30, segments: 24 }))),
  ),
)

conferir('porca M8 com chanfro', () =>
  ops.intersect(
    porcaRoscada({ tamanho: 8 }),
    translate([0, 0, 3.25], sphere({ radius: 9, segments: 48 })),
  ),
)

console.log('\nCadeias longas de booleanos')

conferir('bloco com 12 furos encadeados', () => {
  let peca = translate([0, 0, 5], cuboid({ size: [80, 80, 10] }))
  for (let i = 0; i < 12; i++) {
    const angulo = (Math.PI * 2 * i) / 12
    peca = ops.subtract(
      peca,
      translate(
        [30 * Math.cos(angulo), 30 * Math.sin(angulo), 5],
        cylinder({ radius: 3, height: 14, segments: 32 }),
      ),
    )
  }
  return peca
}, { volumeMin: 50000 })

conferir('engrenagem furada com rasgo de chaveta', () =>
  ops.subtract(
    engrenagemReta({ modulo: 2, dentes: 24, largura: 10 }),
    translate([0, 0, 5], cylinder({ radius: 4, height: 12, segments: 48 })),
    translate([0, 4, 5], cuboid({ size: [2, 2, 12] })),
  ),
)

console.log('\nCortes coplanares — a armadilha clássica do BSP')

conferir('corte encostando exatamente na face', () =>
  ops.subtract(
    translate([0, 0, 5], cuboid({ size: [20, 20, 10] })),
    // Topo do cortador exatamente no topo do bloco: coplanar de propósito.
    translate([0, 0, 7.5], cylinder({ radius: 4, height: 5, segments: 48 })),
  ),
)

conferir('dois blocos apenas encostados', () =>
  ops.union(
    translate([0, 0, 5], cuboid({ size: [20, 20, 10] })),
    translate([0, 0, 15], cuboid({ size: [20, 20, 10] })),
  ),
)

ops.liberar()

console.log(
  falhas === 0
    ? '\nTodas as operações que o BSP não fazia agora fecham corretamente.'
    : `\n${falhas} operação(ões) falharam.`,
)
process.exit(falhas === 0 ? 0 : 1)
