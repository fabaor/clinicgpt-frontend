/**
 * Traça a silhueta de uma imagem: pixels → contornos fechados → polígonos.
 *
 * Não depende de DOM de propósito — recebe os pixels crus, então roda igual no
 * navegador e nos testes.
 */

export type Ponto = [number, number]

export type Contorno = {
  /** Profundidade de aninhamento. Ímpar é furo; par é material. */
  nivel: number
  pontos: Ponto[]
}

export type Pixels = {
  width: number
  height: number
  /** RGBA, 4 bytes por pixel, como o ImageData do canvas. */
  data: Uint8ClampedArray | Uint8Array
}

export type TraceOptions = {
  /** 0–255. Omitido, calcula por Otsu. */
  limiar?: number
  /** Traça o claro em vez do escuro. */
  inverter?: boolean
  /** Tolerância da simplificação, em pixels. 0 mantém o traçado bruto. */
  suavizacao?: number
  /** Largura final da peça, em mm. */
  larguraAlvo?: number
  /** Descarta ilhas menores que isto, em pixels². Mata ruído e poeira. */
  areaMinima?: number
}

export type TraceResult = {
  contornos: Contorno[]
  /** Limiar usado, útil quando foi calculado automaticamente. */
  limiar: number
  larguraMm: number
  alturaMm: number
  /** Os mesmos contornos em pixels, para desenhar a prévia sobre a imagem. */
  previa: Ponto[][]
}

export class TraceError extends Error {}

/** Luminância perceptual, a mesma ponderação que o olho usa. */
function cinza(pixels: Pixels): Uint8Array {
  const { width, height, data } = pixels
  const saida = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const base = i * 4
    const alfa = data[base + 3] / 255
    const luz = 0.299 * data[base] + 0.587 * data[base + 1] + 0.114 * data[base + 2]
    // Pixel transparente conta como fundo claro, não como preto.
    saida[i] = Math.round(luz * alfa + 255 * (1 - alfa))
  }
  return saida
}

/**
 * Limiar de Otsu: o corte que maximiza a variância entre os dois grupos. Serve
 * bem para foto de objeto sobre fundo claro, que é o caso de uso aqui.
 */
export function otsu(cinzas: Uint8Array): number {
  const histograma = new Array(256).fill(0)
  for (const valor of cinzas) histograma[valor]++

  const total = cinzas.length
  let soma = 0
  for (let i = 0; i < 256; i++) soma += i * histograma[i]

  let somaFundo = 0
  let pesoFundo = 0
  let melhorVariancia = -1
  // Entre dois picos bem separados, toda uma faixa de cortes dá a mesma
  // variância. Ficar na primeira encosta o limiar no pico escuro e come a forma
  // em imagem com anti-aliasing — então guardamos a faixa e usamos o meio dela.
  let primeiroMelhor = 128
  let ultimoMelhor = 128

  for (let t = 0; t < 256; t++) {
    pesoFundo += histograma[t]
    if (pesoFundo === 0) continue
    const pesoFrente = total - pesoFundo
    if (pesoFrente === 0) break

    somaFundo += t * histograma[t]
    const mediaFundo = somaFundo / pesoFundo
    const mediaFrente = (soma - somaFundo) / pesoFrente
    const variancia = pesoFundo * pesoFrente * (mediaFundo - mediaFrente) ** 2

    if (variancia > melhorVariancia * (1 + 1e-9)) {
      melhorVariancia = variancia
      primeiroMelhor = t
      ultimoMelhor = t
    } else if (variancia >= melhorVariancia * (1 - 1e-9)) {
      ultimoMelhor = t
    }
  }

  return Math.round((primeiroMelhor + ultimoMelhor) / 2)
}

/** Nomes das arestas de uma célula, no sentido do marching squares. */
type Aresta = 'T' | 'R' | 'B' | 'L'

/**
 * Segmentos por caso. Bits: TL=8, TR=4, BR=2, BL=1. Casos complementares saem
 * com o sentido invertido, o que é justamente o que mantém as cadeias fechadas.
 */
const CASOS: Record<number, Array<[Aresta, Aresta]>> = {
  1: [['L', 'B']],
  2: [['B', 'R']],
  3: [['L', 'R']],
  4: [['R', 'T']],
  5: [['L', 'T'], ['R', 'B']],
  6: [['B', 'T']],
  7: [['L', 'T']],
  8: [['T', 'L']],
  9: [['T', 'B']],
  10: [['T', 'R'], ['B', 'L']],
  11: [['T', 'R']],
  12: [['R', 'L']],
  13: [['R', 'B']],
  14: [['B', 'L']],
}

function pontoDaAresta(x: number, y: number, aresta: Aresta): Ponto {
  switch (aresta) {
    case 'T':
      return [x + 0.5, y]
    case 'R':
      return [x + 1, y + 0.5]
    case 'B':
      return [x + 0.5, y + 1]
    case 'L':
      return [x, y + 0.5]
  }
}

const chave = (p: Ponto) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`

/**
 * Marching squares sobre a máscara binária, costurando os segmentos em laços
 * fechados. A máscara é usada com uma borda vazia ao redor, para que uma forma
 * encostada na margem da imagem ainda feche.
 */
function extrairLacos(mascara: Uint8Array, largura: number, altura: number): Ponto[][] {
  const dentro = (x: number, y: number) =>
    x < 0 || y < 0 || x >= largura || y >= altura ? 0 : mascara[y * largura + x]

  const porInicio = new Map<string, Ponto[][]>()

  // De -1 até largura para varrer também a borda vazia.
  for (let y = -1; y <= altura; y++) {
    for (let x = -1; x <= largura; x++) {
      const indice =
        dentro(x, y) * 8 + dentro(x + 1, y) * 4 + dentro(x + 1, y + 1) * 2 + dentro(x, y + 1)

      for (const [de, para] of CASOS[indice] ?? []) {
        const inicio = pontoDaAresta(x, y, de)
        const fim = pontoDaAresta(x, y, para)
        const lista = porInicio.get(chave(inicio))
        if (lista) lista.push([inicio, fim])
        else porInicio.set(chave(inicio), [[inicio, fim]])
      }
    }
  }

  const lacos: Ponto[][] = []

  for (const [, segmentos] of porInicio) {
    while (segmentos.length > 0) {
      const primeiro = segmentos.pop()
      if (!primeiro) break

      const laco: Ponto[] = [primeiro[0]]
      let atual = primeiro[1]
      const inicio = chave(primeiro[0])

      // Anda de segmento em segmento até voltar ao começo.
      for (let passo = 0; passo < 4_000_000; passo++) {
        if (chave(atual) === inicio) break
        laco.push(atual)

        const seguintes = porInicio.get(chave(atual))
        const seguinte = seguintes?.pop()
        if (!seguinte) break // cadeia aberta: descartada abaixo pelo filtro de área
        atual = seguinte[1]
      }

      if (laco.length >= 4) lacos.push(laco)
    }
  }

  return lacos
}

/** Área com sinal: positiva em sentido anti-horário no sistema da imagem. */
function areaComSinal(pontos: Ponto[]): number {
  let area = 0
  for (let i = 0; i < pontos.length; i++) {
    const [x1, y1] = pontos[i]
    const [x2, y2] = pontos[(i + 1) % pontos.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

/** Ramer–Douglas–Peucker: joga fora pontos que não mudam a forma. */
function simplificar(pontos: Ponto[], epsilon: number): Ponto[] {
  if (epsilon <= 0 || pontos.length < 4) return pontos

  const manter = new Uint8Array(pontos.length)
  manter[0] = 1
  manter[pontos.length - 1] = 1

  const pilha: Array<[number, number]> = [[0, pontos.length - 1]]

  while (pilha.length > 0) {
    const [inicio, fim] = pilha.pop() as [number, number]
    const [x1, y1] = pontos[inicio]
    const [x2, y2] = pontos[fim]
    const dx = x2 - x1
    const dy = y2 - y1
    const norma = Math.hypot(dx, dy) || 1

    let piorIndice = -1
    let piorDistancia = epsilon

    for (let i = inicio + 1; i < fim; i++) {
      const [x, y] = pontos[i]
      const distancia = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norma
      if (distancia > piorDistancia) {
        piorDistancia = distancia
        piorIndice = i
      }
    }

    if (piorIndice !== -1) {
      manter[piorIndice] = 1
      pilha.push([inicio, piorIndice], [piorIndice, fim])
    }
  }

  return pontos.filter((_, i) => manter[i] === 1)
}

/** Ponto dentro do polígono, por contagem de cruzamentos. */
function contem(poligono: Ponto[], [px, py]: Ponto): boolean {
  let dentro = false
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i]
    const [xj, yj] = poligono[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      dentro = !dentro
    }
  }
  return dentro
}

export function tracar(pixels: Pixels, options: TraceOptions = {}): TraceResult {
  const { width, height } = pixels
  if (width < 4 || height < 4) throw new TraceError('A imagem é pequena demais para traçar.')

  const {
    inverter = false,
    suavizacao = 0.8,
    larguraAlvo = 60,
    areaMinima = Math.max(12, (width * height) / 20_000),
  } = options

  const cinzas = cinza(pixels)
  const limiar = options.limiar ?? otsu(cinzas)

  const mascara = new Uint8Array(width * height)
  for (let i = 0; i < cinzas.length; i++) {
    const escuro = cinzas[i] <= limiar
    mascara[i] = (inverter ? !escuro : escuro) ? 1 : 0
  }

  const lacos = extrairLacos(mascara, width, height)
    .map((laco) => simplificar(laco, suavizacao))
    .filter((laco) => laco.length >= 3 && Math.abs(areaComSinal(laco)) >= areaMinima)

  if (lacos.length === 0) {
    throw new TraceError(
      'Não achei nenhuma forma com esse limiar. Ajuste o contraste ou marque "inverter".',
    )
  }

  // Profundidade de aninhamento: quantos outros laços contêm este.
  const niveis = lacos.map(
    (laco, i) => lacos.filter((outro, j) => j !== i && contem(outro, laco[0])).length,
  )

  const escala = larguraAlvo / width
  const larguraMm = width * escala
  const alturaMm = height * escala

  const contornos: Contorno[] = lacos.map((laco, i) => {
    // Y da imagem cresce para baixo; o do CAD cresce para cima. Inverter o eixo
    // também inverte o sentido dos laços, então normalizamos tudo para
    // anti-horário — que é o que o polygon() do JSCAD espera.
    const emMm: Ponto[] = laco.map(([x, y]) => [
      x * escala - larguraMm / 2,
      alturaMm / 2 - y * escala,
    ])
    if (areaComSinal(emMm) < 0) emMm.reverse()
    return { nivel: niveis[i], pontos: emMm }
  })

  return {
    contornos,
    limiar,
    larguraMm,
    alturaMm,
    previa: lacos,
  }
}
