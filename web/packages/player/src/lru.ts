export function createLru<K, V>(max: number) {
  const entries = new Map<K, V>()
  return {
    get(key: K) {
      const value = entries.get(key)
      if (value === undefined) return undefined
      entries.delete(key)
      entries.set(key, value)
      return value
    },
    set(key: K, value: V) {
      entries.delete(key)
      entries.set(key, value)
      if (entries.size > max) entries.delete(entries.keys().next().value!)
    },
    get size() {
      return entries.size
    },
  }
}
