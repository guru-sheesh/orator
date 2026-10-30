import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { buttonClass } from './ui'

/**
 * Modal confirmation built on native <dialog>, which gives focus trapping,
 * Esc-to-close and an inert background for free.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const [pending, setPending] = useState(false)
  const working = busy || pending

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // For destructive actions start on Cancel, so a stray Enter can't delete anything.
      if (destructive) cancelRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open, destructive])

  async function confirm() {
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        if (!working) onCancel()
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-sm overscroll-contain rounded-lg bg-surface p-5 text-text backdrop:bg-black/60 light:border light:border-border"
    >
      <h2 id={titleId} className="text-title font-semibold">
        {title}
      </h2>
      <div className="mt-2 flex flex-col gap-2 text-muted">{children}</div>
      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={working}
          className={destructive ? buttonClass.danger : buttonClass.primary}
        >
          {working ? 'Working…' : confirmLabel}
        </button>
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={working} className={buttonClass.secondary}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
