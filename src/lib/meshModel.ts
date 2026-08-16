import type { CadModel, MeshImport } from '../types'

/**
 * Envolve uma malha importada numa peça normal do app.
 *
 * O código não carrega os triângulos — chama `malhaImportada()`, que o worker
 * injeta no escopo. Assim a peça importada anda pelo mesmo caminho de todas as
 * outras: sliders, verificação de fechamento, booleanos com outras formas e
 * exportação. E dá para pedir ajustes ao modelo em cima dela.
 */
export function modeloDaMalha(
  mesh: MeshImport,
  nome: string,
  alturaSugerida: number,
  origemHumana: string,
): CadModel {
  const triangulos = Math.floor(mesh.positions.length / 9)

  return {
    name: nome,
    summary: `Malha de ${origemHumana}: ${triangulos.toLocaleString('pt-BR')} triângulos, reescalada e apoiada na mesa.`,
    printNotes:
      'Malha importada, não peça paramétrica: a forma vem pronta e só o tamanho e a orientação ' +
      'são ajustáveis aqui. Confira os avisos acima — malha de serviço generativo costuma vir ' +
      'com furos e detalhe inventado nas faces que a foto não mostrava. Passe pelo fatiador antes ' +
      'de imprimir, e considere um reparo de malha se aparecer aviso de superfície aberta.',
    params: [
      {
        name: 'alturaAlvo',
        label: 'Altura da peça',
        type: 'number',
        default: Math.round(alturaSugerida),
        min: 5,
        max: 250,
        step: 1,
        unit: 'mm',
      },
      { name: 'giroZ', label: 'Girar na mesa', type: 'number', default: 0, min: 0, max: 360, step: 5, unit: '°' },
      { name: 'deitar', label: 'Deitar 90° (girar em X)', type: 'boolean', default: false },
    ],
    mesh,
    code: `function main(params = {}) {
  const { alturaAlvo = ${Math.round(alturaSugerida)}, giroZ = 0, deitar = false } = params

  // A malha vem do arquivo importado, não do código: o worker a injeta aqui.
  let peca = malhaImportada()

  if (deitar) peca = rotateX(TAU / 4, peca)
  if (giroZ !== 0) peca = rotateZ(degToRad(giroZ), peca)

  // Serviço generativo entrega em escala arbitrária; a altura é que manda.
  const [antesMin, antesMax] = measureBoundingBox(peca)
  const alturaAtual = antesMax[2] - antesMin[2]
  if (alturaAtual > 1e-6) {
    const escala = alturaAlvo / alturaAtual
    peca = scale([escala, escala, escala], peca)
  }

  // Centraliza na mesa e apoia em z = 0.
  const [min, max] = measureBoundingBox(peca)
  return translate(
    [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]],
    peca
  )
}`,
  }
}
