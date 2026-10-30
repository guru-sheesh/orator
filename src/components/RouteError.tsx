import { Link, useRouteError } from 'react-router'
import { buttonClass, Card, PageHeader } from './ui'

/** Shown instead of the router's developer error page if a screen fails. Data on the device is untouched. */
export function RouteError() {
  const error = useRouteError()
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-3 bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))]">
      <PageHeader title="Something went wrong" />
      <Card>
        <p className="text-muted">This screen couldn’t load. Your data on this device is safe.</p>
        <p className="text-caption break-words text-subtle">{error instanceof Error ? error.message : 'Unknown error'}</p>
        <Link to="/" reloadDocument className={buttonClass.secondary}>
          Back to Today
        </Link>
      </Card>
    </div>
  )
}
