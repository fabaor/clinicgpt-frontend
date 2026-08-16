import { useEffect, useMemo, useRef, useState } from 'react'
import { InspectorPanel } from './components/InspectorPanel'
import { ParamControls } from './components/ParamControls'
import { Viewer } from './components/Viewer'
import { EXAMPLES } from './data/examples'
import { FILAMENTS, PRINTERS } from './data/printers'
import { GenerationError, MODELS, generateModel, usesProxy } from './lib/anthropic'
import { CadClient } from './lib/cadClient'
import type { BuildResult, CadModel, ChatTurn } from './types'

const API_KEY_STORAGE = 'gerador-stl:chave-api'

export default function App() {
  const clientRef = useRef<CadClient | null>(null)
  if (!clientRef.current) clientRef.current = new CadClient()
  const client = clientRef.current

  const abortRef = useRef<AbortController | null>(null)

  const [model, setModel] = useState<CadModel>(EXAMPLES[0])
  const [code, setCode] = useState(EXAMPLES[0].code)
  const [values, setValues] = useState(() => defaultsOf(EXAMPLES[0]))
  const [history, setHistory] = useState<ChatTurn[]>(() => historyForExample(EXAMPLES[0]))

  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState<BuildResult | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [isBuilding, setIsBuilding] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  const [printerId, setPrinterId] = useState(PRINTERS[0].id)
  const [filamentId, setFilamentId] = useState<string>(FILAMENTS[0].id)
  const [modelId, setModelId] = useState<string>(MODELS[1].id)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '')
  const [tab, setTab] = useState<'params' | 'code'>('params')
  const [wireframe, setWireframe] = useState(false)

  const printer = useMemo(
    () => PRINTERS.find((item) => item.id === printerId) ?? PRINTERS[0],
    [printerId],
  )
  const filament = useMemo(
    () => FILAMENTS.find((item) => item.id === filamentId) ?? FILAMENTS[0],
    [filamentId],
  )

  // Assinatura estável dos parâmetros: evita reconstruir quando o objeto muda
  // de identidade mas não de conteúdo.
  const paramsSignature = useMemo(() => JSON.stringify(values), [values])

  useEffect(() => () => client.dispose(), [client])

  useEffect(() => {
    localStorage.setItem(API_KEY_STORAGE, apiKey)
  }, [apiKey])

  // Toda mudança de código, parâmetro, impressora ou filamento reconstrói a peça.
  useEffect(() => {
    if (!code.trim()) return
    let cancelled = false

    const timer = setTimeout(() => {
      setIsBuilding(true)
      client
        .build({ code, params: JSON.parse(paramsSignature), printer, density: filament.density })
        .then((built) => {
          if (cancelled) return
          setResult(built)
          setBuildError(null)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setResult(null)
          setBuildError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!cancelled) setIsBuilding(false)
        })
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, paramsSignature, printer, filament.density, client])

  const isRefinement = history.length > 0

  async function handleGenerate(startOver: boolean) {
    const text = instruction.trim()
    if (!text || isGenerating) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsGenerating(true)
    setGenerationError(null)

    try {
      const turns = startOver ? [] : contextTurns(history, model, code, values)
      const generated = await generateModel({
        instruction: text,
        history: turns,
        printer,
        model: modelId,
        apiKey,
        signal: controller.signal,
      })

      applyModel(generated)
      setHistory([
        ...turns,
        { role: 'user', content: text },
        { role: 'assistant', content: describe(generated, defaultsOf(generated)) },
      ])
      setInstruction('')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setGenerationError(
        error instanceof GenerationError || error instanceof Error
          ? error.message
          : 'Falha inesperada ao gerar a peça.',
      )
    } finally {
      setIsGenerating(false)
    }
  }

  function applyModel(next: CadModel) {
    setModel(next)
    setCode(next.code)
    setValues(defaultsOf(next))
    setTab('params')
  }

  function loadExample(example: CadModel) {
    abortRef.current?.abort()
    applyModel(example)
    setHistory(historyForExample(example))
    setGenerationError(null)
  }

  async function handleDownload(binary: boolean) {
    try {
      const blob = await client.exportStl(binary)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${slug(model.name)}.stl`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : String(error))
    }
  }

  const canDownload = Boolean(result) && !isBuilding

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <h1>Gerador de STL</h1>
          <p>Descreva a peça em português e baixe o arquivo pronto para fatiar.</p>
        </div>

        <div className="topbar__controls">
          <label>
            Impressora
            <select value={printerId} onChange={(event) => setPrinterId(event.target.value)}>
              {PRINTERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Filamento
            <select value={filamentId} onChange={(event) => setFilamentId(event.target.value)}>
              {FILAMENTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Modelo
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {MODELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {!usesProxy && (
            <label>
              Chave da API
              <input
                type="password"
                placeholder="sk-ant-..."
                value={apiKey}
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          )}
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          <section className="prompt">
            <label htmlFor="instrucao">
              {isRefinement ? 'O que mudar na peça' : 'O que você quer imprimir'}
            </label>
            <textarea
              id="instrucao"
              rows={4}
              placeholder={
                isRefinement
                  ? 'Ex.: deixe a parede 1 mm mais grossa e arredonde os cantos de cima'
                  : 'Ex.: uma caixa 100 × 60 × 40 mm com tampa deslizante e um furo de 8 mm na lateral para passar cabo'
              }
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  void handleGenerate(false)
                }
              }}
            />

            <div className="prompt__actions">
              <button
                className="button"
                type="button"
                disabled={isGenerating || !instruction.trim()}
                onClick={() => void handleGenerate(false)}
              >
                {isGenerating ? 'Modelando…' : isRefinement ? 'Ajustar peça' : 'Gerar peça'}
              </button>
              {isRefinement && (
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={isGenerating || !instruction.trim()}
                  onClick={() => void handleGenerate(true)}
                  title="Ignora a peça atual e começa uma nova"
                >
                  Começar do zero
                </button>
              )}
            </div>

            <p className="hint">Ctrl/⌘ + Enter envia. Depois é só ajustar os controles.</p>

            {generationError && <p className="alert alert--erro">{generationError}</p>}
          </section>

          <section className="examples">
            <h2>Comece por um exemplo</h2>
            <div className="examples__list">
              {EXAMPLES.map((example) => (
                <button
                  className={`chip ${example.name === model.name ? 'chip--active' : ''}`}
                  key={example.name}
                  type="button"
                  onClick={() => loadExample(example)}
                >
                  {example.name}
                </button>
              ))}
            </div>
          </section>

          <section className="editor">
            <div className="tabs">
              <button
                className={`tab ${tab === 'params' ? 'tab--active' : ''}`}
                type="button"
                onClick={() => setTab('params')}
              >
                Parâmetros
              </button>
              <button
                className={`tab ${tab === 'code' ? 'tab--active' : ''}`}
                type="button"
                onClick={() => setTab('code')}
              >
                Código
              </button>
            </div>

            {tab === 'params' ? (
              <ParamControls
                params={model.params}
                values={values}
                disabled={isGenerating}
                onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
                onReset={() => setValues(defaultsOf(model))}
              />
            ) : (
              <div className="code">
                <textarea
                  spellCheck={false}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <p className="hint">
                  Editar aqui reconstrói a peça na hora. A API do JSCAD já está no escopo.
                </p>
              </div>
            )}
          </section>
        </aside>

        <section className="stage">
          <div className="stage__viewer">
            <Viewer positions={result?.positions ?? null} printer={printer} wireframe={wireframe} />

            {(isBuilding || isGenerating) && (
              <div className="stage__status">{isGenerating ? 'Modelando a peça…' : 'Calculando…'}</div>
            )}

            {buildError && (
              <div className="stage__error">
                <strong>O código não gerou uma peça válida.</strong>
                <span>{buildError}</span>
                <span className="hint">
                  Descreva o ajuste no campo ao lado — o modelo corrige a partir do código atual.
                </span>
              </div>
            )}
          </div>

          <div className="stage__toolbar">
            <h2 className="stage__title">{model.name}</h2>
            <label className="toggle">
              <input
                type="checkbox"
                checked={wireframe}
                onChange={(event) => setWireframe(event.target.checked)}
              />
              Malha
            </label>
            <button
              className="button"
              type="button"
              disabled={!canDownload}
              onClick={() => void handleDownload(true)}
            >
              Baixar STL
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={!canDownload}
              onClick={() => void handleDownload(false)}
              title="STL em texto, útil para inspecionar o arquivo"
            >
              STL ASCII
            </button>
          </div>

          <InspectorPanel model={model} result={result} filamentLabel={filament.label} />
        </section>
      </main>
    </div>
  )
}

function defaultsOf(model: CadModel): Record<string, number | boolean> {
  return Object.fromEntries(model.params.map((param) => [param.name, param.default]))
}

/** Resumo do estado atual enviado ao modelo quando o usuário pede um ajuste. */
function describe(model: CadModel, values: Record<string, number | boolean>): string {
  return [
    model.name,
    `Parâmetros atuais: ${JSON.stringify(values)}`,
    '```js',
    model.code,
    '```',
  ].join('\n')
}

function historyForExample(example: CadModel): ChatTurn[] {
  return [
    { role: 'user', content: `Modele: ${example.name}. ${example.summary}` },
    { role: 'assistant', content: describe(example, defaultsOf(example)) },
  ]
}

/**
 * O modelo precisa ver o código que está de fato na tela — o usuário pode ter
 * mexido nos parâmetros ou editado o código à mão desde a última geração.
 */
function contextTurns(
  history: ChatTurn[],
  model: CadModel,
  code: string,
  values: Record<string, number | boolean>,
): ChatTurn[] {
  if (history.length === 0) return []
  const turns = history.slice(0, -1)
  return [...turns, { role: 'assistant', content: describe({ ...model, code }, values) }]
}

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'peca'
  )
}
