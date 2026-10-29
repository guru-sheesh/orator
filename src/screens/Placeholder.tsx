import { Link } from 'react-router'
import { buttonClass, Card, PageHeader } from '../components/ui'

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <p className="text-muted">This page doesn't exist. Your data is unaffected.</p>
        <Link to="/" className={buttonClass.secondary}>
          Back to Today
        </Link>
      </Card>
    </>
  )
}

/** Stand-in for screens built in later phases (CLAUDE.md §21). */
export default function Placeholder({ title, phase, description }: { title: string; phase: string; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p className="text-title font-semibold">Arrives in {phase}</p>
        <p className="text-muted">{description}</p>
      </Card>
    </>
  )
}
