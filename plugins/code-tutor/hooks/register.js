// code-tutor: a tutor that explains, in its own panel, why Claude changed the
// code during the session, and answers questions on a channel of its own.
//
// The tutor starts off in every session and is switched on by hand: `/tutor`
// (or a question to it) switches it on, `/tutor apagar` off. While off it
// notes nothing, calls no model and its band is one dim line to switch it on.
//
// - tool.call (Edit, Write, NotebookEdit): notes each change that went through
//   and, once the edits pause for a few seconds, hands them to a second model
//   call, in the background, with the tutor's personality as its system prompt.
// - turn.complete: explains whatever the pause has not, with Claude's answer.
// - ui.render Pane: the tutor's panel (avatar, latest lesson, conversation, a
//   field to ask). ui.render AbovePrompt: a one-line band that opens it.
// - /tutor <pregunta>: asks the tutor without touching the main conversation.
//
// The module is plain JavaScript, so the trees are built with `h` (the factory
// JSX compiles to) instead of tags.

import { atom, read, update } from 'claude-code'

const PANE = 'code-tutor'
const TITLE = '🎓 Tutor Educativo'
/** The model the tutor speaks with: an alias (`haiku`, `sonnet`) or a full id. */
const MODEL = 'haiku'
const MAX_LESSONS = 30
/** Quiet time after an edit before the tutor explains it: a burst of edits is one lesson. */
const QUIET_MS = 4000
const MAX_CHAT = 40

const active = atom({ plugin: 'code-tutor', key: 'active' }, false)
const pending = atom({ plugin: 'code-tutor', key: 'pending' }, [])
const lessons = atom({ plugin: 'code-tutor', key: 'lessons' }, [])
const chat = atom({ plugin: 'code-tutor', key: 'chat' }, [])

// ─── The tutor's voice ──────────────────────────────────────────────────────

export const TUTOR = `Eres Profe Byte, un tutor de programación que acompaña a una persona mientras Claude Code cambia su código.

Tu misión es que la persona entienda, no solo que el código funcione:
- Explicas primero el porqué (el problema, la intención, la alternativa descartada) y después el qué.
- Nombras el concepto o patrón que hay detrás para que la persona pueda buscarlo y reconocerlo la próxima vez.
- Usas una analogía corta cuando aclara algo abstracto, nunca como relleno.

Tu tono es cercano, entusiasta sin exagerar y empático: tuteas, celebras las buenas preguntas y nunca eres condescendiente. Si algo es difícil, lo dices y lo partes en pasos.

Reglas:
- Respondes siempre en español, en Markdown breve.
- No inventas: si el fragmento no basta para saber algo, lo dices.
- No propones cambios de código salvo que te lo pidan; tu trabajo es enseñar.`

// ─── Pure helpers (exported for the tests) ──────────────────────────────────

/** Cuts `text` to `max` characters, saying so. */
export const clip = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max)}\n…[recortado, ${text.length - max} caracteres más]`

/** The change a successful Edit, Write or NotebookEdit call made, or null. */
export const describeChange = e => {
  if (e.tool === 'Edit')
    return { tool: 'Edit', file: String(e.file_path), before: clip(String(e.old_string ?? ''), 3000), after: clip(String(e.new_string ?? ''), 3000) }
  if (e.tool === 'Write') return { tool: 'Write', file: String(e.file_path), before: '', after: clip(String(e.content ?? ''), 3000) }
  if (e.tool === 'NotebookEdit')
    return { tool: 'NotebookEdit', file: String(e.notebook_path), before: '', after: clip(String(e.new_source ?? ''), 3000) }
  return null
}

const baseName = path => path.split(/[\\/]/).pop() || path

const formatChange = (c, i) => {
  const head = `### Cambio ${i + 1}: ${c.tool} en ${c.file}`
  if (c.tool === 'Edit') return `${head}\nAntes:\n\`\`\`\n${clip(c.before, 1500)}\n\`\`\`\nDespués:\n\`\`\`\n${clip(c.after, 1500)}\n\`\`\``
  if (c.tool === 'Write') return `${head} (archivo escrito entero)\n\`\`\`\n${clip(c.after, 3000)}\n\`\`\``
  return `${head} (celda de notebook)\n\`\`\`\n${clip(c.after, 1500)}\n\`\`\``
}

/** What the tutor is asked at the end of a turn that changed code. */
export const lessonPrompt = (changes, answer) =>
  [
    'Claude Code acaba de hacer estos cambios en el código de la persona:',
    clip(changes.map(formatChange).join('\n\n'), 12000),
    answer.trim() ? `Lo que Claude le dijo a la persona al terminar:\n"""\n${clip(answer.trim(), 2000)}\n"""` : '',
    `Escribe una lección breve (máximo 170 palabras) en Markdown con exactamente estas partes, cada una con su título en negrita:
**Qué cambió**: una o dos frases.
**Por qué**: el razonamiento detrás del cambio; es la parte más importante.
**Concepto clave**: el principio o patrón que se aprende, con su nombre.
**Pregúntate**: una pregunta corta para comprobar que se entendió.`,
  ]
    .filter(Boolean)
    .join('\n\n')

/** What the tutor is asked when the person writes to it. */
export const chatPrompt = (known, history, question) => {
  const recent = known.filter(l => l.status === 'ready').slice(-3)
  const talk = history.filter(m => m.status === 'ready').slice(-10)
  return [
    recent.length
      ? `Lecciones que ya le diste sobre los cambios de esta sesión:\n\n${recent
          .map(l => `--- ${l.files.map(baseName).join(', ')} ---\n${l.text}`)
          .join('\n\n')}`
      : 'Todavía no ha habido cambios de código en esta sesión.',
    talk.length
      ? `Conversación hasta ahora:\n${talk.map(m => `${m.role === 'user' ? 'Persona' : 'Tú'}: ${clip(m.text, 1200)}`).join('\n')}`
      : '',
    `La persona te pregunta:\n"""\n${question}\n"""\n\nResponde como Profe Byte, en menos de 200 palabras salvo que la pregunta pida más.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** A lesson's first line of prose, for the band. */
export const headline = text =>
  text
    .split('\n')
    .map(line => line.replace(/\*\*[^*]+\*\*:?/g, '').replace(/[#>*_`]/g, '').trim())
    .find(line => line.length > 0) ?? ''

let counter = 0
const uid = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

// ─── Talking to the model ───────────────────────────────────────────────────

const complete = ($, prompt, maxTokens) =>
  $.model.complete({ model: MODEL, system: [{ text: TUTOR, cache: true }], prompt, maxTokens, timeoutMs: 90_000 })

const failure = r =>
  r.reason === 'api-error'
    ? `El tutor no pudo responder (error de la API${r.status ? ` ${r.status}` : ''}).`
    : r.reason === 'aborted'
      ? 'El tutor tardó demasiado y se canceló la respuesta.'
      : r.reason === 'lost'
        ? 'Esta lección se interrumpió antes de terminar.'
        : 'El tutor no devolvió texto.'

/** Puts the model's answer `r` into the item `id` of a list. */
const settled = (id, r) => list =>
  list.map(item => {
    if (item.id !== id) return item
    // The inputs are dropped, not set to undefined: a stored value is plain JSON.
    const { changes, answer, ...rest } = item
    return { ...rest, status: r.isAnswered ? 'ready' : 'error', text: r.isAnswered ? r.text.trim() : failure(r) }
  })

const teach = async ($, lesson) => {
  let r
  try {
    r = lesson.changes?.length
      ? await complete($, lessonPrompt(lesson.changes, lesson.answer ?? ''), 700)
      : { isAnswered: false, reason: 'lost' }
  } catch (err) {
    r = { isAnswered: false, reason: 'api-error' }
  }
  await update($, lessons, settled(lesson.id, r))
  if (r.isAnswered) $.ui.toast(`🎓 Nueva lección sobre ${lesson.files.map(baseName).join(', ')}. Ábrela con /tutor`)
}

const ask = async ($, question) => {
  const reply = { id: uid(), at: Date.now(), role: 'tutor', status: 'thinking', text: '' }
  await update($, chat, list =>
    [...list, { id: uid(), at: Date.now(), role: 'user', status: 'ready', text: question }, reply].slice(-MAX_CHAT),
  )
  await answer($, reply.id)
}

/** Answers the tutor's reply `id`: the question is the message just before it. */
const answer = async ($, id) => {
  const talk = await read($, chat)
  const at = talk.findIndex(m => m.id === id)
  const question = talk[at - 1]
  let r
  try {
    r =
      at > 0 && question.role === 'user'
        ? await complete($, chatPrompt(await read($, lessons), talk.slice(0, at - 1), question.text), 900)
        : { isAnswered: false, reason: 'lost' }
  } catch (err) {
    r = { isAnswered: false, reason: 'api-error' }
  }
  await update($, chat, settled(id, r))
}

/** Starts `work` once the current dispatch has resolved, so nothing waits on the model. */
const later = ($, work) => $.clock.after(0, () => void work())

/** Turns the pending changes into a lesson and starts writing it. */
const flush = async ($, answer) => {
  // Taken and emptied in one write, so the pause and the turn's end never
  // explain the same changes twice.
  let changes = []
  await update($, pending, list => {
    changes = list
    return []
  })
  if (changes.length === 0) return
  const lesson = {
    id: uid(),
    at: Date.now(),
    files: [...new Set(changes.map(c => c.file))],
    status: 'thinking',
    text: '',
    // Kept until the lesson is written, so a reload can pick it up again.
    changes,
    answer: clip(answer, 2000),
  }
  await update($, lessons, list => [...list, lesson].slice(-MAX_LESSONS))
  await teach($, lesson)
}

// The timer that explains the latest edits once the edits pause. A reload
// drops it; the pending changes stay in the state for the turn's end.
let quiet = null

const openPane = $ => $.ui.open({ id: PANE, title: TITLE })

const switchOn = async $ => {
  if (await read($, active)) return
  await update($, active, () => true)
  $.ui.toast('🎓 Tutor activado: explicaré cada cambio de código de esta sesión')
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export const register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tutor',
      description: 'Activa el tutor educativo y abre su panel; con texto, pregúntale sin tocar la conversación principal',
      argumentHint: '<pregunta> | apagar | limpiar',
      immediate: true,
    })
    // A reload drops the model calls in flight while the state keeps them
    // `thinking`: pick each one up again.
    for (const lesson of await read($, lessons))
      if (lesson.status === 'thinking') later($, () => teach($, lesson))
    for (const m of await read($, chat))
      if (m.role === 'tutor' && m.status === 'thinking') later($, () => answer($, m.id))
    return next(e)
  })

  // Each change that went through joins the turn's pending list.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || !(await read($, active))) return ran
    const change = describeChange(e)
    if (change) {
      await update($, pending, list => [...list, change].slice(-50))
      quiet?.cancel()
      quiet = $.clock.after(QUIET_MS, () => {
        quiet = null
        void flush($, '')
      })
    }
    return ran
  }).catch(($, e, next) => next(e)) // the tutor never stands in the way of an edit

  // At the main turn's end, the tutor explains what changed, in the background.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId || !(await read($, active))) return next(e)
    quiet?.cancel()
    quiet = null
    const answer = e.answer ?? ''
    later($, () => flush($, answer))
    return next(e)
  })

  // /tutor: switches the tutor on and opens the panel; with text, asks;
  // `apagar` switches it off, `limpiar` clears the conversation. It answers
  // with no text, so nothing reaches the main conversation's model.
  on('command.run', { command: 'tutor' }, async ($, e) => {
    const question = e.args.trim()
    if (question === 'apagar') {
      await update($, active, () => false)
      await update($, pending, () => [])
      await $.ui.close({ id: PANE })
      $.ui.toast('🎓 Tutor apagado. Vuelve a llamarlo con /tutor')
      return {}
    }
    await switchOn($)
    await openPane($)
    if (question === 'limpiar') await update($, chat, () => [])
    else if (question !== '') later($, () => ask($, question))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Input } = $.ui.resolve(e)
    const all = await read($, lessons)
    const talk = await read($, chat)
    const width = Math.max(20, e.props.bodyColumns ?? 60)
    const lesson = all[all.length - 1]

    const section = text => h(Box, { marginTop: 1 }, h(Text, { bold: true, color: 'claude' }, text))

    const avatar = h(
      Box,
      { flexDirection: 'row' },
      h(
        Box,
        { flexDirection: 'column', flexShrink: 0, marginRight: 2 },
        h(Text, { color: 'claude' }, '╭───────╮'),
        h(Text, { color: 'claude' }, '│ ◕   ◕ │'),
        h(Text, { color: 'claude' }, '│   ▽   │'),
        h(Text, { color: 'claude' }, '╰──┬─┬──╯'),
      ),
      h(
        Box,
        { flexDirection: 'column' },
        h(Text, { bold: true }, '[ 🎓 Tutor Educativo ]'),
        h(Text, null, 'Profe Byte'),
        h(Text, { dimColor: true }, 'Te explico el porqué de cada cambio.'),
      ),
    )

    const lessonBody = !lesson
      ? h(Text, { dimColor: true }, 'Aún no hay cambios en la sesión. Cuando Claude edite código, te lo explico aquí.')
      : h(
          Box,
          { flexDirection: 'column' },
          h(Text, { dimColor: true }, lesson.files.map(baseName).join(', ')),
          lesson.status === 'thinking'
            ? h(Text, { color: 'warning' }, '✎ Preparando la lección…')
            : h(Markdown, { text: lesson.text, dimColor: lesson.status === 'error' }),
          all.length > 1 ? h(Text, { dimColor: true }, `(${all.length - 1} lecciones anteriores en esta sesión)`) : null,
        )

    const talkBody =
      talk.length === 0
        ? h(Text, { dimColor: true }, 'Pregúntame lo que quieras: aquí abajo o con /tutor <pregunta>.')
        : h(
            Box,
            { flexDirection: 'column' },
            ...talk.slice(-6).map(m =>
              m.role === 'user'
                ? h(Box, { marginTop: 1 }, h(Text, { color: 'suggestion' }, `Tú › ${m.text}`))
                : m.status === 'thinking'
                  ? h(Text, { color: 'warning' }, '🎓 pensando…')
                  : h(
                      Box,
                      { flexDirection: 'column' },
                      h(Text, { color: 'claude' }, '🎓 Profe Byte'),
                      h(Markdown, { text: m.text, dimColor: m.status === 'error' }),
                    ),
            ),
          )

    return h(
      Box,
      { flexDirection: 'column', paddingX: 1, width },
      avatar,
      section('Última lección'),
      lessonBody,
      section('Conversación'),
      talkBody,
      h(
        Box,
        { marginTop: 1 },
        h(Input, {
          key: 'ask',
          placeholder: 'Pregúntale al tutor…',
          submitLabel: 'preguntar',
          onSubmit: value => {
            const question = value.trim()
            if (question) later($, () => ask($, question))
          },
        }),
      ),
    )
  })

  // A one-line band above the prompt; it sits on top of whatever draws beneath.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    const stack = band => (below ? h(Box, { flexDirection: 'column' }, band, below) : band)

    // Off: one dim line, so the person knows the tutor is there and how to call it.
    if (!(await read($, active)))
      return stack(
        h(
          Box,
          { flexDirection: 'row' },
          h(Box, { flexShrink: 0 }, h(Text, { dimColor: true }, '🎓 Tutor apagado ')),
          h(
            Box,
            { flexShrink: 0 },
            h(Button, {
              key: 'on',
              label: 'activar',
              onPress: async () => {
                await switchOn($)
                await openPane($)
              },
            }),
          ),
        ),
      )

    const all = await read($, lessons)
    const talk = await read($, chat)
    const lesson = all[all.length - 1]
    const thinking = lesson?.status === 'thinking' || talk[talk.length - 1]?.status === 'thinking'

    const status = thinking
      ? 'pensando…'
      : lesson?.status === 'ready'
        ? headline(lesson.text)
        : 'listo. Pregúntame con /tutor <pregunta>'

    const band = h(
      Box,
      { flexDirection: 'row' },
      h(Box, { flexShrink: 0 }, h(Text, { color: 'claude', bold: true }, '🎓 Tutor ')),
      h(Box, { flexGrow: 1 }, h(Text, { dimColor: !thinking, color: thinking ? 'warning' : undefined, wrap: 'truncate-end' }, status)),
      h(Box, { flexShrink: 0 }, h(Button, { key: 'open', label: 'abrir', onPress: () => void openPane($) })),
      h(
        Box,
        { flexShrink: 0 },
        h(Button, {
          key: 'off',
          label: 'apagar',
          onPress: async () => {
            await update($, active, () => false)
            await update($, pending, () => [])
            await $.ui.close({ id: PANE })
          },
        }),
      ),
    )

    return stack(band)
  })
}
