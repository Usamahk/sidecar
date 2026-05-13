function extractGmailSender(): string {
  // Prefer any element that has BOTH an email attribute and a name/text — very specific to Gmail sender spans
  const byAttr = document.querySelector<HTMLElement>('[email][name]')
  if (byAttr) {
    const name = byAttr.getAttribute('name')?.trim()
    if (name) return name
  }

  // Fallback: elements with just an email attribute (grab text content as display name)
  const byEmail = document.querySelector<HTMLElement>('[email]')
  if (byEmail) {
    const text = byEmail.textContent?.trim()
    if (text && !text.includes('@')) return text  // prefer display name over raw address
    const name = byEmail.getAttribute('name')?.trim()
    if (name) return name
    if (text) return text
  }

  // Fallback: classic Gmail classes
  for (const sel of ['.gD', '.go']) {
    const el = document.querySelector<HTMLElement>(sel)
    const val = el?.getAttribute('name')?.trim() || el?.textContent?.trim()
    if (val) return val
  }

  return ''
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
