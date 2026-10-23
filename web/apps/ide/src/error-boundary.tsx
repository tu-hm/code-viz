import { Component, type ReactNode } from 'react'

type Props = { traceId?: string; children: ReactNode }

export class PlayerErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override render() {
    if (!this.state.failed) return this.props.children
    const { traceId } = this.props
    return (
      <div role="alert" className="flex flex-col gap-1 rounded-xl bg-danger-subtle p-4">
        <p className="font-medium text-danger">Something went wrong</p>
        <p className="text-muted-foreground">
          The visualizer hit an error while drawing this trace.
        </p>
        {traceId && (
          <p className="font-mono text-xs text-muted-foreground select-all">Trace ID: {traceId}</p>
        )}
      </div>
    )
  }
}
