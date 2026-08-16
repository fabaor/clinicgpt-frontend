import type { BuildResult, CadModel } from '../types'

type Props = {
  model: CadModel
  result: BuildResult | null
  filamentLabel: string
}

export function InspectorPanel({ model, result, filamentLabel }: Props) {
  return (
    <div className="inspector">
      {model.summary && <p className="inspector__summary">{model.summary}</p>}

      {result && (
        <dl className="metrics">
          <Metric
            label="Dimensões"
            value={result.stats.dimensions.map((d) => fmt(d)).join(' × ')}
            unit="mm"
          />
          <Metric label="Volume" value={fmt(result.stats.volumeMm3 / 1000)} unit="cm³" />
          <Metric
            label={`Massa (${filamentLabel} maciço)`}
            value={fmt(result.stats.gramsEstimate)}
            unit="g"
          />
          <Metric label="Triângulos" value={result.stats.triangles.toLocaleString('pt-BR')} unit="" />
        </dl>
      )}

      {result?.warnings.map((warning, index) => (
        <p className={`alert alert--${warning.level}`} key={index}>
          {warning.message}
        </p>
      ))}

      {model.printNotes && (
        <section className="inspector__notes">
          <h3>Notas de impressão</h3>
          <p>{model.printNotes}</p>
        </section>
      )}

      <p className="inspector__disclaimer">
        A massa considera a peça 100% maciça — com preenchimento de 20% o gasto real fica perto de
        um terço disso. Confira sempre a peça no fatiador antes de imprimir.
      </p>
    </div>
  )
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        {value}
        {unit && <span className="metric__unit">{unit}</span>}
      </dd>
    </div>
  )
}

function fmt(value: number): string {
  const decimals = Math.abs(value) >= 100 ? 0 : 1
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
