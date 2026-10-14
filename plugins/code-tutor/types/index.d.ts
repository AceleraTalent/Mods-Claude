/** One file change Claude made, as the tutor reads it. */
export type TutorChange = {
  tool: 'Edit' | 'Write' | 'NotebookEdit'
  file: string
  /** What was there before (Edit), or empty. */
  before: string
  /** What is there now: the new text, the whole file, or the cell. */
  after: string
}

/** A lesson: the tutor's explanation of one turn's changes. */
export type TutorLesson = {
  id: string
  at: number
  files: string[]
  status: 'thinking' | 'ready' | 'error'
  text: string
  /** What the lesson is written from, kept only while it is `thinking`. */
  changes?: TutorChange[]
  answer?: string
}

/** One line of the private conversation with the tutor. */
export type TutorMessage = {
  id: string
  at: number
  role: 'user' | 'tutor'
  status: 'thinking' | 'ready' | 'error'
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'code-tutor': {
      /** Whether the person switched the tutor on in this session (off at start). */
      active: boolean
      /** Changes made during the running turn, waiting for its end. */
      pending: TutorChange[]
      lessons: TutorLesson[]
      chat: TutorMessage[]
    }
  }
}
