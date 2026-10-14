# code-tutor

Mod de Claude Code con un tutor de programación, **Profe Byte**, que te explica el *porqué* de cada cambio que Claude hace en tu código, en un panel propio y sin tocar la conversación principal.

```
╭───────╮  [ 🎓 Tutor Educativo ]
│ ◕   ◕ │  Profe Byte
│   ▽   │  Te explico el porqué de cada cambio.
╰──┬─┬──╯
```

## Se activa a mano

El tutor arranca **apagado** en cada sesión: no lee cambios, no llama al modelo y no dibuja nada hasta que lo llamas.

| Comando | Qué hace |
| --- | --- |
| `/tutor` | Activa el tutor y abre su panel. |
| `/tutor <pregunta>` | Lo activa si hacía falta y le pregunta. La respuesta sale en el panel. |
| `/tutor limpiar` | Borra la conversación con el tutor. |
| `/tutor apagar` | Lo apaga: deja de explicar cambios y quita la banda. |

## Qué hace mientras está activo

- **Lecciones**: unos segundos después de que Claude edita archivos (Edit, Write o NotebookEdit), sin esperar a que termine su turno, el tutor prepara en segundo plano una lección breve. Si Claude hace varias ediciones seguidas, las explica juntas en cuanto se detiene; lo que quede al final del turno se explica entonces, con lo que Claude te respondió. Cada lección tiene cuatro partes: *Qué cambió*, *Por qué*, *Concepto clave* y *Pregúntate*. Te avisa con una notificación cuando está lista.
- **Panel**: el avatar, la última lección, vuestra conversación y un campo para preguntarle directamente.
- **Banda sobre el prompt**: `🎓 Tutor` con el titular de la última lección y los botones `[ abrir ]` y `[ apagar ]`.
- **Apagado**, la banda se queda en una línea tenue, `🎓 Tutor apagado [ activar ]`, para que sepas que está ahí.
- **Canal propio**: las respuestas del tutor solo aparecen en su panel. El comando no devuelve texto a la conversación principal.

No detecta los cambios hechos con comandos de shell (`sed`, `echo > archivo`).

## Coste

Usa `haiku`: una llamada por cada turno que cambia código mientras el tutor está activo, y una por cada pregunta. Para cambiar de modelo, edita `MODEL` al principio de `hooks/register.js`.

## Instalar

En una sesión de Claude Code en la terminal:

```
/plugin install code-tutor --marketplace AceleraTalent/code-tutor
```

Responde `y` para añadir el marketplace y elige el ámbito (usuario, el primero, con Enter).

Para usarlo desde una copia local en todas las sesiones, añade su ruta a `CLAUDE_CODE_PLUGIN_DIRS` en el bloque `env` de `~/.claude/settings.json` (varias rutas se separan con `:`).

## Desarrollo

```
claude plugin validate .
claude plugin test .
```

El módulo es JavaScript sin JSX: la interfaz se construye con `h(...)`. La memoria de la sesión (`active`, `pending`, `lessons`, `chat`) está declarada en `types/index.d.ts`.
