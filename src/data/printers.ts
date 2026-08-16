import type { PrinterProfile } from '../types'

export const PRINTERS: PrinterProfile[] = [
  { id: 'ender3', label: 'Ender 3 / V2 (220 × 220 × 250)', bed: [220, 220, 250], nozzle: 0.4 },
  { id: 'bambu-a1-mini', label: 'Bambu A1 mini (180 × 180 × 180)', bed: [180, 180, 180], nozzle: 0.4 },
  { id: 'bambu-p1s', label: 'Bambu P1S / X1C (256 × 256 × 256)', bed: [256, 256, 256], nozzle: 0.4 },
  { id: 'prusa-mk4', label: 'Prusa MK4 (250 × 210 × 220)', bed: [250, 210, 220], nozzle: 0.4 },
  { id: 'grande', label: 'Formato grande (300 × 300 × 400)', bed: [300, 300, 400], nozzle: 0.6 },
]

export const FILAMENTS = [
  { id: 'pla', label: 'PLA', density: 1.24 },
  { id: 'petg', label: 'PETG', density: 1.27 },
  { id: 'abs', label: 'ABS', density: 1.04 },
  { id: 'tpu', label: 'TPU', density: 1.21 },
] as const
