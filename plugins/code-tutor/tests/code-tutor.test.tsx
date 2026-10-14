import { expect, mock, test } from 'claude-code/testing'

// @ts-ignore: the hooks module is plain JavaScript
import { chatPrompt, clip, describeChange, headline, lessonPrompt } from '../hooks/register.js'

const LESSON = '**Qué cambió**: Se añadió una guarda.\n**Por qué**: Evita dividir entre cero.'
const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('reads the change each editing tool made', async () => {
  expect(describeChange({ tool: 'Edit', file_path: '/a.ts', old_string: 'x', new_string: 'y' })).toEqual({
    tool: 'Edit', file: '/a.ts', before: 'x', after: 'y',
  })
  expect(describeChange({ tool: 'Write', file_path: '/b.ts', content: 'z' })?.after).toBe('z')
  expect(describeChange({ tool: 'NotebookEdit', notebook_path: '/c.ipynb', new_source: 'w' })?.file).toBe('/c.ipynb')
  expect(describeChange({ tool: 'Bash', command: 'ls' })).toBe(null)
})

test('builds the prompts the tutor is sent', async () => {
  const change = { tool: 'Edit', file: '/src/math.ts', before: 'a / b', after: 'b === 0 ? 0 : a / b' }
  const lesson = lessonPrompt([change], 'Añadí una guarda contra la división entre cero.')
  expect(lesson).toContain('/src/math.ts')
  expect(lesson).toContain('**Por qué**')
  expect(lesson).toContain('Añadí una guarda')

  const known = [{ id: '1', at: 0, files: ['/src/math.ts'], status: 'ready', text: LESSON }]
  const ask = chatPrompt(known, [], '¿Qué es una guarda?')
  expect(ask).toContain('math.ts')
  expect(ask).toContain('¿Qué es una guarda?')

  expect(clip('abcdef', 3)).toContain('recortado')
  expect(headline(LESSON)).toBe('Se añadió una guarda.')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`starts off, then explains a turn's edit in the background and answers /tutor on ${surface}`, async ($, on) => {
    const clock = mock.clock(on)
    const prompts: string[] = []
    on('model.complete', (_$, e) => {
      prompts.push(e.prompt)
      const text = prompts.length === 1 ? LESSON : 'Una guarda es una comprobación temprana.'
      return { value: { isAnswered: true, text, usage } } as never
    })
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    on('ui.close', () => ({ value: undefined }) as never)
    on('ui.toast', () => ({ value: undefined }) as never)
    on('tool.call', () => ({ result: { filePath: '/src/math.ts' } }) as never)
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
    // What draws beneath the band: another plugin's row, standing in for the engine.
    on('ui.render', { component: 'AbovePrompt' }, (_$, e) => {
      const { Text } = _$.ui.resolve(e)
      return <Text>debajo</Text>
    })

    const run = (args: string) =>
      $.command.run({
        command: 'tutor', args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 100 },
      } as never)
    const edit = (id: string) =>
      $.tool.call({
        tool: 'Edit', tool_use_id: id, file_path: '/src/math.ts', old_string: 'a / b', new_string: 'b === 0 ? 0 : a / b',
      } as never)
    const endTurn = (id: string) =>
      $.turn.complete({ answer: 'Añadí una guarda.', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' } as never)

    // Off at the start: an edit teaches nothing and calls no model.
    await edit('u0')
    await endTurn('t0')
    await clock.settle()
    expect(prompts.length).toBe(0)

    // Switched on by hand.
    expect((await run('')).text).toBe(undefined)
    await $.tool.call({
      tool: 'Edit', tool_use_id: 'u1', file_path: '/src/math.ts', old_string: 'a / b', new_string: 'b === 0 ? 0 : a / b',
    } as never)
    await $.turn.complete({
      answer: 'Añadí una guarda.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer',
    } as never)
    await clock.settle()
    expect(prompts[0]).toContain('/src/math.ts')

    expect((await run('¿Qué es una guarda?')).text).toBe(undefined)
    await clock.settle()
    expect(prompts[1]).toContain('¿Qué es una guarda?')
    expect(prompts[1]).toContain('Evita dividir entre cero')

    const pane = await $.ui.mount({
      plugin: 'code-tutor', surface, component: 'Pane', requestId: 'code-tutor',
      props: { title: '🎓 Tutor Educativo', isFocused: false, bodyColumns: 80, placement: 'dock' } as never,
    } as never)
    const markdown = (await pane.find({ type: 'Markdown' })) as { text?: string } | undefined
    expect(markdown?.text).toContain('Evita dividir entre cero')

    const band = await $.ui.mount({
      plugin: 'code-tutor', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false } as never,
    })
    expect(await band.find({ type: 'Text', text: 'Se añadió una guarda.' })).toBeTruthy()
    expect(await band.find({ type: 'Text', text: 'debajo' })).toBeTruthy()

    // Switched off: the band gives way to what draws beneath.
    await run('apagar')
    const after = await $.ui.mount({
      plugin: 'code-tutor', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false } as never,
    })
    expect(await after.find({ type: 'Text', text: 'Se añadió una guarda.' })).toBeFalsy()
    expect(await after.find({ type: 'Text', text: '🎓 Tutor apagado ' })).toBeTruthy()
    expect(await after.find({ type: 'Text', text: 'debajo' })).toBeTruthy()
  })
}

test('picks up a lesson a reload left thinking', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    // The first call is lost, as a reload drops it; the second answers.
    if (prompts.length === 1) return new Promise(() => {}) as never
    return { value: { isAnswered: true, text: LESSON, usage } } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: { filePath: '/src/math.ts' } }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)

  await $.command.run({
    command: 'tutor', args: '', origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 100 },
  } as never)
  await $.tool.call({
    tool: 'Edit', tool_use_id: 'u1', file_path: '/src/math.ts', old_string: 'a / b', new_string: 'b === 0 ? 0 : a / b',
  } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  expect(prompts.length).toBe(1)

  // The reload: session.start runs again and asks the model once more.
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await clock.settle()
  expect(prompts.length).toBe(2)
  expect(prompts[1]).toContain('/src/math.ts')
})

test('explains an edit a few seconds after it, without waiting for the turn to end', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: LESSON, usage } } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', () => ({ result: { filePath: '/src/math.ts' } }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)

  await $.command.run({
    command: 'tutor', args: '', origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 100 },
  } as never)
  const edit = (id: string) =>
    $.tool.call({
      tool: 'Edit', tool_use_id: id, file_path: '/src/math.ts', old_string: 'a / b', new_string: 'b === 0 ? 0 : a / b',
    } as never)

  // Two edits close together: one lesson, once they pause.
  await edit('u1')
  await clock.advance(1000)
  await edit('u2')
  await clock.advance(3000)
  expect(prompts.length).toBe(0)
  await clock.advance(1500)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Cambio 2')

  // The turn's end finds nothing left to explain.
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  expect(prompts.length).toBe(1)
})
