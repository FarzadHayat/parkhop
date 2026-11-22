import { useEffect, useId, useRef, useState } from 'react'
import { Conversation } from '../assistant/agent'
import { useApp } from '../state/store'

// Web Speech API: Chrome and Safari ship it prefixed or unprefixed; Firefox does not.
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
const SpeechRec =
  (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition

const EXAMPLES = [
  'Drop the kids at Mango Hill State School by 8:20, then work at RBWH by 9, home after 5',
  'Cheapest way to get to Queen Street by 8:30 tomorrow',
]

function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-AU'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch {
    /* no speech synthesis */
  }
}

export function AssistantBar() {
  const ready = useApp((s) => s.assistantReady)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState('')
  const [reply, setReply] = useState<{ q: string; a: string; error?: boolean } | null>(null)
  const [listening, setListening] = useState(false)
  const convo = useRef(new Conversation())
  const rec = useRef<Recognition | null>(null)
  const inputId = useId()
  const viaVoice = useRef(false)

  useEffect(() => () => rec.current?.stop(), [])

  if (!ready) return null

  const ask = async (q: string) => {
    const query = q.trim()
    if (!query || busy) return
    setBusy(true)
    setText('')
    setReply({ q: query, a: '' })
    try {
      const a = await convo.current.ask(query, { onActivity: setActivity })
      setReply({ q: query, a })
      if (viaVoice.current) speak(a)
    } catch (e) {
      setReply({ q: query, a: e instanceof Error ? e.message : 'Something went wrong', error: true })
    } finally {
      setBusy(false)
      setActivity('')
      viaVoice.current = false
    }
  }

  const toggleMic = () => {
    if (!SpeechRec) return
    if (listening) {
      rec.current?.stop()
      return
    }
    const r = new SpeechRec()
    r.lang = 'en-AU'
    r.interimResults = true
    r.continuous = false
    let finalText = ''
    r.onresult = (e) => {
      const parts = Array.from(e.results)
      finalText = parts.map((p) => p[0].transcript).join(' ')
      setText(finalText)
    }
    r.onend = () => {
      setListening(false)
      if (finalText.trim()) {
        viaVoice.current = true
        void ask(finalText)
      }
    }
    r.onerror = () => setListening(false)
    rec.current = r
    setListening(true)
    r.start()
  }

  return (
    <section className="assistant" aria-label="Ask ParkHop">
      <form
        className="ask-row"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(text)
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          Describe your day
        </label>
        <input
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tell me your day…"
          enterKeyHint="send"
          autoComplete="off"
          disabled={busy}
        />
        {SpeechRec && (
          <button
            type="button"
            className={`icon-btn mic ${listening ? 'is-on' : ''}`}
            aria-pressed={listening}
            aria-label={listening ? 'Stop listening' : 'Speak your day'}
            onClick={toggleMic}
            disabled={busy}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <button type="submit" className="btn small primary-lite" disabled={busy || !text.trim()}>
          Ask
        </button>
      </form>
      {!reply && (
        <div className="examples" role="list" aria-label="Try asking">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" role="listitem" className="chip example" onClick={() => void ask(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
      <div className="reply" aria-live="polite">
        {reply && (
          <>
            <p className="reply-q">“{reply.q}”</p>
            {busy ? (
              <p className="reply-a muted">
                <span className="dots" aria-hidden="true" /> {activity || 'Thinking'}…
              </p>
            ) : (
              <p className={`reply-a ${reply.error ? 'bad' : ''}`}>{reply.a}</p>
            )}
            {!busy && (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  convo.current.reset()
                  setReply(null)
                }}
              >
                New question
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}
