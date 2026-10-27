import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { treeManifest, treeHash } from '../../src/app/common/asset-manifest.js'
import { verifyProductionAssets } from '../../src/app/lib/production-assets.js'
import { ownRegistryLock } from './registry-lock.js'

const registry = 'https://npm.anubis.locker/'
const rendererName = '@ai-security-tool/electerm-react'

export async function stageStandalone ({ root = process.cwd(), assetsPackage, sourceCommit }) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit || '')) throw new Error('Standalone staging requires the full Web source commit')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
  const version = manifest.devDependencies[rendererName]
  assetsPackage ||= resolve(root, 'dist', `browser-assets-package-${version}`)
  const browser = JSON.parse(await readFile(resolve(assetsPackage, 'package.json'), 'utf8'))
  const provenance = JSON.parse(await readFile(resolve(assetsPackage, 'source.json'), 'utf8'))
  const locked = lock.packages[`node_modules/${rendererName}`]
  if (browser.name !== '@ai-security-tool/anubis-browser-assets' || browser.version !== version ||
      provenance.renderer?.version !== version || provenance.renderer.name !== rendererName ||
      locked?.version !== version || new URL(locked.resolved).origin !== new URL(registry).origin ||
      provenance.renderer.integrity !== locked.integrity) {
    throw new Error('Standalone candidate must use the exact pinned immutable browser-assets package')
  }
  await mkdir(resolve(root, 'dist'), { recursive: true })
  const directory = await mkdtemp(resolve(root, 'dist', `standalone-candidate-${version}-`))
  const destination = resolve(directory, 'package')
  await mkdir(destination)
  for (const item of manifest.files.filter(item => !item.startsWith('dist/'))) {
    await cp(resolve(root, item), resolve(destination, item), { recursive: true })
  }
  await cp(resolve(assetsPackage, 'assets'), resolve(destination, 'dist/assets'), { recursive: true })
  await cp(resolve(root, 'src/app/views'), resolve(destination, 'dist/views'), { recursive: true })
  await cp(resolve(assetsPackage, 'source.json'), resolve(destination, 'dist/asset-manifest.json'))
  const candidate = { ...manifest, private: true, files: [...manifest.files, 'npm-shrinkwrap.json', 'release.json'] }
  await writeFile(resolve(destination, 'package.json'), JSON.stringify(candidate, null, 2) + '\n')
  await writeFile(resolve(destination, 'npm-shrinkwrap.json'), JSON.stringify(ownRegistryLock(lock), null, 2) + '\n')
  await verifyProductionAssets({ root: destination, version })
  const payload = await treeManifest(destination)
  const release = {
    candidate: true,
    publishable: false,
    runtimeVersion: manifest.version,
    webSourceCommit: sourceCommit,
    renderer: provenance.renderer,
    assets: { count: provenance.assets.count, treeSha256: provenance.assets.treeSha256 },
    payload: { treeSha256: treeHash(payload), files: payload },
    dependencyRegistry: registry,
    install: 'npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --registry=https://npm.anubis.locker/'
  }
  await writeFile(resolve(destination, 'release.json'), JSON.stringify(release, null, 2) + '\n')
  console.log(JSON.stringify({ destination, release: resolve(destination, 'release.json'), renderer: version, private: true }))
  return { destination, release }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: { 'browser-assets': { type: 'string' }, 'source-commit': { type: 'string' } }
  })
  const sourceCommit = values['source-commit'] || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  stageStandalone({ assetsPackage: values['browser-assets'], sourceCommit }).catch(error => {
    console.error('Failed to stage standalone candidate:', error.message)
    process.exitCode = 1
  })
}
