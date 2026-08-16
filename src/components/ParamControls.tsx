import type { ParamSpec } from '../types'

type Props = {
  params: ParamSpec[]
  values: Record<string, number | boolean>
  onChange: (name: string, value: number | boolean) => void
  onReset: () => void
  disabled: boolean
}

export function ParamControls({ params, values, onChange, onReset, disabled }: Props) {
  if (params.length === 0) {
    return <p className="empty">Esta peça não expôs parâmetros ajustáveis.</p>
  }

  return (
    <div className="params">
      {params.map((param) => {
        const value = values[param.name] ?? param.default

        if (param.type === 'boolean') {
          return (
            <label className="param param--switch" key={param.name}>
              <input
                type="checkbox"
                checked={Boolean(value)}
                disabled={disabled}
                onChange={(event) => onChange(param.name, event.target.checked)}
              />
              <span>{param.label}</span>
            </label>
          )
        }

        const numeric = Number(value)
        return (
          <div className="param" key={param.name}>
            <div className="param__head">
              <label htmlFor={`param-${param.name}`}>{param.label}</label>
              <input
                id={`param-${param.name}`}
                className="param__number"
                type="number"
                value={numeric}
                min={param.min}
                max={param.max}
                step={param.step}
                disabled={disabled}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) onChange(param.name, next)
                }}
              />
              <span className="param__unit">{param.unit ?? ''}</span>
            </div>
            <input
              className="param__slider"
              type="range"
              value={numeric}
              min={param.min}
              max={param.max}
              step={param.step}
              disabled={disabled}
              aria-label={param.label}
              onChange={(event) => onChange(param.name, Number(event.target.value))}
            />
          </div>
        )
      })}

      <button className="button button--ghost" type="button" onClick={onReset} disabled={disabled}>
        Voltar aos valores originais
      </button>
    </div>
  )
}
