import * as namespace from '@jscad/modeling'

/**
 * @jscad/modeling é CommonJS: dependendo do bundler os módulos chegam como
 * exports nomeados ou embrulhados em `default`. Resolvemos isso num lugar só.
 */
export const jscad = ((namespace as { default?: typeof namespace }).default ??
  namespace) as typeof namespace

export type Geom3 = ReturnType<typeof jscad.primitives.cube>
export type Geom2 = ReturnType<typeof jscad.primitives.rectangle>
