chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error)

let currentTab: { url: string; title: string; favIconUrl?: string; senderName?: string } = {
  url: '',
  title: '',
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId)
  if (tab.url) {
    currentTab = { url: tab.url, title: tab.title ?? '', favIconUrl: tab.favIconUrl, senderName: '' }
    chrome.runtime.sendMessage({ type: 'TAB_UPDATED', ...currentTab }).catch(() => {})
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url) {
    currentTab = { url: tab.url, title: tab.title ?? '', favIconUrl: tab.favIconUrl, senderName: '' }
    chrome.runtime.sendMessage({ type: 'TAB_UPDATED', ...currentTab }).catch(() => {})
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PAGE_INFO') {
    // Content script reporting current page details (including Gmail sender)
    currentTab = {
      url: message.url,
      title: message.title,
      favIconUrl: currentTab.favIconUrl,
      senderName: message.senderName || '',
    }
    chrome.runtime.sendMessage({ type: 'TAB_UPDATED', ...currentTab }).catch(() => {})
    return
  }

  if (message.type === 'GET_CURRENT_TAB') {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (tab?.url) {
          currentTab = { ...currentTab, url: tab.url, title: tab.title ?? '', favIconUrl: tab.favIconUrl }
        }
        sendResponse(currentTab)
      })
      .catch(() => sendResponse(currentTab))
    return true
  }
})
