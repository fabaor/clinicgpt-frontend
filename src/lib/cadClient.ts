import type { BuildResult, PrinterProfile } from '../types'

const BUILD_TIMEOUT_MS = 20_000

type BuildArgs = {
  code: string
  params: Record<string, number | boolean>
  printer: PrinterProfile
  density: number
}

/** Triângulos crus, 9 floats por triângulo. */
type Malha = Float32Array | null

type Pending = {
  resolve: (value: never) => void
  reject: (error: Error) => void
  timer: number
}

/**
 * Ponte com o worker que executa o código gerado. Se o código travar (um laço
 * infinito, por exemplo), matamos o worker e criamos outro — a aba continua viva.
 */
export class CadClient {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  /** Guardado para reconstruir sozinho caso o worker tenha sido reiniciado. */
  private lastBuild: BuildArgs | null = null
  private hasGeometry = false
  /** A malha importada precisa ser reenviada quando o worker é recriado. */
  private malha: Malha = null
  private malhaEnviada = false

  /**
   * Guarda a malha importada e a envia ao worker. Passe `null` para descartá-la
   * quando a peça atual deixar de ser importada.
   */
  async setMesh(positions: Malha): Promise<void> {
    this.malha = positions
    this.malhaEnviada = false
    await this.garantirMalha()
  }

  private async garantirMalha(): Promise<void> {
    if (this.malhaEnviada) return
    // Uma cópia por envio: o buffer é transferido e o original ficaria vazio.
    const copia = this.malha ? new Float32Array(this.malha) : null
    await this.send<unknown>({ type: 'mesh', positions: copia }, copia ? [copia.buffer] : [])
    this.malhaEnviada = true
  }

  async build(args: BuildArgs): Promise<BuildResult> {
    // Reenvia a malha se o worker foi recriado desde o último envio.
    if (this.malha) await this.garantirMalha()
    const result = await this.send<BuildResult>({ type: 'build', ...args })
    this.lastBuild = args
    this.hasGeometry = true
    return result
  }

  async exportStl(binary: boolean): Promise<Blob> {
    if (!this.hasGeometry) {
      if (!this.lastBuild) throw new Error('Gere uma peça antes de exportar.')
      await this.build(this.lastBuild)
    }

    const { parts } = await this.send<{ parts: Array<ArrayBuffer | string> }>({
      type: 'export',
      binary,
    })

    return new Blob(parts, {
      type: binary ? 'model/stl' : 'text/plain;charset=utf-8',
    })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.hasGeometry = false
    this.malhaEnviada = false
  }

  private send<T>(payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const worker = this.ensureWorker()
    const id = this.nextId++

    return new Promise<T>((resolve, reject) => {
      const timer = self.setTimeout(() => {
        this.pending.delete(id)
        this.restart()
        reject(
          new Error(
            'O cálculo passou de 20 s e foi interrompido. O código pode ter um laço infinito ' +
              'ou detalhamento (segments) alto demais.',
          ),
        )
      }, BUILD_TIMEOUT_MS)

      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject, timer })
      worker.postMessage({ id, ...payload }, transfer)
    })
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker

    const worker = new Worker(new URL('./cad.worker.ts', import.meta.url), { type: 'module' })

    worker.onmessage = (event: MessageEvent<{ id: number; type: string; message?: string }>) => {
      const entry = this.pending.get(event.data.id)
      if (!entry) return
      this.pending.delete(event.data.id)
      clearTimeout(entry.timer)

      if (event.data.type === 'error') {
        entry.reject(new Error(event.data.message ?? 'Falha ao construir a peça.'))
      } else {
        entry.resolve(event.data as never)
      }
    }

    worker.onerror = (event) => {
      const message = event.message || 'O worker de geometria falhou.'
      this.failAll(new Error(message))
      this.restart()
    }

    this.worker = worker
    return worker
  }

  private restart() {
    this.worker?.terminate()
    this.worker = null
    this.hasGeometry = false
    // O worker novo nasce sem a malha; o próximo build a reenvia.
    this.malhaEnviada = false
  }

  private failAll(error: Error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }
}
