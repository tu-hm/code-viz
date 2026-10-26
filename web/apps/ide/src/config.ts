function parseBool(name: string, raw: string | undefined) {
  if (raw === undefined || raw === '' || raw === 'false') return false
  if (raw === 'true') return true
  throw new Error(`${name}: want true or false, got "${raw}"`)
}

const env = import.meta.env

export const config = {
  apiBaseUrl: env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1',
  useMsw: parseBool('VITE_USE_MSW', env.VITE_USE_MSW),
}
