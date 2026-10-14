/**
 * Gráficos circulares para el terminal.
 *
 * - `pieGlyph`: una torta de un solo carácter (○◔◑◕●) para la banda.
 * - `donutCells`: una dona para un `Raster`. Cada celda lleva dos píxeles
 *   (medio bloque arriba y abajo) y una celda mide el doble de alta que de
 *   ancha, así que `rows` filas por `2 * rows` columnas dan un círculo.
 */
import type { Level } from './metrics'

/** Colores RGB de cada nivel (los del tema no sirven dentro de un Raster). */
export const LEVEL_RGB: Record<Level, number> = {
  ok: 0x4ade80,
  warn: 0xfbbf24,
  crit: 0xf87171,
}

/** La parte vacía del anillo. */
export const TRACK_RGB = 0x3f3f46

/** El color por defecto del terminal (transparente). */
const DEFAULT = 0x01000000

const SPACE = 0x20
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584

const PIES = ['○', '◔', '◑', '◕', '●'] as const

/** Torta de un carácter: vacía, un cuarto, media, tres cuartos o llena. */
export const pieGlyph = (percent: number): string =>
  PIES[Math.round(Math.max(0, Math.min(100, percent)) / 25)] ?? '○'

/** Grosor del anillo: el agujero mide este tanto del radio. */
const HOLE = 0.58

/**
 * Las celdas de una dona de `rows` filas (mejor impar, para centrar el texto)
 * y `2 * rows` columnas, llena en sentido horario desde las 12 hasta
 * `percent`, con `label` escrito en el centro.
 */
export const donutCells = (
  percent: number,
  rows: number,
  color: number,
  label: string,
): { cells: string; columns: number; rows: number } => {
  const columns = rows * 2
  const height = rows * 2
  const radius = columns / 2
  const hole = radius * HOLE
  const fill = Math.max(0, Math.min(100, percent)) / 100

  /** El color del píxel (x, y), o DEFAULT fuera del anillo. */
  const pixel = (x: number, y: number): number => {
    const dx = x + 0.5 - columns / 2
    const dy = y + 0.5 - height / 2
    const d = Math.hypot(dx, dy)
    if (d > radius || d < hole) return DEFAULT
    // Ángulo desde las 12, en sentido horario, de 0 a 1.
    const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1
    return turn < fill ? color : TRACK_RGB
  }

  const words = new Uint32Array(columns * rows * 3)
  const put = (i: number, code: number, fg: number, bg: number) => {
    words[i * 3] = code
    words[i * 3 + 1] = fg
    words[i * 3 + 2] = bg
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const top = pixel(col, row * 2)
      const bottom = pixel(col, row * 2 + 1)
      const i = row * columns + col
      if (top === DEFAULT && bottom === DEFAULT) put(i, SPACE, DEFAULT, DEFAULT)
      else if (top === DEFAULT) put(i, LOWER_HALF, bottom, DEFAULT)
      else put(i, UPPER_HALF, top, bottom)
    }
  }

  // El texto va en la fila central, sobre el agujero.
  const text = [...label].slice(0, Math.max(0, Math.floor(hole * 2) - 1))
  const mid = Math.floor(rows / 2)
  const start = Math.floor((columns - text.length) / 2)
  text.forEach((ch, k) => put(mid * columns + start + k, ch.codePointAt(0) ?? SPACE, color, DEFAULT))

  return { cells: toBase64(words), columns, rows }
}

/** Base64 de los bytes de `words`, cada u32 en little-endian. */
const toBase64 = (words: Uint32Array): string => {
  const bytes = new Uint8Array(words.length * 4)
  const view = new DataView(bytes.buffer)
  words.forEach((w, i) => view.setUint32(i * 4, w, true))
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? abc[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? abc[n & 63]! : '='
  }
  return out
}
