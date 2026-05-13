import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAttachments, deleteAttachment } from '@/db/attachments'
import type { Attachment } from '@/types'

function AttachmentThumb({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string>('')
  const [lightbox, setLightbox] = useState(false)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(attachment.blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [attachment.blob])

  if (!url) return null

  return (
    <>
      <div className="relative group">
        <img src={url} alt={attachment.name} onClick={() => setLightbox(true)}
          className="rounded-lg border border-line max-h-48 w-full object-cover
            cursor-zoom-in hover:border-line-strong transition-colors" />
        <button
          onClick={() => deleteAttachment(attachment.id!)}
          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-surface/80 text-ink-3
            hover:text-red-500 transition-colors text-xs items-center justify-center hidden group-hover:flex"
          aria-label="Remove screenshot"
        >
          ✕
        </button>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}>
          <img src={url} alt={attachment.name}
            className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none">
            ✕
          </button>
        </div>
      )}
    </>
  )
}

interface Props { itemId: number }

export function AttachmentList({ itemId }: Props) {
  const attachments = useLiveQuery(() => getAttachments(itemId), [itemId])
  if (!attachments?.length) return null

  return (
    <div className="px-4 pb-3 space-y-2">
      {attachments.map((a) => <AttachmentThumb key={a.id} attachment={a} />)}
    </div>
  )
}
