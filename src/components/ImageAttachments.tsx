import { useId, useRef } from 'react'
import { MAX_IMAGENS } from '../lib/image'
import type { ImageAttachment } from '../lib/image'

type Props = {
  imagens: readonly ImageAttachment[]
  onAdicionar: (arquivos: File[]) => void
  onRemover: (id: string) => void
  disabled: boolean
}

export function ImageAttachments({ imagens, onAdicionar, onRemover, disabled }: Props) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const cheio = imagens.length >= MAX_IMAGENS

  return (
    <div className="anexos">
      <div className="anexos__acoes">
        <input
          id={inputId}
          ref={inputRef}
          className="anexos__input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          disabled={disabled || cheio}
          onChange={(event) => {
            const arquivos = Array.from(event.target.files ?? [])
            if (arquivos.length > 0) onAdicionar(arquivos)
            // Zera para o mesmo arquivo poder ser escolhido de novo.
            event.target.value = ''
          }}
        />
        <label className="chip anexos__botao" htmlFor={inputId} aria-disabled={disabled || cheio}>
          Anexar foto
        </label>
        <span className="hint">
          {imagens.length > 0
            ? `${imagens.length} de ${MAX_IMAGENS} — o modelo lê a foto para tirar as medidas`
            : 'Arraste, cole ou escolha: o modelo lê a foto junto com a descrição'}
        </span>
      </div>

      {imagens.length > 0 && (
        <ul className="anexos__lista">
          {imagens.map((imagem) => (
            <li className="anexo" key={imagem.id}>
              <img src={imagem.preview} alt={imagem.name} />
              <button
                type="button"
                className="anexo__remover"
                title={`Remover ${imagem.name}`}
                aria-label={`Remover ${imagem.name}`}
                disabled={disabled}
                onClick={() => onRemover(imagem.id)}
              >
                ×
              </button>
              <span className="anexo__medidas">
                {imagem.width}×{imagem.height}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
