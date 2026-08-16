import { createRequire } from 'node:module'
import { EXAMPLES } from '../src/data/examples.ts'

// Os pacotes do JSCAD são CommonJS; no Node puro o require dá o objeto completo
// (o bundler resolve os exports nomeados por conta própria no navegador).
const require = createRequire(import.meta.url)
const jscad = require('@jscad/modeling')
const stlSerializer = require('@jscad/stl-serializer')

const SCOPE = {
  ...jscad.primitives, ...jscad.booleans, ...jscad.transforms, ...jscad.extrusions,
  ...jscad.expansions, ...jscad.hulls, ...jscad.text, ...jscad.measurements,
  ...jscad.modifiers, ...jscad.utils,
  maths: jscad.maths, geometries: jscad.geometries, colors: jscad.colors, curves: jscad.curves,
  jscad, TAU: Math.PI * 2,
}

/** Mesmo teste de fechamento usado no worker: soma das normais ponderadas por área. */
function measureLeak(polygons) {
  let sx = 0, sy = 0, sz = 0, area = 0
  for (const p of polygons) {
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

function run(code, params) {
  const names = Object.keys(SCOPE)
  const factory = new Function(...names, `"use strict";\n${code}\n;return main;`)
  const main = factory(...names.map((n) => SCOPE[n]))
  return main(params)
}

let failures = 0
for (const example of EXAMPLES) {
  const defaults = Object.fromEntries(example.params.map((p) => [p.name, p.default]))
  for (const [caseName, params] of [
    ['defaults', defaults],
    ['no-args', undefined],
    ['mins', Object.fromEntries(example.params.map((p) => [p.name, p.type === 'boolean' ? false : p.min]))],
    ['maxs', Object.fromEntries(example.params.map((p) => [p.name, p.type === 'boolean' ? true : p.max]))],
  ]) {
    try {
      const t0 = Date.now()
      const geometry = run(example.code, params)
      const polys = jscad.geometries.geom3.toPolygons(geometry)
      const [min, max] = jscad.measurements.measureBoundingBox(geometry)
      const leak = measureLeak(polys)
      const bytes = stlSerializer.serialize({ binary: true }, geometry).reduce((s, b) => s + (b.byteLength ?? b.length), 0)
      const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((d) => d.toFixed(1)).join(' x ')
      const partes = polys.length > 20000 ? 1 : jscad.booleans.scission(geometry).length
      const aberta = leak > 1e-4
      const zForaDaMesa = Math.abs(min[2]) > 0.05
      if (aberta || zForaDaMesa || partes > 1) failures++
      const flags =
        (aberta ? ' ** MALHA ABERTA **' : '') +
        (zForaDaMesa ? ` ** minZ=${min[2].toFixed(2)} **` : '') +
        (partes > 1 ? ` ** ${partes} PEDACOS SOLTOS **` : '')
      console.log(`OK   ${example.name} [${caseName}] ${dims} mm | ${polys.length} pol | vazamento ${leak.toExponential(1)}${flags} | ${(bytes / 1024).toFixed(0)} KB | ${Date.now() - t0}ms`)
    } catch (error) {
      failures++
      console.log(`FALHA ${example.name} [${caseName}]: ${error.message}`)
    }
  }
}
console.log(failures === 0 ? '\nTodos os exemplos passaram.' : `\n${failures} caso(s) com problema.`)
process.exit(failures === 0 ? 0 : 1)
