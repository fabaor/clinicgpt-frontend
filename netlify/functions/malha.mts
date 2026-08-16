import type { Config } from '@netlify/functions'

/**
 * Ponte com um serviço de imagem-para-3D.
 *
 * Geração leva de dezenas de segundos a minutos — muito além do limite de uma
 * função síncrona. Por isso são três ações: `criar` devolve o id da tarefa,
 * `status` é consultado pelo navegador em intervalos, e `baixar` traz os bytes
 * do modelo pela função (buscar direto do CDN do serviço esbarraria em CORS).
 *
 * ATENÇÃO: o adaptador abaixo foi escrito a partir da documentação do serviço,
 * mas NÃO foi exercitado contra a API real — não havia chave disponível. Trate
 * `adaptadorTripo` como o ponto a conferir na primeira execução de verdade; o
 * resto do caminho (fila, consulta, download, importação, verificação) está
 * coberto por teste.
 */

type Acao = 'criar' | 'status' | 'baixar'

type Adaptador = {
  nome: string
  criar(imagemBase64: string, mediaType: string, chave: string): Promise<string>
  status(tarefa: string, chave: string): Promise<{ estado: string; progresso: number; url?: string }>
}

/** https://platform.tripo3d.ai — image_to_model, consulta por task_id. */
const adaptadorTripo: Adaptador = {
  nome: 'Tripo',

  async criar(imagemBase64, mediaType, chave) {
    const tipo = mediaType.replace('image/', '').replace('jpeg', 'jpg')

    const resposta = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
      body: JSON.stringify({
        type: 'image_to_model',
        file: { type: tipo, object: imagemBase64 },
      }),
    })

    const dados = (await resposta.json()) as {
      code?: number
      data?: { task_id?: string }
      message?: string
    }

    if (!resposta.ok || !dados.data?.task_id) {
      throw new Error(dados.message ?? `o serviço recusou a tarefa (HTTP ${resposta.status})`)
    }
    return dados.data.task_id
  },

  async status(tarefa, chave) {
    const resposta = await fetch(
      `https://api.tripo3d.ai/v2/openapi/task/${encodeURIComponent(tarefa)}`,
      { headers: { authorization: `Bearer ${chave}` } },
    )

    const dados = (await resposta.json()) as {
      data?: {
        status?: string
        progress?: number
        output?: { pbr_model?: string; model?: string }
      }
      message?: string
    }

    if (!resposta.ok || !dados.data) {
      throw new Error(dados.message ?? `consulta recusada (HTTP ${resposta.status})`)
    }

    return {
      estado: dados.data.status ?? 'unknown',
      progresso: dados.data.progress ?? 0,
      url: dados.data.output?.pbr_model ?? dados.data.output?.model,
    }
  },
}

const ADAPTADORES: Record<string, Adaptador> = { tripo: adaptadorTripo }

export default async (request: Request) => {
  if (request.method !== 'POST') return erro(405, 'Método não permitido.')

  const chave = Netlify.env.get('MALHA_API_KEY')
  const provedor = (Netlify.env.get('MALHA_PROVEDOR') ?? 'tripo').toLowerCase()
  const adaptador = ADAPTADORES[provedor]

  if (!chave) {
    return erro(
      503,
      'A geração de malha 3D não está configurada neste site. Defina MALHA_API_KEY nas variáveis ' +
        'de ambiente do projeto no Netlify.',
    )
  }
  if (!adaptador) {
    return erro(503, `Provedor de malha desconhecido: "${provedor}".`)
  }

  // O mesmo portão da geração de código: quem paga a conta é o dono do site.
  const codigoEsperado = Netlify.env.get('CODIGO_ACESSO')
  if (!codigoEsperado) return erro(503, 'O site ainda não tem código de acesso configurado.')
  if (!conferem(request.headers.get('x-codigo-acesso') ?? '', codigoEsperado)) {
    return erro(401, 'Código de acesso inválido.')
  }

  let corpo: { acao?: Acao; imagem?: string; mediaType?: string; tarefa?: string; url?: string }
  try {
    corpo = await request.json()
  } catch {
    return erro(400, 'Corpo da requisição inválido.')
  }

  try {
    switch (corpo.acao) {
      case 'criar': {
        if (!corpo.imagem) return erro(400, 'Faltou a imagem.')
        const tarefa = await adaptador.criar(corpo.imagem, corpo.mediaType ?? 'image/jpeg', chave)
        return json({ tarefa, provedor: adaptador.nome })
      }

      case 'status': {
        if (!corpo.tarefa) return erro(400, 'Faltou o identificador da tarefa.')
        return json(await adaptador.status(corpo.tarefa, chave))
      }

      case 'baixar': {
        if (!corpo.url) return erro(400, 'Faltou a URL do modelo.')
        // A URL vem da própria resposta do serviço; não aceitamos outra origem.
        if (!urlPermitida(corpo.url)) return erro(400, 'URL de modelo não permitida.')

        const modelo = await fetch(corpo.url)
        if (!modelo.ok) return erro(502, `Não consegui baixar o modelo (HTTP ${modelo.status}).`)

        return new Response(await modelo.arrayBuffer(), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        })
      }

      default:
        return erro(400, `Ação desconhecida: "${corpo.acao}".`)
    }
  } catch (falha) {
    return erro(502, falha instanceof Error ? falha.message : 'Falha ao falar com o serviço.')
  }
}

/**
 * Só HTTPS, e só nos domínios dos serviços que atendemos. Sem isto a função
 * viraria um proxy aberto para buscar qualquer URL da internet.
 */
function urlPermitida(bruta: string): boolean {
  let url: URL
  try {
    url = new URL(bruta)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false

  const permitidos = (Netlify.env.get('MALHA_DOMINIOS') ?? 'tripo3d.ai,tripo-data.rg1.data.tripo3d.com')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  return permitidos.some(
    (dominio) => url.hostname === dominio || url.hostname.endsWith(`.${dominio}`),
  )
}

/** Comparação de tempo constante: um `===` vazaria o código caractere a caractere. */
function conferem(recebido: string, esperado: string): boolean {
  const a = new TextEncoder().encode(recebido)
  const b = new TextEncoder().encode(esperado)
  let diferenca = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diferenca |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diferenca === 0
}

function json(dados: unknown) {
  return new Response(JSON.stringify(dados), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function erro(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const config: Config = {
  path: '/api/malha',
}
