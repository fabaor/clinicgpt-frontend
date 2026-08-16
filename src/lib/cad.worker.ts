/// <reference lib="webworker" />
import stlSerializerModule from '@jscad/stl-serializer'
import { jscad } from './jscadRuntime'
import { carregarManifold } from './manifoldRuntime'
import { STANDARD_PARTS } from './standardParts'
import type { ManifoldOps } from './manifoldOps'
import type { BuildStats, BuildWarning, PrinterProfile } from '../types'

const stlSerializer = ((stlSerializerModule as { default?: typeof stlSerializerModule })
  .default ?? stlSerializerModule) as typeof stlSerializerModule

import type { Geom3 } from './jscadRuntime'

type BuildRequest = {
  type: 'build'
  id: number
  code: string
  params: Record<string, number | boolean>
  printer: PrinterProfile
  density: number
}

type MeshRequest = {
  type: 'mesh'
  id: number
  /** Triângulos crus, 9 floats por triângulo. Nulo descarta a malha guardada. */
  positions: Float32Array | null
}

type ExportRequest = {
  type: 'export'
  id: number
  binary: boolean
}

type Request = BuildRequest | ExportRequest | MeshRequest

/** Última peça construída, guardada para exportar sem recalcular. */
let current: Geom3 | null = null

/**
 * Malha importada de fora, convertida uma vez só. O código gerado a alcança
 * chamando `malhaImportada()` — assim a peça importada anda pelo mesmo caminho
 * de qualquer outra: parâmetros, booleanos, verificações e exportação.
 */
let malha: Geom3 | null = null

/** Booleanos do Manifold, prontos depois que o WASM carrega. */
let ops: ManifoldOps | null = null

/** Nomes da API JSCAD injetados no escopo do código gerado. */
const SCOPE: Record<string, unknown> = {
  ...jscad.primitives,
  ...jscad.booleans,
  ...jscad.transforms,
  ...jscad.extrusions,
  ...jscad.expansions,
  ...jscad.hulls,
  ...jscad.text,
  ...jscad.measurements,
  ...jscad.modifiers,
  ...jscad.utils,
  ...STANDARD_PARTS,
  maths: jscad.maths,
  geometries: jscad.geometries,
  colors: jscad.colors,
  curves: jscad.curves,
  jscad,
  TAU: Math.PI * 2,
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    if (!ops) ops = await carregarManifold()
    if (request.type === 'build') handleBuild(request, ops)
    else if (request.type === 'mesh') handleMesh(request)
    else handleExport(request)
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function handleBuild(request: BuildRequest, ops: ManifoldOps) {
  try {
    const geometry = evaluate(request.code, request.params, ops)
    current = geometry

    const polygons = jscad.geometries.geom3.toPolygons(geometry)
    if (polygons.length === 0) {
      throw new Error('O código rodou mas não produziu nenhum sólido.')
    }

    const positions = triangulate(polygons)
    const stats = measure(geometry, positions.length / 9, request.density)
    const warnings = inspect(geometry, stats, polygons, request.printer, ops)

    self.postMessage({ type: 'built', id: request.id, positions, stats, warnings }, [positions.buffer])
  } finally {
    // O WASM não tem coletor de lixo: o que foi alocado nesta construção sai
    // agora, senão a memória do worker cresce a cada mexida num parâmetro.
    ops.liberar()
  }
}

function handleMesh(request: MeshRequest) {
  malha = request.positions ? geometriaDeTriangulos(request.positions) : null
  self.postMessage({ type: 'meshReady', id: request.id })
}

/** Triângulos crus viram geom3. Vértices coincidentes são soldados adiante,
 * na conversão para o Manifold — aqui só montamos os polígonos. */
function geometriaDeTriangulos(positions: Float32Array): Geom3 {
  const poligonos = []
  for (let i = 0; i + 8 < positions.length; i += 9) {
    poligonos.push(
      jscad.geometries.poly3.create([
        [positions[i], positions[i + 1], positions[i + 2]],
        [positions[i + 3], positions[i + 4], positions[i + 5]],
        [positions[i + 6], positions[i + 7], positions[i + 8]],
      ]),
    )
  }
  if (poligonos.length === 0) throw new Error('A malha importada não tem triângulos.')
  return jscad.geometries.geom3.create(poligonos) as Geom3
}

function handleExport(request: ExportRequest) {
  if (!current) throw new Error('Nenhuma peça construída para exportar.')
  const parts = stlSerializer.serialize({ binary: request.binary }, current)
  self.postMessage({ type: 'exported', id: request.id, parts, binary: request.binary })
}

function evaluate(
  code: string,
  params: Record<string, number | boolean>,
  ops: ManifoldOps,
): Geom3 {
  // Os booleanos do Manifold entram por cima dos do JSCAD. O código gerado
  // continua chamando union/subtract/intersect com a mesma assinatura.
  const escopo: Record<string, unknown> = {
    ...SCOPE,
    union: ops.union,
    subtract: ops.subtract,
    intersect: ops.intersect,
    malhaImportada: () => {
      if (!malha) throw new Error('Nenhuma malha importada disponível nesta sessão.')
      return malha
    },
  }
  const names = Object.keys(escopo)
  const values = names.map((name) => escopo[name])

  // O código gerado é executado com a API JSCAD no escopo e nada mais: sem
  // import/require, sem DOM, sem rede — o worker não tem acesso a nenhum deles.
  const factory = new Function(...names, `"use strict";\n${code}\n;return main;`) as (
    ...args: unknown[]
  ) => unknown

  const main = factory(...values)
  if (typeof main !== 'function') {
    throw new Error('O código não define uma função main(params).')
  }

  const result = (main as (p: Record<string, number | boolean>) => unknown)(params)
  return asSolid(result)
}

/** Aceita um geom3 ou uma lista deles e devolve sempre um sólido único. */
function asSolid(result: unknown): Geom3 {
  if (Array.isArray(result)) {
    const solids = result.filter((item) => jscad.geometries.geom3.isA(item)) as Geom3[]
    if (solids.length === 0) throw new Error('main() não devolveu nenhum sólido 3D.')
    return solids.length === 1 ? solids[0] : jscad.booleans.union(...solids)
  }
  if (!jscad.geometries.geom3.isA(result)) {
    throw new Error(
      'main() precisa devolver um sólido 3D (geom3). Formas 2D precisam ser extrudadas.',
    )
  }
  return result as Geom3
}

type Polygon = { vertices: Array<[number, number, number] | number[]> }

/** Converte os polígonos convexos do JSCAD em triângulos (leque a partir do vértice 0). */
function triangulate(polygons: Polygon[]): Float32Array {
  let triangles = 0
  for (const polygon of polygons) triangles += Math.max(0, polygon.vertices.length - 2)

  const positions = new Float32Array(triangles * 9)
  let offset = 0

  for (const polygon of polygons) {
    const vertices = polygon.vertices
    for (let i = 2; i < vertices.length; i++) {
      const trio = [vertices[0], vertices[i - 1], vertices[i]]
      for (const vertex of trio) {
        positions[offset++] = vertex[0]
        positions[offset++] = vertex[1]
        positions[offset++] = vertex[2]
      }
    }
  }

  return positions
}

function measure(geometry: Geom3, triangles: number, density: number): BuildStats {
  const [min, max] = jscad.measurements.measureBoundingBox(geometry) as [
    [number, number, number],
    [number, number, number],
  ]
  const volumeMm3 = jscad.measurements.measureVolume(geometry)

  return {
    dimensions: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    min,
    volumeMm3,
    triangles,
    // mm³ -> cm³ -> gramas, considerando a peça 100% maciça.
    gramsEstimate: (volumeMm3 / 1000) * density,
  }
}

function inspect(
  geometry: Geom3,
  stats: BuildStats,
  polygons: Polygon[],
  printer: PrinterProfile,
  ops: ManifoldOps,
): BuildWarning[] {
  const warnings: BuildWarning[] = []
  const [x, y, z] = stats.dimensions
  const [bedX, bedY, bedZ] = printer.bed

  if (x > bedX || y > bedY || z > bedZ) {
    const rotated = y <= bedX && x <= bedY && z <= bedZ
    warnings.push({
      level: 'atencao',
      message:
        `A peça (${fmt(x)} × ${fmt(y)} × ${fmt(z)} mm) não cabe na mesa ` +
        `${bedX} × ${bedY} × ${bedZ} mm.` +
        (rotated ? ' Girando 90° no eixo Z ela cabe.' : ' Reduza as dimensões ou corte em partes.'),
    })
  }

  if (stats.volumeMm3 <= 0) {
    warnings.push({ level: 'erro', message: 'O volume calculado é zero — a peça está vazia.' })
  }

  if (Math.abs(stats.min[2]) > 0.05) {
    warnings.push({
      level: 'info',
      message:
        stats.min[2] > 0
          ? `A base está ${fmt(stats.min[2])} mm acima do plano Z=0; o fatiador vai apoiá-la na mesa.`
          : `A peça afunda ${fmt(-stats.min[2])} mm abaixo do plano Z=0.`,
    })
  }

  const leak = measureLeak(polygons)
  if (leak > 1e-4) {
    warnings.push({
      level: 'atencao',
      message:
        'A malha não fechou completamente — há furos na superfície e o fatiador pode recusar a ' +
        'peça. Costuma acontecer quando um corte encosta exatamente numa face; afastar o corte ' +
        'em 0,1 mm resolve.',
    })
  }

  const partes = countLooseParts(geometry, ops)
  if (partes > 1) {
    warnings.push({
      level: 'atencao',
      message:
        `A peça saiu em ${partes} pedaços soltos, sem ligação entre si. Normalmente é um corte ` +
        'que atravessou material demais — vale pedir para o corte parar antes de separar as partes.',
    })
  }

  if (stats.triangles > 400_000) {
    warnings.push({
      level: 'info',
      message: `Malha pesada (${stats.triangles.toLocaleString('pt-BR')} triângulos). Reduza "segments" se o fatiador travar.`,
    })
  }

  return warnings
}

/**
 * Quantos sólidos desconexos a peça tem. Mais de um quase sempre é engano: um
 * corte comeu material demais e separou as partes, o que só se descobre depois
 * de fatiar. O decompose do Manifold faz isso em tempo linear, sem o limite de
 * tamanho que o scission do JSCAD obrigava.
 */
function countLooseParts(geometry: Geom3, ops: ManifoldOps): number {
  try {
    return ops.contarPartes(geometry)
  } catch {
    return 1
  }
}

/**
 * Numa superfície fechada a soma vetorial das normais ponderadas por área é zero.
 * Um furo na malha deixa sobrando exatamente o vetor-área do pedaço que falta.
 *
 * Preferimos isso a parear arestas: o CSG do JSCAD divide faces coplanares e
 * cria T-junctions legítimas, que quebrariam o pareamento sem que a peça tenha
 * qualquer buraco de verdade.
 *
 * @returns o desequilíbrio relativo à área total (0 = fechada).
 */
function measureLeak(polygons: Polygon[]): number {
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let totalArea = 0

  for (const polygon of polygons) {
    const vertices = polygon.vertices
    const [ox, oy, oz] = vertices[0]
    for (let i = 2; i < vertices.length; i++) {
      const [ax, ay, az] = vertices[i - 1]
      const [bx, by, bz] = vertices[i]
      const ux = ax - ox
      const uy = ay - oy
      const uz = az - oz
      const vx = bx - ox
      const vy = by - oy
      const vz = bz - oz
      const cx = uy * vz - uz * vy
      const cy = uz * vx - ux * vz
      const cz = ux * vy - uy * vx
      sumX += cx
      sumY += cy
      sumZ += cz
      totalArea += Math.hypot(cx, cy, cz)
    }
  }

  if (totalArea === 0) return 1
  return Math.hypot(sumX, sumY, sumZ) / totalArea
}

function fmt(value: number): string {
  return value.toFixed(1).replace('.', ',')
}
