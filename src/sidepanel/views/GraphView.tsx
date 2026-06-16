import { InsightsPanel } from '../components/InsightsPanel'
import { InsightReviewQueue } from '../components/InsightReviewQueue'
import { GraphExplorer } from '../components/GraphExplorer'
import { Icons } from '../components/Icons'
import type { View } from '@/types'

interface Props {
  onChangeView: (v: View) => void
}

export function GraphView({ onChangeView }: Props) {
  void onChangeView
  function handlePopOut() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/graph/index.html') })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-line bg-surface-1">
        <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-ink-3">Graph</p>
        <button
          onClick={handlePopOut}
          className="text-[11px] px-2 py-0.5 rounded border border-line hover:border-line-strong text-ink-2 flex items-center gap-1 transition-colors"
          title="Open the graph in a full tab"
        >
          <Icons.link size={11} stroke={2} /> Pop out
        </button>
      </div>
      <InsightsPanel />
      <InsightReviewQueue />
      <div className="flex-1 min-h-0">
        <GraphExplorer variant="panel" />
      </div>
    </div>
  )
}
