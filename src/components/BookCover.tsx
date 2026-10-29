import { Book as BookIcon } from 'lucide-react'
import type { Book } from '../data/db'
import { cx } from './ui'

export function BookCover({ book, size = 'md' }: { book: Pick<Book, 'coverDataUrl'>; size?: 'sm' | 'md' }) {
  const dims = size === 'md' ? { w: 64, h: 92 } : { w: 40, h: 58 }
  return book.coverDataUrl ? (
    <img src={book.coverDataUrl} alt="" width={dims.w} height={dims.h} className="flex-none rounded-[6px] bg-raised object-cover" style={{ width: dims.w, height: dims.h }} />
  ) : (
    <div aria-hidden="true" className={cx('grid flex-none place-items-center rounded-[6px] bg-raised text-subtle')} style={{ width: dims.w, height: dims.h }}>
      <BookIcon size={size === 'md' ? 22 : 16} strokeWidth={1.75} />
    </div>
  )
}
