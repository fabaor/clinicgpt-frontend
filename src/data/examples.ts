import type { CadModel } from '../types'

/**
 * Peças que já vêm prontas: dá para abrir o app, mexer nos parâmetros e baixar
 * um STL sem nenhuma chave de API. Também servem de referência do estilo de
 * código que o modelo deve produzir.
 */
export const EXAMPLES: CadModel[] = [
  {
    name: 'Porta-lápis hexagonal',
    summary:
      'Copo hexagonal de parede fina com janelas laterais arredondadas. Imprime em pé, sem suportes.',
    printNotes:
      'Imprima em pé, com a base na mesa — não precisa de suporte. Parede de 2,4 mm fecha bem com bico de 0,4 mm. As janelas atravessam os dois lados; desligue-as se quiser o copo fechado.',
    params: [
      { name: 'diametro', label: 'Diâmetro entre vértices', type: 'number', default: 80, min: 40, max: 160, step: 1, unit: 'mm' },
      { name: 'altura', label: 'Altura', type: 'number', default: 100, min: 40, max: 200, step: 1, unit: 'mm' },
      { name: 'parede', label: 'Espessura da parede', type: 'number', default: 2.4, min: 1.2, max: 6, step: 0.2, unit: 'mm' },
      { name: 'fundo', label: 'Espessura do fundo', type: 'number', default: 3, min: 1.2, max: 8, step: 0.2, unit: 'mm' },
      { name: 'janelas', label: 'Janelas laterais', type: 'boolean', default: true },
    ],
    code: `function main(params = {}) {
  const {
    diametro = 80,
    altura = 100,
    parede = 2.4,
    fundo = 3,
    janelas = true,
  } = params

  const raio = diametro / 2
  const corpo = translate(
    [0, 0, altura / 2],
    cylinder({ radius: raio, height: altura, segments: 6 })
  )

  // A cavidade sobe do fundo e ultrapassa o topo em 1 mm: corte coplanar
  // com a face de cima geraria malha quebrada.
  const alturaCavidade = altura - fundo + 1
  const cavidade = translate(
    [0, 0, fundo + alturaCavidade / 2],
    cylinder({ radius: raio - parede, height: alturaCavidade, segments: 6 })
  )

  let peca = subtract(corpo, cavidade)

  if (janelas) {
    // Cada furo atravessa o copo inteiro, abrindo duas janelas opostas.
    const cortes = []
    for (let i = 0; i < 3; i++) {
      cortes.push(
        rotateZ(
          TAU / 12 + (TAU / 6) * i,
          translate(
            [0, 0, fundo + (altura - fundo) * 0.55],
            rotateY(TAU / 4, cylinder({ radius: diametro * 0.15, height: diametro * 2, segments: 48 }))
          )
        )
      )
    }
    peca = subtract(peca, ...cortes)
  }

  return peca
}`,
  },
  {
    name: 'Suporte de celular',
    summary:
      'Cunha com encaixe inclinado para o celular e recorte frontal para o cabo de carga.',
    printNotes:
      'Imprima deitado sobre a face traseira ou em pé sobre a base — nas duas orientações não precisa de suporte. O encaixe tem 2 mm a mais que a espessura informada, o suficiente para celular com capa fina.',
    params: [
      { name: 'largura', label: 'Largura do suporte', type: 'number', default: 78, min: 40, max: 140, step: 1, unit: 'mm' },
      { name: 'espessuraCelular', label: 'Espessura do celular', type: 'number', default: 11, min: 6, max: 25, step: 0.5, unit: 'mm' },
      { name: 'inclinacao', label: 'Inclinação da tela', type: 'number', default: 18, min: 5, max: 40, step: 1, unit: '°' },
      { name: 'profundidade', label: 'Profundidade da base', type: 'number', default: 62, min: 40, max: 110, step: 1, unit: 'mm' },
      { name: 'alturaTras', label: 'Altura do encosto', type: 'number', default: 48, min: 25, max: 90, step: 1, unit: 'mm' },
    ],
    code: `function main(params = {}) {
  const {
    largura = 78,
    espessuraCelular = 11,
    inclinacao = 18,
    profundidade = 62,
    alturaTras = 48,
  } = params

  const folga = 2
  const canal = espessuraCelular + folga
  const alturaFrente = 16
  const anguloPedido = degToRad(inclinacao)

  // Ao inclinar, o canto de trás do encaixe desce. O piso precisa ficar acima
  // desse canto, senão o corte atravessa a base e parte a peça em dois.
  const piso = Math.max(4, (canal / 2) * Math.sin(anguloPedido) + 2)

  // O encaixe também tem que sair pela face de cima: saindo pela traseira, ele
  // decepa o topo do encosto. O pé do encaixe recua conforme o ângulo pedido e,
  // quando nem assim cabe, o ângulo cede até o máximo que a geometria aguenta.
  const baseCanal = Math.min(
    Math.max(profundidade * 0.5, (alturaTras - piso) * Math.tan(anguloPedido) + canal),
    profundidade - canal * 0.7
  )
  const angulo = Math.min(anguloPedido, Math.atan((baseCanal - canal) / (alturaTras - piso)))

  // Perfil lateral: x = profundidade, y = altura. Extrudamos e deitamos depois.
  const corpo = polygon({
    points: [
      [0, 0],
      [profundidade, 0],
      [profundidade, alturaFrente],
      [0, alturaTras],
    ],
  })

  // O encaixe nasce em y = piso e sobe inclinado para trás, saindo pela face de
  // cima. Parar antes do fundo é o que mantém a frente presa na traseira.
  const comprimento = alturaTras + profundidade
  const encaixe = translate(
    [baseCanal, piso],
    rotate([0, 0, angulo], translate([0, comprimento / 2], rectangle({ size: [canal, comprimento] })))
  )

  // extrudeLinear cresce em +Z; rotateX joga a altura de volta para o eixo Z.
  const solido = translate(
    [0, largura / 2, 0],
    rotateX(TAU / 4, extrudeLinear({ height: largura }, subtract(corpo, encaixe)))
  )

  // Passagem do cabo: só no miolo da largura. Se atravessasse toda a peça,
  // a frente sairia solta da traseira.
  const alturaPassagem = piso + 2
  const inicio = baseCanal - canal * 0.7
  const vao = profundidade - inicio + 1
  const passagemCabo = translate(
    [inicio + vao / 2, 0, alturaPassagem / 2 - 1],
    cuboid({ size: [vao, largura * 0.38, alturaPassagem + 2] })
  )

  return subtract(solido, passagemCabo)
}`,
  },
  {
    name: 'Caixa com divisórias',
    summary:
      'Caixa de cantos arredondados com divisórias verticais igualmente espaçadas ao longo da largura.',
    printNotes:
      'Imprima com a base na mesa, sem suportes. Parede de 2 mm e fundo de 2 mm bastam para organizar peças pequenas; aumente para 3 mm se for guardar algo pesado.',
    params: [
      { name: 'largura', label: 'Largura', type: 'number', default: 120, min: 40, max: 200, step: 1, unit: 'mm' },
      { name: 'profundidade', label: 'Profundidade', type: 'number', default: 80, min: 30, max: 200, step: 1, unit: 'mm' },
      { name: 'altura', label: 'Altura', type: 'number', default: 45, min: 15, max: 120, step: 1, unit: 'mm' },
      { name: 'parede', label: 'Espessura da parede', type: 'number', default: 2, min: 1.2, max: 5, step: 0.2, unit: 'mm' },
      { name: 'divisorias', label: 'Divisórias internas', type: 'number', default: 2, min: 0, max: 6, step: 1 },
      { name: 'raioCanto', label: 'Raio dos cantos', type: 'number', default: 6, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    ],
    code: `function main(params = {}) {
  const {
    largura = 120,
    profundidade = 80,
    altura = 45,
    parede = 2,
    divisorias = 2,
    raioCanto = 6,
  } = params

  const fundo = parede
  const raio = Math.min(raioCanto, Math.min(largura, profundidade) / 2 - parede - 0.1)

  const externo = extrudeLinear(
    { height: altura },
    roundedRectangle({ size: [largura, profundidade], roundRadius: raio, segments: 32 })
  )

  const alturaCavidade = altura - fundo + 1
  const interno = translate(
    [0, 0, fundo],
    extrudeLinear(
      { height: alturaCavidade },
      roundedRectangle({
        size: [largura - parede * 2, profundidade - parede * 2],
        roundRadius: Math.max(0.5, raio - parede),
        segments: 32,
      })
    )
  )

  let caixa = subtract(externo, interno)

  const quantidade = Math.max(0, Math.round(divisorias))
  if (quantidade > 0) {
    const paredes = []
    const passo = largura / (quantidade + 1)
    for (let i = 1; i <= quantidade; i++) {
      paredes.push(
        translate(
          [-largura / 2 + passo * i, 0, fundo + (altura - fundo) / 2],
          cuboid({ size: [parede, profundidade - parede * 2, altura - fundo] })
        )
      )
    }
    caixa = union(caixa, ...paredes)
  }

  return caixa
}`,
  },
  {
    name: 'Engrenagem reta',
    summary:
      'Engrenagem de perfil evolvente com cubo reforçado e rasgo de chaveta. Duas de mesmo módulo sempre se encaixam.',
    printNotes:
      'Imprima deitada, sem suporte, com pelo menos 4 perímetros — o dente sofre no contato. Para um par, a distância entre centros é módulo × (dentes desta + dentes da outra) ÷ 2. Se as duas travarem, aumente a folga em 0,05 mm por vez.',
    params: [
      { name: 'modulo', label: 'Módulo', type: 'number', default: 2, min: 0.5, max: 5, step: 0.25, unit: 'mm' },
      { name: 'dentes', label: 'Número de dentes', type: 'number', default: 20, min: 8, max: 60, step: 1 },
      { name: 'largura', label: 'Largura do dente', type: 'number', default: 8, min: 3, max: 25, step: 0.5, unit: 'mm' },
      { name: 'eixo', label: 'Diâmetro do eixo', type: 'number', default: 5, min: 2, max: 20, step: 0.5, unit: 'mm' },
      { name: 'folga', label: 'Folga entre dentes', type: 'number', default: 0.1, min: 0, max: 0.5, step: 0.05, unit: 'mm' },
      { name: 'cubo', label: 'Cubo saliente', type: 'boolean', default: true },
    ],
    code: `function main(params = {}) {
  const {
    modulo = 2,
    dentes = 20,
    largura = 8,
    eixo = 5,
    folga = 0.1,
    cubo = true,
  } = params

  // engrenagemReta já entrega o perfil evolvente correto — não vale a pena
  // aproximar o dente à mão, o erro só aparece quando as duas não engrenam.
  const roda = engrenagemReta({ modulo, dentes, largura, folga })

  const alturaCubo = cubo ? largura * 0.6 : 0
  const corpo = cubo
    ? union(
        roda,
        translate(
          [0, 0, largura + alturaCubo / 2],
          cylinder({ radius: eixo * 1.6, height: alturaCubo, segments: 48 })
        )
      )
    : roda

  const furo = translate(
    [0, 0, -1],
    cylinder({ radius: eixo / 2, height: largura + alturaCubo + 2, segments: 48 })
  )

  // Rasgo de chaveta: trava a roda no eixo em vez de deixá-la patinar. Só cabe
  // se sobrar parede até a raiz do dente — em engrenagem pequena, não sobra.
  const raioRaiz = (modulo * dentes) / 2 - 1.25 * modulo
  const folgaAteRaiz = raioRaiz - eixo / 2
  const cortes = [furo]

  if (folgaAteRaiz > 1.5) {
    const lado = Math.min(eixo * 0.35, (folgaAteRaiz - 1) * 2)
    cortes.push(
      translate(
        [0, eixo / 2, (largura + alturaCubo) / 2],
        cuboid({ size: [lado, lado, largura + alturaCubo + 2] })
      )
    )
  }

  return subtract(corpo, ...cortes)
}`,
  },
  {
    name: 'Parafuso M8',
    summary:
      'Parafuso de rosca métrica ISO com cabeça sextavada, gerado a partir da tabela de passo grosso.',
    printNotes:
      'Imprima em pé, cabeça na mesa, camada de 0,12 mm e sem suporte — a rosca sai definida. Para a porca correspondente, peça "a porca deste parafuso"; a folga de 0,25 mm rosqueia bem em PLA.',
    params: [
      { name: 'diametro', label: 'Diâmetro nominal', type: 'number', default: 8, min: 3, max: 20, step: 1, unit: 'mm' },
      { name: 'comprimento', label: 'Comprimento da rosca', type: 'number', default: 25, min: 6, max: 80, step: 1, unit: 'mm' },
      { name: 'alturaCabeca', label: 'Altura da cabeça', type: 'number', default: 5.5, min: 2, max: 15, step: 0.5, unit: 'mm' },
    ],
    code: `function main(params = {}) {
  const { diametro = 8, comprimento = 25, alturaCabeca = 5.5 } = params

  // parafusoSextavado devolve cabeça e rosca numa superfície fechada só. Unir a
  // rosca a outro sólido com union() não funciona: o CSG rasga a malha na
  // hélice, então a peça inteira é descrita de uma vez.
  return parafusoSextavado({
    diametro,
    comprimento,
    alturaCabeca,
    chave: diametro * 1.5,
  })
}`,
  },
  {
    name: 'Chaveiro com nome',
    summary:
      'Plaquinha arredondada com texto em relevo e furo para argola. O texto é gerado a partir do parâmetro de altura das letras.',
    printNotes:
      'Imprima deitado, texto para cima, sem suportes. O relevo de 1,2 mm sai bem em qualquer bico; troque a cor do filamento nessa camada para o texto ficar destacado.',
    params: [
      { name: 'alturaTexto', label: 'Altura das letras', type: 'number', default: 10, min: 5, max: 25, step: 0.5, unit: 'mm' },
      { name: 'espessura', label: 'Espessura da plaquinha', type: 'number', default: 3, min: 1.6, max: 8, step: 0.2, unit: 'mm' },
      { name: 'relevo', label: 'Altura do relevo', type: 'number', default: 1.2, min: 0.4, max: 3, step: 0.2, unit: 'mm' },
      { name: 'traco', label: 'Espessura do traço', type: 'number', default: 1.4, min: 0.8, max: 3, step: 0.1, unit: 'mm' },
      { name: 'margem', label: 'Margem ao redor do texto', type: 'number', default: 6, min: 2, max: 20, step: 0.5, unit: 'mm' },
    ],
    code: `function main(params = {}) {
  const {
    alturaTexto = 10,
    espessura = 3,
    relevo = 1.2,
    traco = 1.4,
    margem = 6,
  } = params

  const texto = 'OFICINA'

  // vectorText devolve traços (linhas abertas); expand dá espessura a cada um.
  const tracos = vectorText({ height: alturaTexto, input: texto })
  const letras = tracos.map((pontos) =>
    expand({ delta: traco / 2, corners: 'round', segments: 12 }, line(pontos))
  )
  const textoPlano = union(...letras)

  const [minTexto, maxTexto] = measureBoundingBox(textoPlano)
  const larguraTexto = maxTexto[0] - minTexto[0]
  const alturaReal = maxTexto[1] - minTexto[1]

  const largura = larguraTexto + margem * 2 + alturaTexto
  const profundidade = alturaReal + margem * 2

  const placa = extrudeLinear(
    { height: espessura },
    roundedRectangle({
      size: [largura, profundidade],
      roundRadius: Math.min(profundidade / 2 - 0.5, 4),
      segments: 32,
    })
  )

  // Centraliza o texto na parte direita da placa, deixando a esquerda para a argola.
  const centroTextoX = (minTexto[0] + maxTexto[0]) / 2
  const centroTextoY = (minTexto[1] + maxTexto[1]) / 2
  const textoEmRelevo = translate(
    [alturaTexto / 2 - centroTextoX, -centroTextoY, espessura],
    extrudeLinear({ height: relevo }, textoPlano)
  )

  const furo = translate(
    [-largura / 2 + margem * 0.9, 0, -1],
    cylinder({ radius: Math.min(2.5, profundidade / 5), height: espessura + 2, segments: 48 })
  )

  return subtract(union(placa, textoEmRelevo), furo)
}`,
  },
]
