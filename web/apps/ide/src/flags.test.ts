import { describe, expect, test } from 'vitest'
import { parseFlags } from './flags.ts'

describe('parseFlags', () => {
  test.each([
    { name: 'empty enables nothing', raw: '', want: [] },
    { name: 'a known flag is enabled', raw: 'visualize', want: ['visualize'] },
    { name: 'spaces and empty entries are ignored', raw: ' visualize , ,', want: ['visualize'] },
  ])('$name', ({ raw, want }) => {
    expect([...parseFlags(raw)]).toEqual(want)
  })

  test('an unknown flag fails at startup instead of silently staying off', () => {
    expect(() => parseFlags('visualise')).toThrow('unknown flag "visualise"')
  })
})
