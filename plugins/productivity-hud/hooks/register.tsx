/**
 * productivity-hud: un HUD de productividad para la sesión.
 *
 * - Banda sobre el prompt: contexto, costo, burn-rate y presupuesto, con un
 *   spinner mientras corre un turno.
 * - Panel `/hud`: el desglose completo.
 * - `/budget [USD]`: límite de gasto de la sesión, con alerta en rojo.
 * - `/stats`: resumen ejecutivo en Markdown (`/stats claude` abre el de Claude Code).
 *
 * El costo y el llenado del contexto salen de `$.session.usage()`, el mismo
 * registro que usan /cost y la status line, así que no dependen de tarifas
 * escritas aquí. Los tokens se suman desde el `usage` de cada `turn.complete`.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { SessionStats } from '../types'
import {
  HISTORY_SIZE,
  LEVEL_COLOR,
  SPINNER,
  budgetLevel,
  cacheHitRate,
  contextLevel,
  contextPercent,
  costPerTurn,
  efficiencyLevel,
  emptyStats,
  fmtDuration,
  fmtTokens,
  fmtUsd,
  parseBudget,
  promptEfficiency,
  statsMarkdown,
  tokensPerMinute,
  totalInput,
  turnsLeft,
  usdPerMinute,
} from './metrics'
import { LEVEL_RGB, donutCells, pieGlyph } from './donut'
import type { Level } from './metrics'

const PANE = 'productivity-hud'
const PANE_TITLE = 'Productivity HUD'

// Estado de la sesión en `$.state`: sobrevive a una recarga del módulo.
const stats = atom({ plugin: 'productivity-hud', key: 'stats' } as const, emptyStats())
const isBusy = atom({ plugin: 'productivity-hud', key: 'isBusy' } as const, false)
const busySince = atom({ plugin: 'productivity-hud', key: 'busySince' } as const, 0)
const frame = atom({ plugin: 'productivity-hud', key: 'frame' } as const, 0)
const budget = atom({ plugin: 'productivity-hud', key: 'budget' } as const, null)
const isBudgetAlerted = atom(
  { plugin: 'productivity-hud', key: 'isBudgetAlerted' } as const,
  false,
)

/** Cada cuánto avanza el spinner, y cada cuántos cuadros se relee el costo. */
const SPIN_MS = 120
const REFRESH_EVERY_FRAMES = 16

/** Relee costo y contexto del motor y avisa si se cruzó el presupuesto. */
async function refreshUsage($: $) {
  const usage = await $.session.usage()
  await update($, stats, s => ({
    ...s,
    startedAt: usage.startedAt,
    costUsd: usage.cost?.usd ?? s.costUsd,
    contextTokens: usage.context.tokens ?? s.contextTokens,
    contextWindow: usage.context.window,
  }))
  await checkBudget($)
}

/** Avisa una vez, con un toast, cuando el gasto alcanza el presupuesto. */
async function checkBudget($: $) {
  const limit = await read($, budget)
  if (limit === null || (await read($, isBudgetAlerted))) return
  const { costUsd } = await read($, stats)
  if (costUsd < limit) return
  await update($, isBudgetAlerted, () => true)
  $.ui.toast(
    `⚠ Presupuesto superado: ${fmtUsd(costUsd)} de ${fmtUsd(limit)}. Considera /compact.`,
    { timeoutMs: 8000 },
  )
}

export const register: Register = on => {
  // El temporizador del spinner es del módulo: una recarga lo cancela sola.
  let spin: { cancel: () => void } | undefined

  const stopSpinner = () => {
    spin?.cancel()
    spin = undefined
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'hud', description: 'Muestra u oculta el panel del Productivity HUD' })
      .catch(() => $.ui.toast('productivity-hud: no se pudo registrar /hud'))
    await $.command
      .register({
        name: 'budget',
        description: 'Fija el presupuesto de la sesión en USD (/budget 5, /budget off)',
      })
      .catch(() => $.ui.toast('productivity-hud: no se pudo registrar /budget'))
    // Una recarga del módulo puede dejar un turno marcado como en curso.
    await update($, isBusy, () => false)
    await refreshUsage($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, busySince, () => now)
    await update($, isBusy, () => true)
    stopSpinner()
    spin = $.clock.every(SPIN_MS, () => {
      void update($, frame, n => n + 1).then(async n => {
        if (n % REFRESH_EVERY_FRAMES === 0) await refreshUsage($)
      })
    })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // Contar no debe frenar la herramienta: se escribe sin esperar.
    void update($, stats, s => ({ ...s, toolCalls: s.toolCalls + 1 })).catch(() => {})

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage
    const isMain = e.agentId === undefined

    await update($, stats, s => ({
      ...s,
      inputTokens: s.inputTokens + (usage?.input_tokens ?? 0),
      outputTokens: s.outputTokens + (usage?.output_tokens ?? 0),
      cacheReadTokens: s.cacheReadTokens + (usage?.cache_read_input_tokens ?? 0),
      cacheWriteTokens: s.cacheWriteTokens + (usage?.cache_creation_input_tokens ?? 0),
      model: usage?.model ?? s.model,
      turns: isMain ? s.turns + 1 : s.turns,
      activeMs: isMain ? s.activeMs + e.durationMs : s.activeMs,
    }))

    if (isMain) {
      stopSpinner()
      await update($, isBusy, () => false)
      await refreshUsage($)
      await update($, stats, s => ({
        ...s,
        contextHistory: [...s.contextHistory, s.contextTokens].slice(-HISTORY_SIZE),
      }))
    }

    return result
  })

  // ── Comandos ─────────────────────────────────────────────────────────────

  on('command.run', { command: 'hud' }, async $ => {
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isUp) {
      await $.ui.close({ id: PANE })
      return { text: 'Productivity HUD: panel cerrado.' }
    }
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    return {
      text: opened.isPlaced
        ? 'Productivity HUD: panel abierto.'
        : 'Productivity HUD: el panel se mostrará cuando el terminal tenga espacio.',
    }
  })

  on('command.run', { command: 'budget' }, async ($, e) => {
    const parsed = parseBudget(e.args)
    const { costUsd } = await read($, stats)

    if (parsed.kind === 'invalid') {
      return { text: 'Uso: /budget <USD> (ej. /budget 5), /budget off, o /budget para ver el actual.' }
    }
    if (parsed.kind === 'show') {
      const limit = await read($, budget)
      return {
        text:
          limit === null
            ? `Sin presupuesto. Gasto actual: ${fmtUsd(costUsd)}. Fíjalo con /budget <USD>.`
            : `Presupuesto: ${fmtUsd(costUsd)} de ${fmtUsd(limit)} (${((costUsd / limit) * 100).toFixed(0)} %).`,
      }
    }
    if (parsed.kind === 'clear') {
      await update($, budget, () => null)
      await update($, isBudgetAlerted, () => false)
      return { text: 'Presupuesto quitado.' }
    }
    await update($, budget, () => parsed.usd)
    await update($, isBudgetAlerted, () => false)
    await checkBudget($)
    return {
      text: `Presupuesto fijado en ${fmtUsd(parsed.usd)}. Gasto actual: ${fmtUsd(costUsd)}.`,
    }
  })

  // /stats es un comando de Claude Code: este hook responde en su lugar con el
  // resumen del HUD, y `/stats claude` deja pasar el original.
  on('command.run', { command: 'stats' }, async ($, e, next) => {
    if (e.args.trim().toLowerCase() === 'claude') return next(e)
    await refreshUsage($)
    const text = statsMarkdown(await read($, stats), await $.clock.now(), await read($, budget))
    return { text }
  })

  // Dibuja la salida de /stats como Markdown en el transcript.
  on('ui.render', { component: 'CommandOutput', props: { command: 'stats' } }, ($, e, next) => {
    if (!e.props.text.startsWith('## Resumen ejecutivo')) return next(e)
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  // ── Banda sobre el prompt ────────────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, stats)
    const busy = await read($, isBusy)
    const tick = await read($, frame)
    const limit = await read($, budget)
    const since = await read($, busySince)
    const cols = e.props.bodyColumns
    const liveMs = busy ? Math.max(0, (await $.clock.now()) - since) : 0

    const pct = contextPercent(s)
    const ctxColor = LEVEL_COLOR[contextLevel(pct)]
    const left = turnsLeft(s)
    const isWide = cols >= 110
    const isMid = cols >= 72
    const overBudget = limit !== null && s.costUsd >= limit

    const status = busy ? (
      <Text color="claude">
        {SPINNER[tick % SPINNER.length]} {fmtDuration(liveMs)}
        {'  '}
      </Text>
    ) : (
      <Text color="success">● </Text>
    )

    const ctx = (
      <Text>
        <Text dimColor>CTX </Text>
        <Text color={ctxColor} bold>
          {pieGlyph(pct)} {pct.toFixed(0)}%
        </Text>
        {isWide && left !== null && <Text dimColor> ~{left} turnos</Text>}
      </Text>
    )

    const cost = (
      <Text>
        <Text dimColor>{'   '}$ </Text>
        {limit !== null && (
          <Text color={LEVEL_COLOR[budgetLevel(s.costUsd, limit)]}>
            {pieGlyph((s.costUsd / limit) * 100)}{' '}
          </Text>
        )}
        <Text bold color={overBudget ? 'error' : 'text'}>
          {fmtUsd(s.costUsd).slice(1)}
        </Text>
        {limit !== null && <Text dimColor>/{fmtUsd(limit).slice(1)}</Text>}
        {isWide && s.turns > 0 && <Text dimColor> · {fmtUsd(costPerTurn(s))}/turno</Text>}
      </Text>
    )

    const burn = isMid && (
      <Text>
        <Text dimColor>{'   '}⚡ </Text>
        <Text>{fmtUsd(usdPerMinute(s, liveMs))}/min</Text>
        {isWide && <Text dimColor> · {fmtTokens(tokensPerMinute(s, liveMs))} tok/min</Text>}
      </Text>
    )

    const eff = promptEfficiency(s)
    const efficiency = isWide && totalInput(s) > 0 && (
      <Text>
        <Text dimColor>{'   '}EF </Text>
        <Text color={LEVEL_COLOR[efficiencyLevel(eff)]}>{eff.toFixed(1)}</Text>
      </Text>
    )

    return (
      <Box flexDirection="column">
        <Box>
          {status}
          {ctx}
          {cost}
          {burn}
          {efficiency}
        </Box>
        {overBudget && e.props.maxRows >= 2 && (
          <Text color="error" bold>
            ⚠ Presupuesto superado ({fmtUsd(s.costUsd)} de {fmtUsd(limit)}): usa /compact o acota la tarea.
          </Text>
        )}
      </Box>
    )
  })

  // ── Panel con el desglose ────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Raster, Text } = $.ui.resolve(e)
    const s = await read($, stats)
    const busy = await read($, isBusy)
    const tick = await read($, frame)
    const limit = await read($, budget)
    const since = await read($, busySince)
    const now = await $.clock.now()
    const liveMs = busy ? Math.max(0, now - since) : 0

    const pct = contextPercent(s)
    const ctxLevel = contextLevel(pct)
    const left = turnsLeft(s)
    const eff = promptEfficiency(s)

    /** Una fila `etiqueta  valor`. */
    const row = (label: string, value: string, color?: string) => (
      <Box>
        <Text dimColor>{label.padEnd(14)}</Text>
        <Text color={color} bold={color !== undefined}>
          {value}
        </Text>
      </Box>
    )
    // Donas: contexto, presupuesto (si hay) y aciertos de caché, del tamaño
    // impar más grande (hasta 7 filas) que entra a lo ancho del panel.
    const hit = cacheHitRate(s)
    const charts: { key: string; title: string; percent: number; level: Level }[] = [
      { key: 'ctx', title: 'Contexto', percent: pct, level: ctxLevel },
      ...(limit === null
        ? []
        : [{ key: 'budget', title: 'Presupuesto', percent: (s.costUsd / limit) * 100, level: budgetLevel(s.costUsd, limit) }]),
      { key: 'cache', title: 'Caché', percent: hit, level: (hit >= 70 ? 'ok' : hit >= 40 ? 'warn' : 'crit') as Level },
    ]
    const gap = 3
    let size = 7
    while (size > 3 && charts.length * size * 2 + (charts.length - 1) * gap > e.props.bodyColumns) size -= 2
    const donuts = (
      <Box gap={gap}>
        {charts.map(chart => {
          const donut = donutCells(chart.percent, size, LEVEL_RGB[chart.level], `${Math.round(chart.percent)}%`)
          return (
            <Box key={chart.key} flexDirection="column" alignItems="center">
              <Raster key={chart.key} columns={donut.columns} rows={donut.rows} cells={donut.cells} />
              <Text dimColor>{chart.title}</Text>
            </Box>
          )
        })}
      </Box>
    )

    const heading = (title: string) => (
      <Box marginTop={1}>
        <Text bold color="claude">
          {title}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text color={busy ? 'claude' : 'success'}>
          {busy ? `${SPINNER[tick % SPINNER.length]} Procesando… ${fmtDuration(liveMs)}` : '● En espera'}
        </Text>

        <Box marginTop={1}>{donuts}</Box>

        {heading('Contexto')}
        {row('Usado', `${fmtTokens(s.contextTokens)} de ${fmtTokens(s.contextWindow)}`)}
        {row('Restante', left === null ? 'calculando…' : `~${left} turnos antes de llenarse`)}
        {ctxLevel !== 'ok' && <Text color={LEVEL_COLOR[ctxLevel]}>Sugerencia: /compact</Text>}

        {heading('Inversión')}
        {row('Total', fmtUsd(s.costUsd), limit !== null && s.costUsd >= limit ? 'error' : 'text')}
        {row('Por turno', fmtUsd(costPerTurn(s)))}
        {row('Turnos', String(s.turns))}

        {heading('Presupuesto')}
        {limit === null ? (
          <Text dimColor>Sin límite. Fíjalo con /budget &lt;USD&gt;.</Text>
        ) : (
          <Box flexDirection="column">
            {row('Límite', `${fmtUsd(s.costUsd)} de ${fmtUsd(limit)}`)}
            {s.costUsd >= limit && (
              <Text color="error" bold>
                ⚠ Superado: compacta el contexto o acota la tarea.
              </Text>
            )}
          </Box>
        )}

        {heading('Velocidad')}
        {row('Gasto', `${fmtUsd(usdPerMinute(s, liveMs))}/min activo`)}
        {row('Tokens', `${fmtTokens(tokensPerMinute(s, liveMs))}/min activo`)}
        {row('Tiempo activo', fmtDuration(s.activeMs + liveMs))}
        {row('Sesión', fmtDuration(Math.max(0, now - s.startedAt)))}

        {heading('Eficiencia')}
        {row('Prompt', `${eff.toFixed(1)} gen. / 100 ctx`, LEVEL_COLOR[efficiencyLevel(eff)])}
        {row('Caché', `${cacheHitRate(s).toFixed(0)} % de aciertos`)}
        {row('Herramientas', String(s.toolCalls))}

        {heading('Tokens')}
        {row('Entrada', fmtTokens(s.inputTokens))}
        {row('Caché leída', fmtTokens(s.cacheReadTokens))}
        {row('Caché escrita', fmtTokens(s.cacheWriteTokens))}
        {row('Salida', fmtTokens(s.outputTokens))}
        {s.model !== '' && <Text dimColor>{s.model}</Text>}
      </Box>
    )
  })

  // Muestra el costo en vivo junto al spinner del turno: "Pensando… $0.42".
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const s: SessionStats = await read($, stats)
    if (s.costUsd <= 0) return next(e)
    return next({ ...e, props: { ...e.props, suffix: `… ${fmtUsd(s.costUsd)}` } })
  })
}
