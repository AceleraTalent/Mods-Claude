/** Contadores de la sesión que el HUD acumula y dibuja. */
export type SessionStats = {
  /** Inicio de la sesión, en milisegundos de `$.clock.now()`. */
  startedAt: number
  /** Tiempo con un turno en curso, en ms (base del burn-rate). */
  activeMs: number
  /** Turnos del hilo principal terminados. */
  turns: number
  /** Llamadas a herramientas, subagentes incluidos. */
  toolCalls: number
  /** Tokens de entrada sin caché. */
  inputTokens: number
  /** Tokens generados. */
  outputTokens: number
  /** Tokens de entrada servidos por la caché. */
  cacheReadTokens: number
  /** Tokens de entrada escritos en la caché. */
  cacheWriteTokens: number
  /** Costo en USD según el registro del motor (el mismo de /cost). */
  costUsd: number
  /** Tokens del contexto en la última respuesta. */
  contextTokens: number
  /** Ventana de contexto del modelo, en tokens. */
  contextWindow: number
  /** Tamaño del contexto al final de los últimos turnos (para estimar el crecimiento). */
  contextHistory: number[]
  /** Último modelo que respondió. */
  model: string
}

declare module 'claude-code' {
  interface PluginState {
    'productivity-hud': {
      stats: SessionStats
      /** Si hay un turno en curso. */
      isBusy: boolean
      /** Cuándo empezó el turno en curso, en ms. */
      busySince: number
      /** Cuadro de la animación del spinner. */
      frame: number
      /** Límite de presupuesto en USD; null sin límite. */
      budget: number | null
      /** Si ya se avisó que se superó el presupuesto. */
      isBudgetAlerted: boolean
    }
  }
}
