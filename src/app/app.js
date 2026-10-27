/**
 * app entry
 */

import log from './common/log.js'
import { packInfo, appRoot, assetVersion, isDev } from './common/runtime-constants.js'
import { verifyProductionAssets } from './lib/production-assets.js'
import { enforceSecurityConfig } from './lib/security.js'
import { once } from 'node:events'
import { managedConfig } from './lib/managed-config.js'
import { startManagedAccess } from './lib/managed-access.js'
import { randomBytes } from 'node:crypto'
import { createShutdown } from './lib/shutdown.js'
import { cleanupWidgets } from './widgets/load-widget.js'
import globalState from './server/global-state.js'

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err)
})
process.on('unhandledRejection', (err) => {
  log.error('unhandledRejection', err)
})

async function main () {
  log.info('app start')
  enforceSecurityConfig(log)
  if (!isDev) {
    await verifyProductionAssets({ root: appRoot, version: assetVersion, views: process.env.VIEW_FOLDER })
  }
  const { createApp } = await import('./server/server.js')
  const managed = managedConfig()
  const managedLocalAuth = managed ? randomBytes(32).toString('hex') : undefined
  const app = await createApp({ managedLocalAuth })

  const { HOST, PORT } = process.env

  const server = app.listen(PORT, HOST, () => {
    console.log(`server runs on http://${HOST}:${PORT}`)
  })
  await once(server, 'listening')
  let access
  if (managed) {
    const { createAgent } = await import('@ai-security-tool/managed-access')
    let lastStatus
    access = await startManagedAccess({
      server,
      createAgent,
      version: packInfo.version,
      localAuth: managedLocalAuth,
      onStatus: state => {
        const key = JSON.stringify([state.status, state.url, state.error])
        if (lastStatus === key) return
        lastStatus = key
        console.info(`[managed] ${state.status}; installation=${state.id}; fingerprint=${state.fingerprint}${state.url ? '; url=' + state.url : ''}`)
        if (state.error) log.error('[managed]', state.error)
      }
    })
  }
  const shutdown = createShutdown({
    server,
    stopManaged: access ? () => access.stop() : undefined,
    stopWidgets: cleanupWidgets,
    getSessions: () => Object.values(globalState.data),
    log,
    exit: code => process.exit(code)
  })
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

// main() is async, so anything thrown inside it (a failed import, an
// unreadable config, a bad platform integration) used to surface only as an
// UnhandledPromiseRejection while the server silently never listened.
// Fail loudly instead, so the next one of these is diagnosable from the
// message and a process supervisor can restart it.
main().catch((err) => {
  log.error(`Failed to start ${packInfo.name}:`, err)
  process.exit(1)
})
