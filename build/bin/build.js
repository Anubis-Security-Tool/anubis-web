/**
 * build
 */
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { verifyProductionAssets, writeProductionManifest } from '../../src/app/lib/production-assets.js'
import { collectThirdPartyNotices } from './third-party-notices.js'
import { noticesRequired } from './verify-third-party-notices.js'

const root = process.cwd()
const timeStart = Date.now()
console.log('start build')
execFileSync(process.execPath, [
  resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', resolve(root, 'build/vite/conf.js')
], { cwd: root, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' })
execFileSync(process.execPath, [resolve(root, 'build/bin/copy.js')], { cwd: root, stdio: 'inherit' })
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const version = manifest.devDependencies['@ai-security-tool/electerm-react']
await collectThirdPartyNotices({
  root,
  assets: resolve(root, 'dist/assets'),
  requireCompliance: noticesRequired(version)
})
await writeProductionManifest({ root, version })
await verifyProductionAssets({ root, version })
console.log(`done build in ${(Date.now() - timeStart) / 1000} s`)
