const names = ['visualize'] as const

export type Flag = (typeof names)[number]

function isFlag(name: string): name is Flag {
  return (names as readonly string[]).includes(name)
}

export function parseFlags(raw: string): ReadonlySet<Flag> {
  const flags = new Set<Flag>()
  for (const name of raw.split(',').map((s) => s.trim())) {
    if (name === '') continue
    if (!isFlag(name)) {
      throw new Error(`VITE_FLAGS: unknown flag "${name}"; known flags: ${names.join(', ')}`)
    }
    flags.add(name)
  }
  return flags
}

const enabled = parseFlags(import.meta.env.VITE_FLAGS ?? '')

export function useFlag(flag: Flag) {
  return enabled.has(flag)
}
