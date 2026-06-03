import { Icons } from '../components/Icons'

export function GraphView() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-9 py-6 gap-1.5">
      <div className="mb-2 text-ink-3">
        <Icons.graph size={56} stroke={1.4} />
      </div>
      <h2 className="font-serif text-[21px] text-ink whitespace-nowrap m-0">Knowledge graph</h2>
      <p className="text-xs text-ink-3 max-w-[240px] leading-relaxed m-0">
        Visualize connections between your research items, themes, and concepts.
      </p>
      <span
        className="mt-2.5 font-mono text-[10px] tracking-[0.1em] uppercase text-accent rounded-full px-3 py-1 whitespace-nowrap"
        style={{
          border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        }}
      >
        Coming Soon
      </span>
    </div>
  )
}
