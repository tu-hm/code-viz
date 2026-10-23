import { PlayerErrorBoundary } from './error-boundary.tsx'

export function App() {
  return (
    <main className="flex min-h-dvh flex-col gap-4 p-6">
      <h1 className="mono-label text-muted-foreground">Code Visualizer</h1>
      <PlayerErrorBoundary>
        <p className="text-faint">Nothing to visualize yet.</p>
      </PlayerErrorBoundary>
    </main>
  )
}
