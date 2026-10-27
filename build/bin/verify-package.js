import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyProductionAssets } from '../../src/app/lib/production-assets.js'
import { noticesRequired, verifyThirdPartyNotices } from './verify-third-party-notices.js'

const root = process.cwd()
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const version = manifest.devDependencies['@ai-security-tool/electerm-react']
for (const filename of [
  'npm/anubis-web.js',
  'src/app/app.js',
  'scripts/configure-managed.js'
]) {
  await access(resolve(root, filename))
}
await verifyProductionAssets({ root, version })
if (noticesRequired(version)) {
  await verifyThirdPartyNotices(resolve(root, 'dist/assets/third-party'), { requireCompliance: true })
}
console.log(`Ready to pack ${manifest.name}@${manifest.version}; renderer ${version}`)
