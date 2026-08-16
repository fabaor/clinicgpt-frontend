/**
 * Arquivos de teste montados à mão, para os testes de navegador não dependerem
 * de nenhum binário versionado.
 */
import { deflateSync } from 'node:zlib'

/** STL binário de uma caixa de dimensões dadas, montado à mão. */
export function stlDeCaixa(sx, sy, sz) {
  const v = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2], // base
    [4, 5, 6], [4, 6, 7], // topo
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ]

  const buffer = Buffer.alloc(84 + faces.length * 50)
  buffer.write('caixa de teste', 0, 'ascii')
  buffer.writeUInt32LE(faces.length, 80)

  faces.forEach((face, i) => {
    let offset = 84 + i * 50
    // Normal zerada: todo fatiador recalcula pela ordem dos vértices.
    offset += 12
    for (const indice of face) {
      for (const coordenada of v[indice]) {
        buffer.writeFloatLE(coordenada, offset)
        offset += 4
      }
    }
  })

  return buffer
}

/** PNG cinza montado à mão, com um quadrado escuro no meio para a silhueta ter o que traçar. */
export function pngDeTeste() {
  const crcTabela = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTabela[n] = c >>> 0
  }
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTabela[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const bloco = (tipo, dados) => {
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados])
    const tamanho = Buffer.alloc(4)
    tamanho.writeUInt32BE(dados.length)
    const checagem = Buffer.alloc(4)
    checagem.writeUInt32BE(crc(corpo))
    return Buffer.concat([tamanho, corpo, checagem])
  }

  const lado = 64
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(lado, 0)
  ihdr.writeUInt32BE(lado, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 0 // escala de cinza

  // Quadrado escuro centrado: forma única, fechada, longe das bordas.
  const linhas = []
  for (let y = 0; y < lado; y++) {
    const linha = Buffer.alloc(lado + 1)
    linha[0] = 0 // sem filtro
    for (let x = 0; x < lado; x++) {
      const dentro = x >= 16 && x < 48 && y >= 16 && y < 48
      linha[x + 1] = dentro ? 0x20 : 0xe8
    }
    linhas.push(linha)
  }
  const comprimido = deflateSync(Buffer.concat(linhas))

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', comprimido),
    bloco('IEND', Buffer.alloc(0)),
  ])
}
