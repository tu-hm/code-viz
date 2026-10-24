import { Player } from '@viz/player'
import type { DevFixture } from './dev-fixture.ts'
import { PlayerErrorBoundary } from './error-boundary.tsx'
import { useFlag } from './flags.ts'

export function App({ fixture }: { fixture: DevFixture | null }) {
  const visualize = useFlag('visualize')
  if (fixture !== null && visualize) {
    return (
      <PlayerErrorBoundary traceId={fixture.source.header.id}>
        <Player
          source={fixture.source}
          stdin={fixture.stdin}
          language={fixture.language}
          onClose={() => location.assign(location.pathname)}
        />
      </PlayerErrorBoundary>
    )
  }
  return (
    <main className="flex min-h-dvh flex-col gap-4 p-6">
      <h1 className="mono-label text-muted-foreground">Code Visualizer</h1>
      <PlayerErrorBoundary>
        <p className="text-faint">Nothing to visualize yet.</p>
      </PlayerErrorBoundary>
    </main>
  )
}
