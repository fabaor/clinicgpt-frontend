import ManifoldModule from 'manifold-3d'
// O `?url` faz o Vite emitir o .wasm como asset e devolver o caminho final.
// Sem isso o Emscripten procura o arquivo ao lado do bundle e não acha.
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { createManifoldOps } from './manifoldOps'
import type { ManifoldOps } from './manifoldOps'

let carregando: Promise<ManifoldOps> | null = null

/** Carrega o WASM uma vez só e reaproveita nas construções seguintes. */
export function carregarManifold(): Promise<ManifoldOps> {
  if (!carregando) {
    carregando = (async () => {
      const wasm = await (ManifoldModule as unknown as (options?: unknown) => Promise<never>)({
        locateFile: () => wasmUrl,
      })
      const modulo = wasm as unknown as { setup: () => void }
      modulo.setup()
      return createManifoldOps(wasm as never)
    })()
  }
  return carregando
}
