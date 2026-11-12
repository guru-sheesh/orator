import { Link, Outlet, useLocation } from 'react-router'
import { BookOpen, Mic, NotebookPen, Sun, type LucideIcon } from 'lucide-react'
import { cx } from './ui'

const TABS: { to: string; label: string; icon: LucideIcon; also?: string[] }[] = [
  // Progress and Settings are reached from Today, so Today stays highlighted there.
  { to: '/', label: 'Today', icon: Sun, also: ['/progress', '/settings'] },
  { to: '/speak', label: 'Speak', icon: Mic },
  { to: '/journal', label: 'Journal', icon: NotebookPen },
  { to: '/read', label: 'Read', icon: BookOpen },
]

export function AppShell() {
  const { pathname } = useLocation()

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-bg">
      <main className="flex flex-1 flex-col gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-6">
        <Outlet />
      </main>
      <nav
        aria-label="Main"
        className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-border/70 bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        {TABS.map(({ to, label, icon: Icon, also }) => {
          const active = to === '/' ? pathname === '/' || !!also?.includes(pathname) : pathname.startsWith(to)
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium',
                active ? 'text-text before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-b-sm before:bg-primary' : 'text-subtle hover:text-muted',
              )}
            >
              <Icon size={24} strokeWidth={active ? 2 : 1.75} className={active ? 'text-primary' : undefined} aria-hidden="true" />
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
