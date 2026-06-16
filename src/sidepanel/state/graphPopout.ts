import { useEffect, useState } from 'react'

const CHANNEL_NAME = 'sidecar-graph-popout'
const HEARTBEAT_MS = 1500
// If we don't hear from the popout for this long, assume it's gone.
const STALE_AFTER_MS = 4000

type Message =
  | { kind: 'alive' }
  | { kind: 'closing' }
  | { kind: 'ping' }

/**
 * Heartbeat for the pop-out tab. Call from GraphFullPage so the side-panel
 * listener knows the pop-out is open and can swap the canvas for a placeholder.
 */
export function usePopoutHeartbeat() {
  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME)
    function ping() { ch.postMessage({ kind: 'alive' } satisfies Message) }
    ping()
    const id = setInterval(ping, HEARTBEAT_MS)
    // If a panel comes online after the pop-out, it sends a 'ping'; respond.
    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data?.kind === 'ping') ping()
    }
    function onUnload() { ch.postMessage({ kind: 'closing' } satisfies Message) }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      clearInterval(id)
      window.removeEventListener('beforeunload', onUnload)
      ch.postMessage({ kind: 'closing' } satisfies Message)
      ch.close()
    }
  }, [])
}

/**
 * Side-panel hook that returns whether the pop-out graph tab is currently open.
 * Detection is best-effort — uses BroadcastChannel heartbeats from the pop-out.
 */
export function usePopoutPresence(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME)
    let staleTimer: ReturnType<typeof setTimeout> | null = null

    function markAlive() {
      setOpen(true)
      if (staleTimer) clearTimeout(staleTimer)
      staleTimer = setTimeout(() => setOpen(false), STALE_AFTER_MS)
    }

    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data?.kind === 'alive') markAlive()
      else if (e.data?.kind === 'closing') {
        setOpen(false)
        if (staleTimer) { clearTimeout(staleTimer); staleTimer = null }
      }
    }

    // Ask any popout that may already be open to announce itself.
    ch.postMessage({ kind: 'ping' } satisfies Message)

    return () => {
      if (staleTimer) clearTimeout(staleTimer)
      ch.close()
    }
  }, [])

  return open
}
