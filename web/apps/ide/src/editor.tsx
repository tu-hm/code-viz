import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { loadLanguage, syntaxColors } from '@viz/player'
import { useEffect, useEffectEvent, useRef } from 'react'

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--code-font-size)',
    color: 'var(--content-primary)',
    backgroundColor: 'var(--bg-surface)',
  },
  '&.cm-focused': { outline: 'none' },
  '&:has(.cm-content:focus-visible)': {
    outline: '2px solid var(--border-focus)',
    outlineOffset: '-2px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
    lineHeight: 'var(--code-line-height)',
  },
  '.cm-content': { caretColor: 'var(--content-primary)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--content-secondary)',
    border: 'none',
    paddingLeft: 'var(--pane-padding)',
  },
})

export type Cursor = { line: number; column: number }

type EditorProps = {
  code: string
  editorMode: string
  cursor: Cursor | null
  onChange: (code: string) => void
}

// Editor is uncontrolled: it reads code only when it creates its view, and moves the caret to each new cursor.
export function Editor({ code, editorMode, cursor, onChange }: EditorProps) {
  const parent = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const changed = useEffectEvent(onChange)
  const latestCode = useEffectEvent(() => code)

  useEffect(() => {
    const language = new Compartment()
    const editor = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: latestCode(),
        extensions: [
          lineNumbers(),
          history(),
          indentOnInput(),
          // Esc, then Tab within 2 s, leaves the editor (CodeMirror's tab focus mode)
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': 'Code editor' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changed(u.state.doc.toString())
          }),
          language.of([]),
          syntaxColors,
          theme,
        ],
      }),
    })
    view.current = editor
    let alive = true
    loadLanguage(editorMode).then(
      (extension) => {
        if (alive) editor.dispatch({ effects: language.reconfigure(extension) })
      },
      (e: unknown) => reportError(e),
    )
    return () => {
      alive = false
      view.current = null
      editor.destroy()
    }
  }, [editorMode])

  useEffect(() => {
    const editor = view.current
    if (cursor === null || editor === null) return
    const { doc } = editor.state
    const line = doc.line(Math.min(cursor.line, doc.lines))
    const at = Math.min(line.from + cursor.column - 1, line.to)
    editor.dispatch({ selection: { anchor: at }, scrollIntoView: true })
    editor.focus()
  }, [cursor])

  return <div ref={parent} className="h-full min-h-0 overflow-hidden bg-muted" />
}
