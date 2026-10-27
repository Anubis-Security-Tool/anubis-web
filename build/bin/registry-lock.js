import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const registry = 'https://npm.anubis.locker/'

export function ownRegistryLock (value) {
  if (!value || typeof value !== 'object') return value
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'resolved') {
      const url = new URL(entry)
      if (!['https://registry.npmjs.org', 'https://registry.npmmirror.com', new URL(registry).origin].includes(url.origin) ||
          url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.tgz')) {
        throw new Error('Dependency lock contains an unsupported package source')
      }
      value[key] = new URL(url.pathname, registry).href
    } else {
      ownRegistryLock(entry)
    }
  }
  return value
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const filename = resolve('package-lock.json')
  const lock = JSON.parse(await readFile(filename, 'utf8'))
  await writeFile(filename, JSON.stringify(ownRegistryLock(lock), null, 2) + '\n')
}
