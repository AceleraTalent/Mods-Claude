import { expect, mock, test } from 'claude-code/testing'

const scroll = { offset: 0, bodyRows: 40 }

test('la banda y el panel se dibujan en el terminal', async ($, on) => {
  mock.clock(on)

  const band = await $.ui.mount({
    plugin: 'productivity-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 140, scroll, view: {} },
  })
  expect(await band.find({ type: 'Text', text: /CTX/ })).toBeDefined()
  await band.unmount()

  const pane = await $.ui.mount({
    plugin: 'productivity-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'productivity-hud',
    props: { title: 'Productivity HUD', isFocused: false, bodyColumns: 50, placement: 'dock', scroll, view: {} },
  })
  expect(await pane.find({ type: 'Text', text: /Presupuesto/ })).toBeDefined()
  await pane.unmount()
})
