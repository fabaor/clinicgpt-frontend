import type { ImageAttachment } from './image'

/**
 * Conversa com a função `/api/malha`, que faz a ponte com o serviço de
 * imagem-para-3D. A geração leva minutos, então o fluxo é: cria a tarefa,
 * consulta o andamento, baixa os bytes.
 */

const ENDPOINT = '/api/malha'

/** O serviço costuma levar de 30 s a alguns minutos; desistimos depois disso. */
const LIMITE_MS = 5 * 60 * 1000
const INTERVALO_MS = 3000

export class Mesh3dError extends Error {}

export type ProgressoMalha = {
  etapa: 'enviando' | 'na fila' | 'gerando' | 'baixando'
  progresso: number
  provedor?: string
}

export type GerarMalhaOptions = {
  imagem: ImageAttachment
  credential: string
  onProgresso?: (progresso: ProgressoMalha) => void
  signal?: AbortSignal
}

export type MalhaGerada = {
  buffer: ArrayBuffer
  provedor: string
}

async function chamar<T>(corpo: unknown, credential: string, signal?: AbortSignal): Promise<T> {
  const resposta = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-codigo-acesso': credential.trim() },
    body: JSON.stringify(corpo),
  }).catch((erro: unknown) => {
    if (erro instanceof DOMException && erro.name === 'AbortError') throw erro
    throw new Mesh3dError('Não foi possível falar com o serviço de malha 3D.')
  })

  if (!resposta.ok) {
    let detalhe = ''
    try {
      const dados = (await resposta.json()) as { error?: { message?: string } }
      detalhe = dados.error?.message ?? ''
    } catch {
      /* corpo não-JSON: seguimos só com o status */
    }
    throw new Mesh3dError(detalhe || `O serviço de malha respondeu ${resposta.status}.`)
  }

  const tipo = resposta.headers.get('content-type') ?? ''
  return (tipo.includes('json') ? await resposta.json() : await resposta.arrayBuffer()) as T
}

export async function gerarMalha(options: GerarMalhaOptions): Promise<MalhaGerada> {
  const { imagem, credential, onProgresso, signal } = options

  if (!credential.trim()) {
    throw new Mesh3dError('Informe o código de acesso do site para gerar malha 3D.')
  }

  onProgresso?.({ etapa: 'enviando', progresso: 0 })

  const { tarefa, provedor } = await chamar<{ tarefa: string; provedor: string }>(
    { acao: 'criar', imagem: imagem.data, mediaType: imagem.mediaType },
    credential,
    signal,
  )

  const limite = Date.now() + LIMITE_MS
  let url: string | undefined

  while (Date.now() < limite) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    await esperar(INTERVALO_MS, signal)

    const estado = await chamar<{ estado: string; progresso: number; url?: string }>(
      { acao: 'status', tarefa },
      credential,
      signal,
    )

    const normalizado = estado.estado.toLowerCase()

    if (normalizado === 'success' || normalizado === 'succeeded' || normalizado === 'completed') {
      url = estado.url
      break
    }
    if (['failed', 'error', 'cancelled', 'banned', 'expired'].includes(normalizado)) {
      throw new Mesh3dError(`O serviço não conseguiu gerar a malha (estado: ${estado.estado}).`)
    }

    onProgresso?.({
      etapa: normalizado === 'queued' ? 'na fila' : 'gerando',
      progresso: estado.progresso ?? 0,
      provedor,
    })
  }

  if (!url) {
    throw new Mesh3dError(
      'A geração passou de 5 minutos sem terminar. Tente de novo, ou com uma foto mais simples.',
    )
  }

  onProgresso?.({ etapa: 'baixando', progresso: 100, provedor })
  const buffer = await chamar<ArrayBuffer>({ acao: 'baixar', url }, credential, signal)

  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new Mesh3dError('O modelo veio vazio do serviço.')
  }

  return { buffer, provedor }
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Cancelado', 'AbortError'))
      },
      { once: true },
    )
  })
}
