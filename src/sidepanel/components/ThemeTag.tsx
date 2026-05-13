import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { removeTheme } from '@/db/themes'

interface Props { themeId: number; itemId: number }

export function ThemeTag({ themeId, itemId }: Props) {
  const theme = useLiveQuery(() => db.themes.get(themeId), [themeId])
  if (!theme) return null

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: theme.color + '22',
        border: `1px solid ${theme.color}55`,
        color: theme.color,
      }}
    >
      {theme.name}
      <button
        onClick={() => removeTheme(itemId, themeId)}
        className="opacity-60 hover:opacity-100 transition-opacity leading-none ml-0.5"
        aria-label="Remove theme"
      >
        ×
      </button>
    </span>
  )
}
