import { useState, useEffect } from 'react'
import type { TabInfo } from '@/types'

export function useCurrentTab(): TabInfo {
  const [tab, setTab] = useState<TabInfo>({ url: '', title: '' })

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }, (response: TabInfo) => {
      if (response?.url) setTab(response)
    })

    const listener = (message: TabInfo & { type?: string }) => {
      if (message.type === 'TAB_UPDATED') {
        setTab({ url: message.url, title: message.title, favIconUrl: message.favIconUrl, senderName: message.senderName })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  return tab
}
