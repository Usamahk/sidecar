function readSender(el: HTMLElement | null | undefined): string {
  if (!el) return ''
  const name = el.getAttribute('name')?.trim()
  if (name) return name
  const text = el.textContent?.trim()
  if (text && !text.includes('@')) return text  // prefer display name over raw address
  return text || ''
}

// Gmail keeps previously-opened conversations mounted in the DOM (hidden), so a
// sender query can match cached, offscreen messages. Only the visible one is the
// message actually on screen.
function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function extractGmailSender(): string {
  // Scope to the conversation reading pane. Without this, broad [email] queries
  // match the chat/contacts sidebar, hovercards, the account chip, and inbox
  // list rows — all of which carry [email][name] and appear before the open
  // message in DOM order, so querySelector would return a constant wrong sender.
  const scope: ParentNode = document.querySelector<HTMLElement>('[role="main"]') ?? document

  // Open-message headers use span.gD (inbox rows and the sidebar do not). A
  // thread can hold several; the last visible one is the message in view.
  const gdVisible = Array.from(scope.querySelectorAll<HTMLElement>('span.gD[email]')).filter(isVisible)
  const fromGd = readSender(gdVisible[gdVisible.length - 1])
  if (fromGd) return fromGd

  // Fallback: any visible sender-like element within the reading pane.
  const attrCandidates = Array.from(scope.querySelectorAll<HTMLElement>('[email]')).filter(isVisible)
  return readSender(attrCandidates[attrCandidates.length - 1])
}

function sendPageInfo() {
  try {
    const isGmail = window.location.hostname === 'mail.google.com'
    chrome.runtime.sendMessage({
      type: 'PAGE_INFO',
      url: window.location.href,
      title: document.title,
      senderName: isGmail ? extractGmailSender() : '',
    }).catch(() => {})
  } catch {
    // Extension was reloaded — context invalidated, stop silently
  }
}

sendPageInfo()

// Gmail is a SPA — re-send when the URL changes (email opened)
// Retry a few times because Gmail renders the sender element asynchronously
let lastUrl = window.location.href
new MutationObserver(() => {
  if (window.location.href === lastUrl) return
  lastUrl = window.location.href

  // Stagger retries: 400ms, 900ms, 1600ms after navigation
  // Stops retrying as soon as a sender is found
  let attempts = 0
  const delays = [400, 500, 700]

  function attempt() {
    sendPageInfo()
    attempts++
    if (attempts < delays.length) {
      setTimeout(attempt, delays[attempts])
    }
  }
  setTimeout(attempt, delays[0])
}).observe(document.body, { childList: true, subtree: true })
