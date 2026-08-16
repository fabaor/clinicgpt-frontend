import type { CadModel } from '../types'
import type { Contorno, TraceResult } from './trace'

/**
 * Transforma contornos traçados numa peça normal do app.
 *
 * O resultado é um `CadModel` como qualquer outro — com código legível, sliders
 * e as mesmas verificações. Os pontos ficam embutidos no código: a forma vem da
 * imagem, mas espessura, tamanho e placa de fundo continuam paramétricos, e
 * dá para pedir ajustes ao modelo depois a partir daí.
 */
export function modeloDaSilhueta(
  traco: TraceResult,
  nomeArquivo: string,
  larguraAlvo: number,
): CadModel {
  const nome = tituloDe(nomeArquivo)
  const contornos = ordenarPorNivel(traco.contornos)
  const pontos = contornos.reduce((total, c) => total + c.pontos.length, 0)
  const proporcao = traco.alturaMm / traco.larguraMm

  return {
    name: nome,
    summary:
      `Silhueta traçada de "${nomeArquivo}": ${contornos.length} contorno(s), ${pontos} pontos, ` +
      `extrudada em bloco único.`,
    printNotes:
      'Imprima deitada, sem suporte. A forma veio da imagem e está congelada no código; largura, ' +
      'espessura e placa de fundo continuam ajustáveis nos controles. Detalhe muito fino pode não ' +
      'sair com bico de 0,4 mm — se algum traço sumir, aumente a largura ou engrosse o desenho.',
    params: [
      {
        name: 'largura',
        label: 'Largura da peça',
        type: 'number',
        default: Math.round(larguraAlvo),
        min: Math.max(10, Math.round(larguraAlvo / 4)),
        max: Math.round(larguraAlvo * 4),
        step: 1,
        unit: 'mm',
      },
      { name: 'espessura', label: 'Espessura', type: 'number', default: 3, min: 0.6, max: 20, step: 0.2, unit: 'mm' },
      { name: 'placa', label: 'Placa de fundo', type: 'number', default: 0, min: 0, max: 6, step: 0.2, unit: 'mm' },
      { name: 'margemPlaca', label: 'Margem da placa', type: 'number', default: 2, min: 0, max: 15, step: 0.5, unit: 'mm' },
    ],
    code: gerarCodigo(contornos, traco.larguraMm, proporcao),
  }
}

/**
 * Nível crescente: o código aplica os contornos nessa ordem, e um furo só faz
 * sentido depois que o material que o contém já existe.
 */
function ordenarPorNivel(contornos: readonly Contorno[]): Contorno[] {
  return [...contornos].sort((a, b) => a.nivel - b.nivel)
}

function tituloDe(nomeArquivo: string): string {
  const base = nomeArquivo.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  if (!base) return 'Silhueta'
  return `Silhueta: ${base.charAt(0).toUpperCase()}${base.slice(1)}`
}

function gerarCodigo(contornos: Contorno[], larguraReferencia: number, proporcao: number): string {
  const literais = contornos
    .map(({ nivel, pontos }) => {
      const lista = pontos.map(([x, y]) => `[${x.toFixed(2)},${y.toFixed(2)}]`).join(',')
      return `  [${nivel}, [${lista}]],`
    })
    .join('\n')

  return `function main(params = {}) {
  const { largura = ${larguraReferencia.toFixed(1)}, espessura = 3, placa = 0, margemPlaca = 2 } = params

  // Contornos traçados da imagem, em mm na largura de referência.
  // O primeiro número é a profundidade de aninhamento: par é material, ímpar é furo.
  const contornos = [
${literais}
  ]

  const escala = largura / ${larguraReferencia.toFixed(4)}
  const formaDe = (pontos) =>
    polygon({ points: pontos.map(([x, y]) => [x * escala, y * escala]) })

  // Aplica nível a nível: material, furo, ilha dentro do furo, e assim por diante.
  const niveis = [...new Set(contornos.map(([nivel]) => nivel))].sort((a, b) => a - b)
  let plano = null

  for (const nivel of niveis) {
    const formas = contornos.filter(([n]) => n === nivel).map(([, pontos]) => formaDe(pontos))
    if (formas.length === 0) continue
    if (plano === null) plano = union(...formas)
    else plano = nivel % 2 === 1 ? subtract(plano, ...formas) : union(plano, ...formas)
  }

  const relevo = extrudeLinear({ height: espessura }, plano)
  if (placa <= 0) return relevo

  // Placa de fundo: segura silhueta fina que não se sustenta sozinha.
  const largutaTotal = largura + margemPlaca * 2
  const alturaTotal = largura * ${proporcao.toFixed(4)} + margemPlaca * 2
  const fundo = translate(
    [0, 0, -placa],
    extrudeLinear(
      { height: placa + 0.01 },
      roundedRectangle({
        size: [largutaTotal, alturaTotal],
        roundRadius: Math.min(margemPlaca + 1, Math.min(largutaTotal, alturaTotal) / 2 - 0.1),
        segments: 32,
      })
    )
  )

  return translate([0, 0, placa], union(relevo, fundo))
}`
}
