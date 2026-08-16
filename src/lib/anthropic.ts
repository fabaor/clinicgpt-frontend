import type { ImageAttachment } from './image'
import type { CadModel, ChatTurn, ContentBlock, ParamSpec, PrinterProfile } from '../types'
import { EMIT_TOOL, buildSystemPrompt } from './prompt'

export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5 — melhor para peças complexas' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — equilíbrio (padrão)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — mais rápido e barato' },
] as const

const DIRECT_ENDPOINT = 'https://api.anthropic.com/v1/messages'

/**
 * Se `VITE_API_PROXY_URL` estiver definido, as chamadas vão para o seu backend
 * (recomendado em produção: a chave nunca chega ao navegador). Sem isso, o
 * navegador fala direto com a API usando a chave que o usuário digitou.
 */
const PROXY_URL: string | undefined = import.meta.env.VITE_API_PROXY_URL

export const usesProxy = Boolean(PROXY_URL)

export class GenerationError extends Error {}

export type GenerateOptions = {
  instruction: string
  /** Fotos da peça, do encaixe ou do desenho, enviadas junto com a descrição. */
  images?: readonly ImageAttachment[]
  history: ChatTurn[]
  printer: PrinterProfile
  model: string
  /** Chave da API no modo direto; código de acesso do site no modo proxy. */
  credential: string
  signal?: AbortSignal
}

export async function generateModel(options: GenerateOptions): Promise<CadModel> {
  const { instruction, images = [], history, printer, model, credential, signal } = options

  if (!credential.trim()) {
    throw new GenerationError(
      usesProxy
        ? 'Informe o código de acesso do site para gerar peças novas.'
        : 'Informe sua chave da API Anthropic (começa com "sk-ant-") para gerar peças novas.',
    )
  }

  const messages = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user' as const, content: montarConteudo(instruction, images) },
  ]

  const body = {
    model,
    max_tokens: 8000,
    system: buildSystemPrompt(printer),
    tools: [EMIT_TOOL],
    tool_choice: { type: 'tool' as const, name: EMIT_TOOL.name },
    messages,
  }

  const response = await fetch(PROXY_URL ?? DIRECT_ENDPOINT, {
    method: 'POST',
    signal,
    headers: PROXY_URL
      ? { 'content-type': 'application/json', 'x-codigo-acesso': credential.trim() }
      : {
          'content-type': 'application/json',
          'x-api-key': credential.trim(),
          'anthropic-version': '2023-06-01',
          // Necessário para chamar a API direto do navegador.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
    body: JSON.stringify(body),
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new GenerationError(
      'Não foi possível falar com a API. Verifique sua conexão — ou configure um proxy próprio ' +
        'em VITE_API_PROXY_URL se o navegador estiver bloqueando a chamada.',
    )
  })

  if (!response.ok) {
    throw new GenerationError(await describeHttpError(response))
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; name?: string; input?: unknown }>
    stop_reason?: string
  }

  const toolUse = payload.content?.find(
    (block) => block.type === 'tool_use' && block.name === EMIT_TOOL.name,
  )

  if (!toolUse?.input) {
    if (payload.stop_reason === 'max_tokens') {
      throw new GenerationError(
        'A resposta foi cortada por tamanho. Tente descrever uma peça mais simples ou dividir em partes.',
      )
    }
    throw new GenerationError('O modelo não devolveu uma peça. Tente reformular a descrição.')
  }

  return normalizeModel(toolUse.input)
}

/**
 * Com imagem, o conteúdo vira lista de blocos. As imagens vêm antes do texto:
 * é a ordem que a documentação da API recomenda quando o texto se refere a elas.
 */
export function montarConteudo(
  instruction: string,
  images: readonly ImageAttachment[],
): string | ContentBlock[] {
  if (images.length === 0) return instruction

  return [
    ...images.map(
      (imagem): ContentBlock => ({
        type: 'image',
        source: { type: 'base64', media_type: imagem.mediaType, data: imagem.data },
      }),
    ),
    { type: 'text', text: instruction },
  ]
}

async function describeHttpError(response: Response): Promise<string> {
  let detail = ''
  try {
    const data = (await response.json()) as { error?: { message?: string } }
    detail = data.error?.message ?? ''
  } catch {
    /* corpo não-JSON: seguimos só com o status */
  }

  switch (response.status) {
    case 401:
      return usesProxy
        ? detail || 'Código de acesso inválido.'
        : 'Chave da API inválida ou sem permissão.'
    case 503:
      return detail || 'O site ainda não está configurado para gerar peças.'
    case 400:
      return `Requisição recusada pela API${detail ? `: ${detail}` : '.'}`
    case 429:
      return 'Limite de uso atingido. Espere alguns segundos e tente de novo.'
    case 529:
      return 'A API está sobrecarregada no momento. Tente novamente em instantes.'
    default:
      return `Erro ${response.status} na API${detail ? `: ${detail}` : '.'}`
  }
}

/** A saída do modelo é confiável na forma, mas não no detalhe — normalizamos tudo. */
function normalizeModel(input: unknown): CadModel {
  const raw = input as Partial<CadModel> & { code?: string }

  const code = stripFences(String(raw.code ?? '')).trim()
  if (!code) throw new GenerationError('O modelo devolveu código vazio.')
  if (!/function\s+main\s*\(/.test(code)) {
    throw new GenerationError('O código gerado não define uma função main(params).')
  }

  return {
    name: String(raw.name ?? 'Peça sem nome'),
    summary: String(raw.summary ?? ''),
    printNotes: String(raw.printNotes ?? ''),
    params: normalizeParams(raw.params),
    code,
  }
}

function normalizeParams(input: unknown): ParamSpec[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((entry): ParamSpec[] => {
    const item = entry as Partial<ParamSpec>
    if (!item?.name) return []

    const type = item.type === 'boolean' ? 'boolean' : 'number'
    if (type === 'boolean') {
      return [
        {
          name: item.name,
          label: item.label ?? item.name,
          type,
          default: Boolean(item.default),
        },
      ]
    }

    const fallback = Number(item.default)
    const value = Number.isFinite(fallback) ? fallback : 10
    // Se o modelo esquecer os limites, derivamos uma faixa utilizável do valor padrão.
    const min = Number.isFinite(Number(item.min)) ? Number(item.min) : Math.min(0, value)
    const max = Number.isFinite(Number(item.max)) ? Number(item.max) : Math.max(value * 3, value + 10)
    const step = Number.isFinite(Number(item.step)) && Number(item.step) > 0 ? Number(item.step) : 0.5

    return [
      {
        name: item.name,
        label: item.label ?? item.name,
        type,
        default: value,
        min: Math.min(min, value),
        max: Math.max(max, value),
        step,
        unit: item.unit,
      },
    ]
  })
}

/** O modelo às vezes embrulha o código em ```js apesar da instrução. */
function stripFences(code: string): string {
  const fenced = code.match(/^\s*```(?:js|javascript)?\s*\n([\s\S]*?)\n?```\s*$/)
  return fenced ? fenced[1] : code
}
