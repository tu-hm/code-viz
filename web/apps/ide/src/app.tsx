import { Player } from '@viz/player'
import type { DevFixture } from './dev-fixture.ts'
import { PlayerErrorBoundary } from './error-boundary.tsx'
import { useFlag } from './flags.ts'
import { Ide } from './ide.tsx'

export function App({ fixture }: { fixture: DevFixture | null }) {
  const visualize = useFlag('visualize')
  if (fixture !== null && visualize) {
    return (
      <PlayerErrorBoundary traceId={fixture.source.header.id}>
        <Player
          source={fixture.source}
          code={fixture.code}
          stdin={fixture.stdin}
          language={fixture.language}
          onClose={() => location.assign(location.pathname)}
        />
      </PlayerErrorBoundary>
    )
  }
  return <Ide />
}
