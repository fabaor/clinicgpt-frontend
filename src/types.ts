export type ParamSpec = {
  /** Identificador usado dentro do código gerado (params.<name>). */
  name: string
  /** Rótulo exibido na interface, em português. */
  label: string
  type: 'number' | 'boolean'
  default: number | boolean
  min?: number
  max?: number
  step?: number
  unit?: string
}

export type CadModel = {
  /** Nome curto da peça, em português. */
  name: string
  /** O que a peça é e como foi construída. */
  summary: string
  /** Observações de impressão (orientação, suportes, tolerâncias). */
  printNotes: string
  params: ParamSpec[]
  /** Corpo do módulo JS que define `function main(params)`. */
  code: string
}

export type BuildStats = {
  /** Dimensões da caixa envolvente em mm: [x, y, z]. */
  dimensions: [number, number, number]
  /** Canto inferior da caixa envolvente em mm. */
  min: [number, number, number]
  volumeMm3: number
  triangles: number
  /** Massa estimada em gramas, para a densidade do filamento escolhido. */
  gramsEstimate: number
}

export type BuildWarning = {
  level: 'erro' | 'atencao' | 'info'
  message: string
}

export type BuildResult = {
  positions: Float32Array
  stats: BuildStats
  warnings: BuildWarning[]
}

export type PrinterProfile = {
  id: string
  label: string
  /** Volume de impressão em mm: [x, y, z]. */
  bed: [number, number, number]
  nozzle: number
}

/** Blocos no formato que a Messages API espera. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }

export type ChatTurn = {
  role: 'user' | 'assistant'
  /** Texto puro, ou blocos quando o turno leva imagem junto. */
  content: string | ContentBlock[]
}
