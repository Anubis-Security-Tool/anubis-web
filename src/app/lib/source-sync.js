export function sourceSyncDefaults (env = process.env) {
  const { ANUBIS_SYNC_URL: address, ANUBIS_SYNC_USER: user, ANUBIS_SYNC_JWT_SECRET: secret } = env
  if ([address, user, secret].every(value => value === undefined)) return null
  if (!address || !user || !secret) throw new Error('New-profile local sync requires ANUBIS_SYNC_URL, ANUBIS_SYNC_USER and ANUBIS_SYNC_JWT_SECRET together')
  const url = new URL(address)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/api/sync') {
    throw new Error('New-profile sync URL must be a loopback HTTP /api/sync endpoint without credentials')
  }
  if (!/^[a-zA-Z0-9_.@-]{1,128}$/.test(user) ||
      secret.length < 32 || secret.length > 4096 || secret.includes('####') || new Set(secret).size < 8) {
    throw new Error('New-profile sync requires a valid user ID and a unique JWT secret of at least 32 characters')
  }
  return {
    customApiUrl: url.href,
    customAccessToken: secret,
    customGistId: user
  }
}
