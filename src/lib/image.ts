export type ImageAttachment = {
  id: string
  name: string
  /** `image/jpeg` — sempre reencodamos, então o tipo de saída é fixo. */
  mediaType: string
  /** Base64 puro, sem o prefixo `data:`, que é o que a API espera. */
  data: string
  /** `data:` URL para mostrar a miniatura. */
  preview: string
  width: number
  height: number
  /** Tamanho aproximado do que vai na requisição, em bytes. */
  bytes: number
}

/**
 * A API aceita até ~1.15 megapixel por imagem antes de reduzir sozinha; mandar
 * maior só gasta banda e tempo. 1568 px no lado maior fica dentro disso e
 * preserva detalhe suficiente para ler uma régua ao lado da peça.
 */
const LADO_MAXIMO = 1568
const QUALIDADE = 0.85
export const MAX_IMAGENS = 4

const FORMATOS_ACEITOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export class ImageError extends Error {}

export async function prepararImagem(file: File): Promise<ImageAttachment> {
  if (!FORMATOS_ACEITOS.has(file.type)) {
    const heic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
    throw new ImageError(
      heic
        ? `"${file.name}" está em HEIC, que o navegador não abre. No iPhone, ajuste Câmera → Formatos → Mais compatível, ou exporte como JPEG.`
        : `"${file.name}" não é um formato de imagem que dê para ler (aceito: JPEG, PNG, WebP, GIF).`,
    )
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageError(`Não consegui abrir "${file.name}". O arquivo pode estar corrompido.`)
  }

  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * escala))
  const height = Math.max(1, Math.round(bitmap.height * escala))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const contexto = canvas.getContext('2d')
  if (!contexto) throw new ImageError('O navegador não deu um contexto 2D para processar a imagem.')

  // Fundo branco: JPEG não tem transparência, e sem isto um PNG com fundo
  // transparente vira preto — que é justamente o pior caso para ler a peça.
  contexto.fillStyle = '#ffffff'
  contexto.fillRect(0, 0, width, height)
  contexto.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const preview = canvas.toDataURL('image/jpeg', QUALIDADE)
  const data = preview.slice(preview.indexOf(',') + 1)

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    mediaType: 'image/jpeg',
    data,
    preview,
    width,
    height,
    // Base64 carrega 4 bytes para cada 3 do original.
    bytes: Math.round((data.length * 3) / 4),
  }
}

/** Lê o que veio de um `drop`, de um `paste` ou de um `<input type="file">`. */
export async function prepararVarias(
  arquivos: readonly File[],
  jaAnexadas: number,
): Promise<{ imagens: ImageAttachment[]; erros: string[] }> {
  const vagas = MAX_IMAGENS - jaAnexadas
  const imagens: ImageAttachment[] = []
  const erros: string[] = []

  if (vagas <= 0) {
    return { imagens, erros: [`Máximo de ${MAX_IMAGENS} imagens por peça.`] }
  }

  for (const arquivo of arquivos.slice(0, vagas)) {
    try {
      imagens.push(await prepararImagem(arquivo))
    } catch (erro) {
      erros.push(erro instanceof ImageError ? erro.message : `Falha ao ler "${arquivo.name}".`)
    }
  }

  if (arquivos.length > vagas) {
    erros.push(`Só cabem mais ${vagas} imagem(ns); o resto foi ignorado.`)
  }

  return { imagens, erros }
}
