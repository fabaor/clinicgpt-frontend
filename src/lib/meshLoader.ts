import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

/**
 * Lê malha de fora — arquivo que o usuário escolheu ou resultado de um serviço
 * de imagem-para-3D — e devolve triângulos crus, prontos para o worker.
 */

export class MeshLoadError extends Error {}

/** Acima disso o navegador engasga no visualizador e o fatiador sofre. */
const MAX_TRIANGULOS = 800_000

export type MalhaCarregada = {
  positions: Float32Array
  triangulos: number
  /** Dimensões originais do arquivo, nas unidades em que ele veio. */
  dimensoes: [number, number, number]
}

export async function carregarMalha(
  buffer: ArrayBuffer,
  nomeArquivo: string,
): Promise<MalhaCarregada> {
  const formato = formatoDe(buffer, nomeArquivo)
  const geometria =
    formato === 'stl' ? lerStl(buffer) : await lerGlb(buffer)

  const posicao = geometria.getAttribute('position')
  if (!posicao) throw new MeshLoadError('A malha não tem vértices.')

  const triangulos = Math.floor(posicao.count / 3)
  if (triangulos === 0) throw new MeshLoadError('A malha veio vazia.')
  if (triangulos > MAX_TRIANGULOS) {
    throw new MeshLoadError(
      `A malha tem ${triangulos.toLocaleString('pt-BR')} triângulos — acima do limite de ` +
        `${MAX_TRIANGULOS.toLocaleString('pt-BR')}. Reduza a malha antes de importar.`,
    )
  }

  geometria.computeBoundingBox()
  const caixa = geometria.boundingBox
  const dimensoes: [number, number, number] = caixa
    ? [caixa.max.x - caixa.min.x, caixa.max.y - caixa.min.y, caixa.max.z - caixa.min.z]
    : [0, 0, 0]

  return {
    positions: new Float32Array(posicao.array.buffer.slice(0)).subarray(0, triangulos * 9),
    triangulos,
    dimensoes,
  }
}

/**
 * O conteúdo manda, não a extensão: um serviço de imagem-para-3D pode entregar
 * STL numa URL terminada em `.glb`, e confiar no nome faz o parser errado rodar.
 */
function formatoDe(buffer: ArrayBuffer, nomeArquivo: string): 'stl' | 'glb' {
  const cabecalho = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength))

  // "glTF" em ASCII abre todo GLB binário.
  if (cabecalho[0] === 0x67 && cabecalho[1] === 0x6c && cabecalho[2] === 0x54 && cabecalho[3] === 0x46) {
    return 'glb'
  }

  // "solid" abre STL em texto.
  const texto = String.fromCharCode(...cabecalho)
  if (texto.toLowerCase() === 'solid') return 'stl'

  // STL binário não tem número mágico, mas tem tamanho exato: 80 bytes de
  // cabeçalho, a contagem de triângulos, e 50 bytes por triângulo.
  if (buffer.byteLength >= 84) {
    const contagem = new DataView(buffer).getUint32(80, true)
    if (buffer.byteLength === 84 + contagem * 50) return 'stl'
  }

  if (/\.stl$/i.test(nomeArquivo)) return 'stl'
  return 'glb'
}

function lerStl(buffer: ArrayBuffer): THREE.BufferGeometry {
  try {
    const geometria = new STLLoader().parse(buffer)
    return geometria.index ? geometria.toNonIndexed() : geometria
  } catch (erro) {
    throw new MeshLoadError(
      `Não consegui ler o STL: ${erro instanceof Error ? erro.message : 'arquivo inválido'}.`,
    )
  }
}

async function lerGlb(buffer: ArrayBuffer): Promise<THREE.BufferGeometry> {
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      '',
      (resultado) => resolve(resultado as unknown as { scene: THREE.Object3D }),
      (erro) => {
        const mensagem = erro instanceof Error ? erro.message : String(erro)
        reject(
          new MeshLoadError(
            /draco|meshopt|KHR_/i.test(mensagem)
              ? 'O GLB está comprimido (Draco/Meshopt), que este app não descompacta. ' +
                'Peça o arquivo em STL ou OBJ ao serviço.'
              : `Não consegui ler o GLB: ${mensagem}`,
          ),
        )
      },
    )
  })

  // Um GLB traz uma cena inteira: juntamos todas as malhas já com a transformação
  // de mundo aplicada, senão as partes saem umas por cima das outras.
  gltf.scene.updateMatrixWorld(true)
  const pedacos: Float32Array[] = []

  gltf.scene.traverse((objeto) => {
    const malha = objeto as THREE.Mesh
    if (!malha.isMesh || !malha.geometry) return

    const geometria = (malha.geometry.index ? malha.geometry.toNonIndexed() : malha.geometry.clone())
    geometria.applyMatrix4(malha.matrixWorld)
    const posicao = geometria.getAttribute('position')
    if (posicao) pedacos.push(new Float32Array(posicao.array as ArrayLike<number>))
    geometria.dispose()
  })

  if (pedacos.length === 0) throw new MeshLoadError('O GLB não tem nenhuma malha.')

  const total = pedacos.reduce((soma, pedaco) => soma + pedaco.length, 0)
  const juntos = new Float32Array(total)
  let offset = 0
  for (const pedaco of pedacos) {
    juntos.set(pedaco, offset)
    offset += pedaco.length
  }

  const geometria = new THREE.BufferGeometry()
  geometria.setAttribute('position', new THREE.BufferAttribute(juntos, 3))
  return geometria
}

/**
 * Serviços de imagem-para-3D entregam a peça em Y-para-cima e numa escala
 * arbitrária. Aqui só corrigimos o eixo; o tamanho vira parâmetro na peça.
 */
export function deYParaZ(positions: Float32Array): Float32Array {
  const saida = new Float32Array(positions.length)
  for (let i = 0; i + 2 < positions.length; i += 3) {
    saida[i] = positions[i]
    saida[i + 1] = -positions[i + 2]
    saida[i + 2] = positions[i + 1]
  }
  return saida
}
