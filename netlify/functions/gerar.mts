import type { Config } from '@netlify/functions'

/**
 * Proxy da API da Anthropic. A chave vive na variável de ambiente do site e
 * nunca chega ao navegador — o front chama /api/gerar na mesma origem.
 *
 * Quem paga a conta é o dono do site, então gerar exige um código de acesso.
 * Sem CODIGO_ACESSO configurado a função recusa tudo: com dinheiro em jogo, uma
 * configuração pela metade tem que falhar fechada, não aberta.
 */
export default async (request: Request) => {
  if (request.method !== 'POST') {
    return erro(405, 'Método não permitido.')
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return erro(
      503,
      'O site ainda não tem a chave da API configurada. Defina ANTHROPIC_API_KEY nas variáveis ' +
        'de ambiente do projeto no Netlify e publique de novo.',
    )
  }

  const codigoEsperado = Netlify.env.get('CODIGO_ACESSO')
  if (!codigoEsperado) {
    return erro(
      503,
      'O site ainda não tem código de acesso configurado. Defina CODIGO_ACESSO nas variáveis de ' +
        'ambiente do projeto no Netlify e publique de novo.',
    )
  }

  if (!conferem(request.headers.get('x-codigo-acesso') ?? '', codigoEsperado)) {
    return erro(401, 'Código de acesso inválido.')
  }

  let corpo: string
  try {
    corpo = await request.text()
  } catch {
    return erro(400, 'Não foi possível ler a requisição.')
  }

  if (corpo.length > 1_000_000) {
    return erro(413, 'Requisição grande demais.')
  }

  try {
    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: corpo,
    })

    return new Response(await resposta.text(), {
      status: resposta.status,
      headers: { 'content-type': 'application/json' },
    })
  } catch (falha) {
    return erro(502, falha instanceof Error ? falha.message : 'Falha ao falar com a API.')
  }
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

/** O front lê `error.message`, o mesmo formato que a API usa. */
function erro(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const config: Config = {
  path: '/api/gerar',
}
