import { useEffect, useMemo, useRef, useState } from 'react'
import { TraceError, tracar } from '../lib/trace'
import type { TraceResult } from '../lib/trace'
import type { ImageAttachment } from '../lib/image'

type Props = {
  imagens: readonly ImageAttachment[]
  onUsar: (traco: TraceResult, nomeArquivo: string, larguraAlvo: number) => void
  onFechar: () => void
}

/**
 * Traça o contorno de uma foto e mostra o resultado sobre ela. Sem a prévia,
 * ajustar limiar às cegas é adivinhação — e o traçado roda inteiro no
 * navegador, então não custa nada refazer a cada mexida.
 */
export function SilhouettePanel({ imagens, onUsar, onFechar }: Props) {
  const [indice, setIndice] = useState(0)
  const [limiarManual, setLimiarManual] = useState<number | null>(null)
  const [suavizacao, setSuavizacao] = useState(0.8)
  const [inverter, setInverter] = useState(false)
  const [largura, setLargura] = useState(60)
  const [pixels, setPixels] = useState<ImageData | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const imagem = imagens[Math.min(indice, imagens.length - 1)]

  // Decodifica a imagem escolhida uma vez; o traçado roda sobre estes pixels.
  useEffect(() => {
    let cancelado = false
    setPixels(null)

    const elemento = new Image()
    elemento.onload = () => {
      if (cancelado) return
      const canvas = document.createElement('canvas')
      canvas.width = elemento.naturalWidth
      canvas.height = elemento.naturalHeight
      const contexto = canvas.getContext('2d', { willReadFrequently: true })
      if (!contexto) return
      contexto.drawImage(elemento, 0, 0)
      setPixels(contexto.getImageData(0, 0, canvas.width, canvas.height))
    }
    elemento.src = imagem.preview

    return () => {
      cancelado = true
    }
  }, [imagem])

  const resultado = useMemo(() => {
    if (!pixels) return null
    try {
      return {
        traco: tracar(pixels, {
          limiar: limiarManual ?? undefined,
          inverter,
          suavizacao,
          larguraAlvo: largura,
        }),
        erro: null as string | null,
      }
    } catch (erro) {
      return {
        traco: null,
        erro: erro instanceof TraceError ? erro.message : 'Falha ao traçar a imagem.',
      }
    }
  }, [pixels, limiarManual, inverter, suavizacao, largura])

  const traco = resultado?.traco ?? null

  // Desenha a imagem esmaecida com os contornos por cima.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pixels) return

    const escala = Math.min(1, 320 / pixels.width)
    canvas.width = Math.round(pixels.width * escala)
    canvas.height = Math.round(pixels.height * escala)

    const contexto = canvas.getContext('2d')
    if (!contexto) return

    contexto.fillStyle = '#0b0e14'
    contexto.fillRect(0, 0, canvas.width, canvas.height)

    const fonte = new Image()
    fonte.onload = () => {
      contexto.globalAlpha = 0.35
      contexto.drawImage(fonte, 0, 0, canvas.width, canvas.height)
      contexto.globalAlpha = 1

      if (!traco) return
      contexto.lineWidth = 1.5
      contexto.lineJoin = 'round'

      traco.previa.forEach((laco, i) => {
        // Furo em laranja, material em verde: dá para ver na hora se o limiar
        // transformou um vão em massa.
        contexto.strokeStyle = traco.contornos[i]?.nivel % 2 === 1 ? '#f0a742' : '#6fd3c7'
        contexto.beginPath()
        laco.forEach(([x, y], k) => {
          const px = x * escala
          const py = y * escala
          if (k === 0) contexto.moveTo(px, py)
          else contexto.lineTo(px, py)
        })
        contexto.closePath()
        contexto.stroke()
      })
    }
    fonte.src = imagem.preview
  }, [pixels, traco, imagem])

  const pontos = traco?.contornos.reduce((total, c) => total + c.pontos.length, 0) ?? 0
  const furos = traco?.contornos.filter((c) => c.nivel % 2 === 1).length ?? 0

  return (
    <section className="silhueta">
      <div className="silhueta__cabecalho">
        <h2>Traçar silhueta</h2>
        <button className="chip" type="button" onClick={onFechar}>
          Fechar
        </button>
      </div>

      {imagens.length > 1 && (
        <div className="silhueta__abas">
          {imagens.map((item, i) => (
            <button
              className={`chip ${i === indice ? 'chip--active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setIndice(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <canvas className="silhueta__previa" ref={canvasRef} />

      {!pixels && <p className="hint">Lendo a imagem…</p>}
      {resultado?.erro && <p className="alert alert--atencao">{resultado.erro}</p>}

      {traco && (
        <p className="hint">
          {traco.contornos.length} contorno(s), {furos} furo(s), {pontos} pontos ·{' '}
          {traco.larguraMm.toFixed(0)} × {traco.alturaMm.toFixed(0)} mm
        </p>
      )}

      <div className="params">
        <div className="param">
          <div className="param__head">
            <label htmlFor="silhueta-limiar">Limiar</label>
            <input
              id="silhueta-limiar"
              className="param__number"
              type="number"
              min={1}
              max={254}
              value={limiarManual ?? traco?.limiar ?? 128}
              onChange={(event) => setLimiarManual(Number(event.target.value))}
            />
            <span className="param__unit">{limiarManual === null ? 'auto' : ''}</span>
          </div>
          <input
            className="param__slider"
            type="range"
            min={1}
            max={254}
            step={1}
            aria-label="Limiar"
            value={limiarManual ?? traco?.limiar ?? 128}
            onChange={(event) => setLimiarManual(Number(event.target.value))}
          />
        </div>

        <div className="param">
          <div className="param__head">
            <label htmlFor="silhueta-suave">Suavização</label>
            <input
              id="silhueta-suave"
              className="param__number"
              type="number"
              min={0}
              max={4}
              step={0.1}
              value={suavizacao}
              onChange={(event) => setSuavizacao(Number(event.target.value))}
            />
            <span className="param__unit">px</span>
          </div>
          <input
            className="param__slider"
            type="range"
            min={0}
            max={4}
            step={0.1}
            aria-label="Suavização"
            value={suavizacao}
            onChange={(event) => setSuavizacao(Number(event.target.value))}
          />
        </div>

        <div className="param">
          <div className="param__head">
            <label htmlFor="silhueta-largura">Largura</label>
            <input
              id="silhueta-largura"
              className="param__number"
              type="number"
              min={10}
              max={250}
              value={largura}
              onChange={(event) => setLargura(Number(event.target.value))}
            />
            <span className="param__unit">mm</span>
          </div>
          <input
            className="param__slider"
            type="range"
            min={10}
            max={250}
            step={1}
            aria-label="Largura"
            value={largura}
            onChange={(event) => setLargura(Number(event.target.value))}
          />
        </div>

        <label className="param param--switch">
          <input
            type="checkbox"
            checked={inverter}
            onChange={(event) => setInverter(event.target.checked)}
          />
          <span>Inverter (traçar o claro)</span>
        </label>

        <div className="prompt__actions">
          <button
            className="button"
            type="button"
            disabled={!traco}
            onClick={() => traco && onUsar(traco, imagem.name, largura)}
          >
            Usar esta silhueta
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => setLimiarManual(null)}
            disabled={limiarManual === null}
          >
            Limiar automático
          </button>
        </div>
      </div>
    </section>
  )
}
