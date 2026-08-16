import { jscad } from './jscadRuntime.ts'
import type { Geom3 } from './jscadRuntime.ts'

/**
 * Booleanos apoiados no Manifold em vez do BSP do JSCAD.
 *
 * O BSP rasga a malha em geometria densa — hélice de rosca é o caso extremo,
 * mas casos mais brandos viravam os avisos de "malha aberta" que o app mostrava.
 * O Manifold trabalha com malha indexada e devolve sólido fechado por
 * construção, então a classe inteira de problema desaparece.
 *
 * O código gerado não muda: `union`, `subtract` e `intersect` continuam com a
 * mesma assinatura do JSCAD e são apenas substituídos no escopo do worker.
 */

type ManifoldObj = {
  status(): string
  genus(): number
  volume(): number
  getMesh(): { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }
  decompose(): ManifoldObj[]
  delete(): void
}

type ManifoldWasm = {
  Manifold: {
    new (mesh: unknown): ManifoldObj
    union(a: ManifoldObj, b: ManifoldObj): ManifoldObj
    difference(a: ManifoldObj, b: ManifoldObj): ManifoldObj
    intersection(a: ManifoldObj, b: ManifoldObj): ManifoldObj
  }
  Mesh: new (options: {
    numProp: number
    vertProperties: Float32Array
    triVerts: Uint32Array
  }) => { merge(): boolean }
  setup(): void
}

type Geometry = Geom3 | ReturnType<typeof jscad.primitives.rectangle>

export type ManifoldOps = {
  union: (...args: unknown[]) => Geometry
  subtract: (...args: unknown[]) => Geometry
  intersect: (...args: unknown[]) => Geometry
  /**
   * Quantos sólidos desconexos a peça tem, ou `null` quando o kernel não
   * consegue analisar a malha — auto-intersecção ou superfície aberta.
   */
  contarPartes: (geom: Geom3) => number | null
  /** Libera tudo que foi alocado no WASM. Chame ao fim de cada construção. */
  liberar: () => void
}

export function createManifoldOps(wasm: ManifoldWasm): ManifoldOps {
  const { Manifold, Mesh } = wasm

  // Tudo que passa pelo WASM precisa ser liberado à mão. Guardamos as alças da
  // construção corrente e soltamos todas de uma vez no fim.
  const vivos = new Set<ManifoldObj>()
  // Evita reconverter em cadeias de booleanos, e mantém a peça no formato
  // indexado do Manifold entre uma operação e a seguinte.
  let cache = new WeakMap<object, ManifoldObj>()

  function registrar(objeto: ManifoldObj): ManifoldObj {
    vivos.add(objeto)
    return objeto
  }

  function paraManifold(geom: Geom3): ManifoldObj {
    const guardado = cache.get(geom as object)
    if (guardado) return guardado

    const poligonos = jscad.geometries.geom3.toPolygons(geom) as Array<{ vertices: number[][] }>
    const indicePorVertice = new Map<string, number>()
    const vertices: number[] = []
    const triangulos: number[] = []

    // Solda vértices coincidentes: o JSCAD guarda cada polígono com a própria
    // cópia, e o Manifold exige malha indexada para saber que é fechada.
    const indiceDe = (v: number[]) => {
      const chave = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`
      let indice = indicePorVertice.get(chave)
      if (indice === undefined) {
        indice = vertices.length / 3
        indicePorVertice.set(chave, indice)
        vertices.push(v[0], v[1], v[2])
      }
      return indice
    }

    for (const poligono of poligonos) {
      const vs = poligono.vertices
      const primeiro = indiceDe(vs[0])
      for (let i = 2; i < vs.length; i++) {
        triangulos.push(primeiro, indiceDe(vs[i - 1]), indiceDe(vs[i]))
      }
    }

    const mesh = new Mesh({
      numProp: 3,
      vertProperties: new Float32Array(vertices),
      triVerts: new Uint32Array(triangulos),
    })
    mesh.merge()

    const objeto = registrar(new Manifold(mesh))
    cache.set(geom as object, objeto)
    return objeto
  }

  function paraJscad(objeto: ManifoldObj): Geom3 {
    const mesh = objeto.getMesh()
    const poligonos = []

    for (let t = 0; t < mesh.triVerts.length; t += 3) {
      const vertices: Array<[number, number, number]> = []
      for (let k = 0; k < 3; k++) {
        const base = mesh.triVerts[t + k] * mesh.numProp
        vertices.push([
          mesh.vertProperties[base],
          mesh.vertProperties[base + 1],
          mesh.vertProperties[base + 2],
        ])
      }
      poligonos.push(jscad.geometries.poly3.create(vertices))
    }

    const geom = jscad.geometries.geom3.create(poligonos) as Geom3
    cache.set(geom as object, objeto)
    return geom
  }

  /** JSCAD aceita listas aninhadas nos booleanos; mantemos o mesmo contrato. */
  function achatar(args: unknown[]): Geometry[] {
    return args.flat(Infinity as 1) as Geometry[]
  }

  function ehSolido(item: Geometry): boolean {
    return jscad.geometries.geom3.isA(item)
  }

  /**
   * 2D continua no JSCAD: o BSP dá conta de polígono plano sem dificuldade, e
   * assim `extrudeLinear(subtract(perfil, rasgo))` segue funcionando igual.
   */
  function operar(
    nome: 'union' | 'subtract' | 'intersect',
    args: unknown[],
  ): Geometry {
    const entradas = achatar(args)
    if (entradas.length === 0) throw new Error(`${nome}() precisa de pelo menos uma geometria.`)
    if (entradas.length === 1) return entradas[0]
    if (!entradas.every(ehSolido)) {
      // Geometria 2D (ou mistura): o BSP dá conta de polígono plano sem
      // dificuldade, e é o que mantém `extrudeLinear(subtract(...))` funcionando.
      const plano = jscad.booleans[nome] as (...itens: unknown[]) => Geometry
      return plano(...entradas)
    }

    const solidos = entradas as Geom3[]
    let acumulado = paraManifold(solidos[0])

    for (let i = 1; i < solidos.length; i++) {
      const proximo = paraManifold(solidos[i])
      acumulado = registrar(
        nome === 'union'
          ? Manifold.union(acumulado, proximo)
          : nome === 'subtract'
            ? Manifold.difference(acumulado, proximo)
            : Manifold.intersection(acumulado, proximo),
      )
    }

    return paraJscad(acumulado)
  }

  return {
    union: (...args) => operar('union', args),
    subtract: (...args) => operar('subtract', args),
    intersect: (...args) => operar('intersect', args),

    contarPartes: (geom) => {
      try {
        const partes = paraManifold(geom).decompose()
        const total = partes.length
        for (const parte of partes) parte.delete()
        return Math.max(1, total)
      } catch {
        // Malha que o Manifold recusa não é "uma peça saudável": é uma peça que
        // não dá para analisar. Devolver 1 aqui viraria falso alívio.
        return null
      }
    },

    liberar: () => {
      for (const objeto of vivos) {
        try {
          objeto.delete()
        } catch {
          /* já liberado pelo WASM; nada a fazer */
        }
      }
      vivos.clear()
      // O cache aponta para alças que acabaram de morrer; recriá-lo é o que
      // impede uma construção seguinte de reusar ponteiro liberado.
      cache = new WeakMap()
    },
  }
}
