import { useEffect, useRef, type ReactNode } from 'react'
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
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-sm overscroll-contain rounded-lg bg-surface p-5 text-text backdrop:bg-black/60 light:border light:border-border"
    >
      <h2 id="confirm-title" className="text-title font-semibold">
        {title}
      </h2>
      <div className="mt-2 flex flex-col gap-2 text-muted">{children}</div>
      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={destructive ? buttonClass.danger : buttonClass.primary}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={buttonClass.secondary}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
