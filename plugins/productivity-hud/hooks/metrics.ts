/**
 * Cálculos puros del HUD: no tocan `$`, así se prueban sin el motor.
 */
import type { SessionStats } from '../types'

/** Nivel de alerta de una métrica: verde, amarillo o rojo. */
export type Level = 'ok' | 'warn' | 'crit'

/** Color del tema del terminal para cada nivel. */
export const LEVEL_COLOR = { ok: 'success', warn: 'warning', crit: 'error' } as const

/** Cuántos tamaños de contexto se guardan para estimar el crecimiento por turno. */
export const HISTORY_SIZE = 20

/** Cuadros del spinner (braille). */
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export const emptyStats = (startedAt = 0): SessionStats => ({
  startedAt,
  activeMs: 0,
  turns: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  contextTokens: 0,
  contextWindow: 0,
  contextHistory: [],
  model: '',
})

/** Porcentaje (0-100) de la ventana de contexto usada. */
export const contextPercent = (s: SessionStats): number =>
  s.contextWindow > 0 ? Math.min(100, (s.contextTokens / s.contextWindow) * 100) : 0

/** Nivel del contexto: amarillo desde 60 %, rojo desde 85 %. */
export const contextLevel = (percent: number): Level =>
  percent >= 85 ? 'crit' : percent >= 60 ? 'warn' : 'ok'

/** Nivel del presupuesto: amarillo desde 75 %, rojo al superarlo. */
export const budgetLevel = (cost: number, budget: number): Level =>
  cost >= budget ? 'crit' : cost >= budget * 0.75 ? 'warn' : 'ok'

/**
 * Crecimiento medio del contexto por turno, en tokens: el promedio de las
 * subidas entre turnos seguidos (una bajada es un /compact y no cuenta).
 */
export const avgGrowth = (history: readonly number[]): number => {
  const rises: number[] = []
  for (let i = 1; i < history.length; i++) {
    const delta = (history[i] ?? 0) - (history[i - 1] ?? 0)
    if (delta > 0) rises.push(delta)
  }
  return rises.length === 0 ? 0 : rises.reduce((a, b) => a + b, 0) / rises.length
}

/** Turnos que caben antes de llenar el contexto; null sin datos suficientes. */
export const turnsLeft = (s: SessionStats): number | null => {
  const growth = avgGrowth(s.contextHistory)
  if (growth <= 0 || s.contextWindow <= 0) return null
  return Math.max(0, Math.floor((s.contextWindow - s.contextTokens) / growth))
}

/** Tokens de entrada procesados: sin caché, leídos y escritos en caché. */
export const totalInput = (s: SessionStats): number =>
  s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens

/** Costo medio por turno en USD. */
export const costPerTurn = (s: SessionStats): number => (s.turns > 0 ? s.costUsd / s.turns : 0)

/** Minutos activos (con un turno en curso), al menos una fracción para no dividir por cero. */
const activeMinutes = (s: SessionStats, extraMs = 0): number =>
  Math.max((s.activeMs + extraMs) / 60_000, 1 / 60)

/** Gasto por minuto activo, en USD. */
export const usdPerMinute = (s: SessionStats, extraMs = 0): number =>
  s.activeMs + extraMs > 0 ? s.costUsd / activeMinutes(s, extraMs) : 0

/** Tokens (entrada + salida) por minuto activo. */
export const tokensPerMinute = (s: SessionStats, extraMs = 0): number =>
  s.activeMs + extraMs > 0 ? (totalInput(s) + s.outputTokens) / activeMinutes(s, extraMs) : 0

/**
 * Eficiencia de prompt: tokens generados por cada 100 de contexto consumido.
 * Alta (≥ 3) cuando cada turno produce mucho sobre poco contexto.
 */
export const promptEfficiency = (s: SessionStats): number => {
  const input = totalInput(s)
  return input > 0 ? (s.outputTokens / input) * 100 : 0
}

export const efficiencyLevel = (eff: number): Level => (eff >= 3 ? 'ok' : eff >= 1 ? 'warn' : 'crit')

/** Porcentaje de la entrada servida por la caché (más alto, más barato). */
export const cacheHitRate = (s: SessionStats): number => {
  const input = totalInput(s)
  return input > 0 ? (s.cacheReadTokens / input) * 100 : 0
}

/** `12.3k`, `1.2M`. */
export const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`

/** `$0.0042` para montos chicos, `$1.24` para el resto. */
export const fmtUsd = (n: number): string => `$${n < 0.1 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`

/** `1h 05m`, `4m 12s`, `9s`. */
export const fmtDuration = (ms: number): string => {
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** Interpreta el argumento de /budget: `5`, `$5`, `5,50`; `off` u `0` lo quitan. */
export const parseBudget = (
  args: string,
): { kind: 'show' } | { kind: 'clear' } | { kind: 'set'; usd: number } | { kind: 'invalid' } => {
  const raw = args.trim().toLowerCase()
  if (raw === '') return { kind: 'show' }
  if (raw === 'off' || raw === 'clear' || raw === 'none') return { kind: 'clear' }
  const usd = Number(raw.replace(/^\$/, '').replace(',', '.'))
  if (!Number.isFinite(usd) || usd < 0) return { kind: 'invalid' }
  return usd === 0 ? { kind: 'clear' } : { kind: 'set', usd }
}

/** Resumen ejecutivo en Markdown para /stats. */
export const statsMarkdown = (s: SessionStats, now: number, budget: number | null): string => {
  const wallMs = Math.max(0, now - s.startedAt)
  const pct = contextPercent(s)
  const left = turnsLeft(s)
  const perHour = wallMs > 0 ? s.costUsd / (wallMs / 3_600_000) : 0
  const costPerTool = s.toolCalls > 0 ? s.costUsd / s.toolCalls : 0
  const lines = [
    '## Resumen ejecutivo de la sesión',
    '',
    '| Métrica | Valor |',
    '| --- | --- |',
    `| Tiempo transcurrido | ${fmtDuration(wallMs)} (${fmtDuration(s.activeMs)} activo) |`,
    `| Inversión total | **${fmtUsd(s.costUsd)}** |`,
    `| Costo por hora (reloj) | ${fmtUsd(perHour)} |`,
    `| Turnos completados | ${s.turns} · ${fmtUsd(costPerTurn(s))} por turno |`,
    `| Herramientas ejecutadas | ${s.toolCalls} · ${fmtUsd(costPerTool)} por herramienta |`,
    `| Burn-rate (activo) | ${fmtUsd(usdPerMinute(s))}/min · ${fmtTokens(tokensPerMinute(s))} tokens/min |`,
    `| Contexto | ${pct.toFixed(0)} % de ${fmtTokens(s.contextWindow)}${left === null ? '' : ` · ~${left} turnos restantes`} |`,
    `| Tokens | ${fmtTokens(totalInput(s))} entrada · ${fmtTokens(s.outputTokens)} salida |`,
    `| Eficiencia de prompt | ${promptEfficiency(s).toFixed(1)} tokens generados por cada 100 de contexto |`,
    `| Aciertos de caché | ${cacheHitRate(s).toFixed(0)} % de la entrada |`,
  ]
  if (budget !== null) {
    lines.push(`| Presupuesto | ${fmtUsd(s.costUsd)} de ${fmtUsd(budget)} (${((s.costUsd / budget) * 100).toFixed(0)} %) |`)
  }
  const tips: string[] = []
  if (pct >= 60) tips.push('El contexto pasa del 60 %: un `/compact` abarata los próximos turnos.')
  if (budget !== null && s.costUsd >= budget) tips.push('Presupuesto superado: compacta el contexto o acota el alcance de las tareas.')
  if (s.turns >= 3 && cacheHitRate(s) < 50) tips.push('Pocos aciertos de caché: pausas largas entre turnos hacen que la caché expire.')
  if (tips.length > 0) lines.push('', '### Recomendaciones', '', ...tips.map(t => `- ${t}`))
  if (s.model) lines.push('', `_Modelo: ${s.model}. El costo es el del registro del motor, el mismo de /cost._`)
  return lines.join('\n')
}
