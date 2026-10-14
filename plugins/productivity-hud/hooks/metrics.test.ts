import { expect, test } from 'claude-code/testing'

import {
  avgGrowth,
  budgetLevel,
  contextLevel,
  emptyStats,
  parseBudget,
  promptEfficiency,
  statsMarkdown,
  turnsLeft,
  usdPerMinute,
} from './metrics'
import { donutCells, pieGlyph } from './donut'

test('las tortas y donas siguen el porcentaje', async () => {
  expect(pieGlyph(0)).toBe('○')
  expect(pieGlyph(50)).toBe('◑')
  expect(pieGlyph(140)).toBe('●')
  const donut = donutCells(58, 5, 0x4ade80, '58%')
  expect(donut.columns).toBe(10)
  // 10 × 5 celdas, 12 bytes cada una, en base64.
  expect(donut.cells.length).toBe(Math.ceil((10 * 5 * 12) / 3) * 4)
})

test('los niveles cambian de color en sus umbrales', async () => {
  expect(contextLevel(40)).toBe('ok')
  expect(contextLevel(60)).toBe('warn')
  expect(contextLevel(90)).toBe('crit')
  expect(budgetLevel(4, 5)).toBe('warn')
  expect(budgetLevel(5, 5)).toBe('crit')
})

test('el crecimiento ignora las bajadas de un /compact', async () => {
  expect(avgGrowth([10_000, 20_000, 5_000, 15_000])).toBe(10_000)
  const s = { ...emptyStats(), contextWindow: 100_000, contextTokens: 60_000, contextHistory: [40_000, 50_000, 60_000] }
  expect(turnsLeft(s)).toBe(4)
  expect(turnsLeft(emptyStats())).toBe(null)
})

test('/budget acepta montos y apagado', async () => {
  expect(parseBudget('')).toEqual({ kind: 'show' })
  expect(parseBudget('$5,50')).toEqual({ kind: 'set', usd: 5.5 })
  expect(parseBudget('off')).toEqual({ kind: 'clear' })
  expect(parseBudget('abc')).toEqual({ kind: 'invalid' })
})

test('burn-rate, eficiencia y resumen', async () => {
  const s = {
    ...emptyStats(0),
    activeMs: 120_000,
    costUsd: 1,
    turns: 2,
    inputTokens: 1_000,
    cacheReadTokens: 9_000,
    outputTokens: 500,
  }
  expect(usdPerMinute(s)).toBe(0.5)
  expect(promptEfficiency(s)).toBe(5)
  const md = statsMarkdown(s, 600_000, 0.5)
  expect(md.startsWith('## Resumen ejecutivo')).toBe(true)
  expect(md.includes('Presupuesto superado')).toBe(true)
})
