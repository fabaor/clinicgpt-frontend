// Com extensão: assim o Node consegue carregar este módulo direto nos testes,
// sem passar pelo bundler.
import { jscad } from './jscadRuntime.ts'
import type { Geom3 } from './jscadRuntime.ts'

const { cylinder, cuboid, polygon, polyhedron } = jscad.primitives
const { extrudeLinear } = jscad.extrusions
const { union, subtract } = jscad.booleans
const { translate } = jscad.transforms

/**
 * Peças normalizadas. Existem porque um modelo improvisando rosca ou dente de
 * engrenagem erra o perfil — e o erro só aparece quando a peça sai da impressora
 * e não rosqueia. Aqui a geometria é a da norma, e os testes conferem as
 * dimensões contra a tabela.
 *
 * Rosca e porca são geradas como poliedro paramétrico, sem booleano nenhum. Não
 * é preciosismo: o CSG do JSCAD não corta hélice de forma confiável — testamos
 * 36 combinações de resolução e modificadores e todas produziram malha aberta.
 * Descrevendo a superfície direto, a peça sai fechada por construção e ~20×
 * mais rápida.
 */

/** Passo grosso ISO 261, em mm, por diâmetro nominal. */
const PASSO_GROSSO: Record<number, number> = {
  2: 0.4, 2.5: 0.45, 3: 0.5, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25,
  10: 1.5, 12: 1.75, 14: 2, 16: 2, 20: 2.5, 24: 3,
}

/** Porca sextavada DIN 934: abertura de chave e altura, em mm. */
const PORCA: Record<number, { chave: number; altura: number }> = {
  3: { chave: 5.5, altura: 2.4 },
  4: { chave: 7, altura: 3.2 },
  5: { chave: 8, altura: 4 },
  6: { chave: 10, altura: 5 },
  8: { chave: 13, altura: 6.5 },
  10: { chave: 17, altura: 8 },
  12: { chave: 19, altura: 10 },
}

/** Parafuso cilíndrico com sextavado interno DIN 912: cabeça e altura, em mm. */
const CABECA: Record<number, { diametro: number; altura: number }> = {
  3: { diametro: 5.5, altura: 3 },
  4: { diametro: 7, altura: 4 },
  5: { diametro: 8.5, altura: 5 },
  6: { diametro: 10, altura: 6 },
  8: { diametro: 13, altura: 8 },
  10: { diametro: 16, altura: 10 },
  12: { diametro: 18, altura: 12 },
}

/**
 * Insertos de latão para instalação a quente, medidas do padrão mais comum no
 * mercado (Ruthex e equivalentes). Confira o seu: varia um pouco por marca.
 */
const INSERTO: Record<number, { furo: number; comprimento: number }> = {
  2: { furo: 3.2, comprimento: 4 },
  3: { furo: 4, comprimento: 5.7 },
  4: { furo: 5.6, comprimento: 8.1 },
  5: { furo: 6.4, comprimento: 9.5 },
  6: { furo: 8.1, comprimento: 12.7 },
}

export function passoGrosso(diametro: number): number {
  const exato = PASSO_GROSSO[diametro]
  if (exato) return exato
  // Fora da tabela: aproxima pela tendência do passo grosso ISO.
  return Math.max(0.35, Math.round(diametro * 0.15 * 20) / 20)
}

/**
 * Raio da rosca métrica ISO em função da fase axial dentro de um passo.
 * Perfil de 60° com crista truncada em H/8 e raiz em H/4, como na norma.
 */
function perfilRosca(passo: number, raioMaior: number) {
  const alturaTriangulo = 0.8660254 * passo // H
  const raioMenor = raioMaior - 0.625 * alturaTriangulo
  const crista = passo / 16
  const raiz = passo * 0.375

  return (fase: number) => {
    const f = Math.abs(fase)
    if (f <= crista) return raioMaior
    if (f >= raiz) return raioMenor
    return raioMaior - ((raioMaior - raioMenor) * (f - crista)) / (raiz - crista)
  }
}

/** Fase axial no passo, trazida para [-P/2, P/2]. Define a hélice destra. */
function fase(z: number, angulo: number, passo: number): number {
  let f = (z - (angulo * passo) / (Math.PI * 2)) % passo
  if (f > passo / 2) f -= passo
  if (f < -passo / 2) f += passo
  return f
}

/** Linhas de amostragem em z: fino o bastante para o perfil, sem exagero. */
function linhasDe(altura: number, passo: number): number {
  return Math.max(2, Math.ceil(altura / (passo / 12)) + 1)
}

export type RoscaOptions = {
  /** Diâmetro nominal, em mm — o externo da rosca. */
  diametro: number
  altura: number
  /** Passo em mm. Omitido, usa o passo grosso ISO do diâmetro. */
  passo?: number
  segmentos?: number
}

/**
 * Eixo com rosca métrica externa (o corpo de um parafuso), apoiado em z = 0 e
 * com a altura exata pedida. Una-o à cabeça que você modelar.
 *
 * Para rosca fêmea use `porcaRoscada` (peça inteira) ou `furoInserto` (o
 * caminho recomendado em FDM). Cortar rosca dentro de geometria qualquer não é
 * confiável neste kernel.
 */
export function roscaMetrica(options: RoscaOptions): Geom3 {
  const { diametro, altura, segmentos = 48 } = options
  const passo = options.passo ?? passoGrosso(diametro)
  const raio = perfilRosca(passo, diametro / 2)
  const linhas = linhasDe(altura, passo)

  const pontos: Array<[number, number, number]> = []
  for (let linha = 0; linha < linhas; linha++) {
    pontos.push(...anelRosca(raio, passo, (altura * linha) / (linhas - 1), segmentos))
  }

  const indice = (linha: number, i: number) => linha * segmentos + (i % segmentos)
  const faces: number[][] = []

  for (let linha = 0; linha < linhas - 1; linha++) {
    for (let i = 0; i < segmentos; i++) {
      faces.push([
        indice(linha, i),
        indice(linha, i + 1),
        indice(linha + 1, i + 1),
        indice(linha + 1, i),
      ])
    }
  }

  const centroBase = pontos.push([0, 0, 0]) - 1
  const centroTopo = pontos.push([0, 0, altura]) - 1
  for (let i = 0; i < segmentos; i++) faces.push([centroBase, indice(0, i + 1), indice(0, i)])
  for (let i = 0; i < segmentos; i++) {
    faces.push([centroTopo, indice(linhas - 1, i), indice(linhas - 1, i + 1)])
  }

  return polyhedron({ points: pontos, faces, orientation: 'outward' })
}

/** Um anel de amostras da superfície da rosca, na altura z. */
function anelRosca(
  raio: (fase: number) => number,
  passo: number,
  z: number,
  segmentos: number,
): Array<[number, number, number]> {
  const anel: Array<[number, number, number]> = []
  for (let i = 0; i < segmentos; i++) {
    const angulo = (Math.PI * 2 * i) / segmentos
    const r = raio(fase(z, angulo, passo))
    anel.push([r * Math.cos(angulo), r * Math.sin(angulo), z])
  }
  return anel
}

/** Raio do contorno de um sextavado de apótema `apotema`, no ângulo dado. */
function raioSextavado(apotema: number, angulo: number): number {
  const setor = ((angulo % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)
  return apotema / Math.cos(setor - Math.PI / 6)
}

export type ParafusoOptions = {
  /** Diâmetro nominal da rosca, em mm. */
  diametro: number
  /** Comprimento da parte roscada. */
  comprimento: number
  passo?: number
  /** Abertura de chave da cabeça. Omitida, usa 1,5 × o diâmetro. */
  chave?: number
  /** Altura da cabeça. Omitida, usa 0,7 × o diâmetro. */
  alturaCabeca?: number
  segmentos?: number
}

/**
 * Parafuso de cabeça sextavada, cabeça e rosca na mesma superfície fechada.
 *
 * Sai inteiro de propósito: o kernel de CSG não consegue unir a rosca a nada —
 * testamos, e tanto `union` quanto `subtract` rasgam a malha. Descrevendo o
 * parafuso todo de uma vez, não há booleano para falhar.
 */
export function parafusoSextavado(options: ParafusoOptions): Geom3 {
  const { diametro, comprimento, segmentos = 48 } = options
  const passo = options.passo ?? passoGrosso(diametro)
  const chave = options.chave ?? diametro * 1.5
  const alturaCabeca = options.alturaCabeca ?? diametro * 0.7

  const raioRosca = perfilRosca(passo, diametro / 2)
  const apotema = chave / 2
  const linhas = linhasDe(comprimento, passo)

  const pontos: Array<[number, number, number]> = []
  const anelHex = (z: number) => {
    const inicio = pontos.length
    for (let i = 0; i < segmentos; i++) {
      const angulo = (Math.PI * 2 * i) / segmentos
      const r = raioSextavado(apotema, angulo)
      pontos.push([r * Math.cos(angulo), r * Math.sin(angulo), z])
    }
    return inicio
  }

  const baseCabeca = anelHex(0)
  const topoCabeca = anelHex(alturaCabeca)

  const primeiraRosca = pontos.length
  for (let linha = 0; linha < linhas; linha++) {
    const z = alturaCabeca + (comprimento * linha) / (linhas - 1)
    pontos.push(...anelRosca(raioRosca, passo, z, segmentos))
  }

  const faces: number[][] = []
  const anel = (inicio: number, i: number) => inicio + (i % segmentos)
  const rosca = (linha: number, i: number) => primeiraRosca + linha * segmentos + (i % segmentos)

  // Base da cabeça, virada para baixo.
  const centroBase = pontos.push([0, 0, 0]) - 1
  for (let i = 0; i < segmentos; i++) {
    faces.push([centroBase, anel(baseCabeca, i + 1), anel(baseCabeca, i)])
  }

  // Lateral da cabeça.
  for (let i = 0; i < segmentos; i++) {
    faces.push([anel(baseCabeca, i), anel(baseCabeca, i + 1), anel(topoCabeca, i + 1), anel(topoCabeca, i)])
  }

  // Coroa entre a cabeça e o início da rosca.
  for (let i = 0; i < segmentos; i++) {
    faces.push([anel(topoCabeca, i), anel(topoCabeca, i + 1), rosca(0, i + 1), rosca(0, i)])
  }

  // Haste roscada.
  for (let linha = 0; linha < linhas - 1; linha++) {
    for (let i = 0; i < segmentos; i++) {
      faces.push([rosca(linha, i), rosca(linha, i + 1), rosca(linha + 1, i + 1), rosca(linha + 1, i)])
    }
  }

  const centroTopo = pontos.push([0, 0, alturaCabeca + comprimento]) - 1
  for (let i = 0; i < segmentos; i++) {
    faces.push([centroTopo, rosca(linhas - 1, i), rosca(linhas - 1, i + 1)])
  }

  return polyhedron({ points: pontos, faces, orientation: 'outward' })
}

export type PorcaOptions = {
  /** Tamanho nominal: 3 para M3, e assim por diante. */
  tamanho: number
  passo?: number
  /** Abertura de chave. Omitida, usa a DIN 934. */
  chave?: number
  /** Altura. Omitida, usa a DIN 934. */
  altura?: number
  /** Folga radial da rosca. 0,25 mm costuma rosquear bem em PLA. */
  folga?: number
  segmentos?: number
}

/**
 * Porca sextavada com rosca interna, gerada inteira como uma superfície
 * fechada. Sai apoiada em z = 0, com as faces de chave paralelas ao eixo Y.
 */
export function porcaRoscada(options: PorcaOptions): Geom3 {
  const { tamanho, folga = 0.25, segmentos = 48 } = options
  const tabela = PORCA[tamanho]
  if (!tabela) throw new Error(`Não tenho a porca M${tamanho} na tabela.`)

  const passo = options.passo ?? passoGrosso(tamanho)
  const chave = options.chave ?? tabela.chave
  const altura = options.altura ?? tabela.altura

  const raioRosca = perfilRosca(passo, tamanho / 2 + folga)
  const apotema = chave / 2
  const linhas = linhasDe(altura, passo)
  const pontos: Array<[number, number, number]> = []

  for (let linha = 0; linha < linhas; linha++) {
    pontos.push(...anelRosca(raioRosca, passo, (altura * linha) / (linhas - 1), segmentos))
  }

  const inicioExterno = linhas * segmentos
  for (let linha = 0; linha < linhas; linha++) {
    const z = (altura * linha) / (linhas - 1)
    for (let i = 0; i < segmentos; i++) {
      const angulo = (Math.PI * 2 * i) / segmentos
      const r = raioSextavado(apotema, angulo)
      pontos.push([r * Math.cos(angulo), r * Math.sin(angulo), z])
    }
  }

  const dentro = (linha: number, i: number) => linha * segmentos + (i % segmentos)
  const fora = (linha: number, i: number) => inicioExterno + linha * segmentos + (i % segmentos)
  const faces: number[][] = []

  // Parede do furo: normal aponta para dentro do furo, ou seja, para fora do sólido.
  for (let linha = 0; linha < linhas - 1; linha++) {
    for (let i = 0; i < segmentos; i++) {
      faces.push([dentro(linha, i), dentro(linha + 1, i), dentro(linha + 1, i + 1), dentro(linha, i + 1)])
    }
  }
  for (let linha = 0; linha < linhas - 1; linha++) {
    for (let i = 0; i < segmentos; i++) {
      faces.push([fora(linha, i), fora(linha, i + 1), fora(linha + 1, i + 1), fora(linha + 1, i)])
    }
  }
  for (let i = 0; i < segmentos; i++) {
    faces.push([dentro(0, i), dentro(0, i + 1), fora(0, i + 1), fora(0, i)])
  }
  for (let i = 0; i < segmentos; i++) {
    const topo = linhas - 1
    faces.push([dentro(topo, i + 1), dentro(topo, i), fora(topo, i), fora(topo, i + 1)])
  }

  return polyhedron({ points: pontos, faces, orientation: 'outward' })
}

export type EngrenagemOptions = {
  /** Módulo: diâmetro primitivo ÷ número de dentes. Define o tamanho do dente. */
  modulo: number
  dentes: number
  largura: number
  /** Diâmetro do furo central. 0 deixa a engrenagem maciça. */
  furo?: number
  /** Ângulo de pressão em graus. 20° é o padrão. */
  anguloPressao?: number
  /** Folga radial entre dentes de engrenagens que se encaixam. */
  folga?: number
  /** Pontos por flanco. 8 já dá um dente liso. */
  resolucao?: number
}

/**
 * Engrenagem reta de perfil evolvente — a curva que faz duas engrenagens
 * transmitirem rotação sem solavanco. Duas engrenagens de mesmo módulo sempre
 * se encaixam, com distância entre centros = módulo × (dentes₁ + dentes₂) ÷ 2.
 */
export function engrenagemReta(options: EngrenagemOptions): Geom3 {
  const { modulo, dentes, largura, furo = 0, anguloPressao = 20, folga = 0, resolucao = 8 } = options

  const alfa = (anguloPressao * Math.PI) / 180
  const raioPrimitivo = (modulo * dentes) / 2
  const raioBase = raioPrimitivo * Math.cos(alfa)
  const raioAdendo = raioPrimitivo + modulo - folga
  const raioDedendo = raioPrimitivo - 1.25 * modulo - folga

  const involuta = (angulo: number) => Math.tan(angulo) - angulo
  const anguloAdendo = Math.acos(Math.min(1, raioBase / raioAdendo))
  const meioDente = Math.PI / (2 * dentes) + involuta(alfa)

  const flanco: Array<[number, number]> = []
  for (let k = 0; k <= resolucao; k++) {
    const angulo = (anguloAdendo * k) / resolucao
    flanco.push([raioBase / Math.cos(angulo), involuta(angulo)])
  }

  const pontos: Array<[number, number]> = []
  for (let dente = 0; dente < dentes; dente++) {
    const base = (Math.PI * 2 * dente) / dentes
    const proximo = (Math.PI * 2 * (dente + 1)) / dentes

    for (const [raio, theta] of flanco) {
      pontos.push([
        raio * Math.cos(base - meioDente + theta),
        raio * Math.sin(base - meioDente + theta),
      ])
    }
    for (const [raio, theta] of [...flanco].reverse()) {
      pontos.push([
        raio * Math.cos(base + meioDente - theta),
        raio * Math.sin(base + meioDente - theta),
      ])
    }

    const vao = 0.02
    pontos.push([raioDedendo * Math.cos(base + meioDente + vao), raioDedendo * Math.sin(base + meioDente + vao)])
    pontos.push([raioDedendo * Math.cos(proximo - meioDente - vao), raioDedendo * Math.sin(proximo - meioDente - vao)])
  }

  const corpo = extrudeLinear({ height: largura }, polygon({ points: pontos }))
  if (furo <= 0) return corpo

  return subtract(
    corpo,
    translate([0, 0, -1], cylinder({ radius: furo / 2, height: largura + 2, segments: 48 })),
  )
}

export type BolsaPorcaOptions = {
  /** Tamanho nominal: 3 para M3, e assim por diante. */
  tamanho: number
  /** Folga sobre a abertura de chave. 0,2 mm entra na pressão; 0,4 mm à mão. */
  folga?: number
  /**
   * Comprimento do canal de inserção lateral, saindo em +X. 0 faz bolsa fechada,
   * que exige pausar a impressão para colocar a porca.
   */
  canal?: number
}

/**
 * Ferramenta de corte para encaixar uma porca sextavada de verdade: subtraia da
 * sua peça. Nasce em z = 0 com as faces de chave paralelas a Y.
 */
export function bolsaPorca(options: BolsaPorcaOptions): Geom3 {
  const { tamanho, folga = 0.2, canal = 0 } = options
  const porca = PORCA[tamanho]
  if (!porca) throw new Error(`Não tenho a porca M${tamanho} na tabela.`)

  const chave = porca.chave + folga
  const altura = porca.altura + folga
  // O sextavado do JSCAD já nasce com as faces perpendiculares a Y; a chave é
  // medida entre faces, e o raio pedido é o de vértice.
  const raio = chave / Math.sqrt(3)

  const bolsa = translate(
    [0, 0, altura / 2],
    cylinder({ radius: raio, height: altura, segments: 6 }),
  )

  if (canal <= 0) return bolsa

  return union(bolsa, translate([canal / 2, 0, altura / 2], cuboid({ size: [canal, chave, altura] })))
}

export type FuroParafusoOptions = {
  tamanho: number
  /** Profundidade do furo passante. */
  profundidade: number
  /** Folga no diâmetro. 0,4 mm deixa o parafuso passar solto, como deve. */
  folga?: number
  /** `rebaixado` esconde a cabeça cilíndrica; `passante` deixa a cabeça apoiada. */
  cabeca?: 'passante' | 'rebaixado'
  alturaRebaixo?: number
}

/**
 * Ferramenta de corte para passagem de parafuso: subtraia da sua peça. Nasce
 * abaixo de z = 0 de propósito — ferramenta de corte tem que ultrapassar a
 * face, senão o corte fica coplanar e quebra a malha.
 */
export function furoParafuso(options: FuroParafusoOptions): Geom3 {
  const { tamanho, profundidade, folga = 0.4, cabeca = 'passante' } = options
  const dados = CABECA[tamanho]
  if (!dados) throw new Error(`Não tenho o parafuso M${tamanho} na tabela.`)

  const passante = translate(
    [0, 0, profundidade / 2],
    cylinder({ radius: (tamanho + folga) / 2, height: profundidade + 2, segments: 48 }),
  )

  if (cabeca === 'passante') return passante

  const alturaRebaixo = options.alturaRebaixo ?? dados.altura + 0.2
  const rebaixo = translate(
    [0, 0, profundidade - alturaRebaixo / 2 + 0.5],
    cylinder({ radius: (dados.diametro + folga) / 2, height: alturaRebaixo + 1, segments: 48 }),
  )

  return union(passante, rebaixo)
}

export type FuroInsertoOptions = {
  tamanho: number
  /** Diâmetro do furo. Omitido, usa a tabela do inserto. */
  furo?: number
  /** Profundidade. Omitida, usa o comprimento do inserto + 1 mm de sobra. */
  profundidade?: number
}

/**
 * Furo para inserto de latão instalado a quente — a forma recomendada de ter
 * rosca fêmea em peça FDM. Rosca impressa em tamanho pequeno espana; o inserto
 * aguenta apertar e reapertar. Subtraia da sua peça; nasce abaixo de z = 0.
 */
export function furoInserto(options: FuroInsertoOptions): Geom3 {
  const { tamanho } = options
  const dados = INSERTO[tamanho]
  if (!dados) throw new Error(`Não tenho o inserto M${tamanho} na tabela.`)

  const furo = options.furo ?? dados.furo
  const profundidade = options.profundidade ?? dados.comprimento + 1

  return translate(
    [0, 0, profundidade / 2 - 0.5],
    cylinder({ radius: furo / 2, height: profundidade + 1, segments: 48 }),
  )
}

/** Tudo que fica disponível no escopo do código gerado. */
export const STANDARD_PARTS = {
  roscaMetrica,
  parafusoSextavado,
  porcaRoscada,
  engrenagemReta,
  bolsaPorca,
  furoParafuso,
  furoInserto,
  passoGrosso,
}
