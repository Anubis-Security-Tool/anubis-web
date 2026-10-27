import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify, parseArgs } from 'node:util'
import { resolveBrandResDir } from '../../src/app/common/brand-res.js'
import { treeManifest, treeHash } from '../../src/app/common/asset-manifest.js'
import { verifyRendererSource } from './renderer-source.js'

const run = promisify(execFile)
const rendererName = '@ai-security-tool/electerm-react'
const registry = 'https://npm.anubis.locker/'

export async function stageBrowserAssets ({
  root = process.cwd(),
  build = false,
  sourceCommit
} = {}) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const version = manifest.devDependencies[rendererName]
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Browser assets require an exact renderer version')
  if (build && !sourceCommit) throw new Error('An isolated release build requires the renderer source commit')
  if (sourceCommit !== undefined && !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('Renderer source commit must be a full Git commit hash')
  }
  const installed = resolve(root, 'node_modules', '@ai-security-tool', 'electerm-react')
  const renderer = JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8'))
  if (renderer.anubisSource || version === '5.7.4') {
    await verifyRendererSource(installed, renderer, sourceCommit)
  }
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
  const locked = lock.packages[`node_modules/${rendererName}`]
  if (renderer.name !== rendererName || renderer.version !== version || locked?.version !== version) {
    throw new Error('Installed renderer and lockfile must match the exact source manifest pin')
  }
  const resolved = new URL(locked.resolved)
  if (resolved.origin !== new URL(registry).origin || resolved.username || resolved.password ||
      resolved.search || resolved.hash || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(locked.integrity)) {
    throw new Error('Renderer must be integrity-pinned to the own HTTPS registry')
  }
  const rendererSource = await treeManifest(resolve(installed, 'client'))
  const rendererSourceHash = treeHash(rendererSource)
  const requiredSupport = []
  for (const name of ['parse-vv', 'vv-to-tab']) {
    const entry = `common/${name}.js`
    if (rendererSource[entry]) {
      const contents = await readFile(resolve(installed, 'client', 'common', `${name}.js`), 'utf8')
      if (contents.includes(`../../app/common/${name}.mjs`)) requiredSupport.push(`${name}.mjs`)
    }
  }
  let sharedSources
  if (requiredSupport.length) {
    sharedSources = await treeManifest(resolve(installed, 'app', 'common'))
    for (const name of requiredSupport) {
      if (!sharedSources[name]) throw new Error(`Published renderer shared module is missing: ${name}`)
    }
  }
  const destination = resolve(root, 'dist', `browser-assets-package-${version}`)
  try {
    await access(destination)
    throw new Error(`Refusing to replace an existing browser package: ${destination}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  let assets = resolve(root, 'dist', 'assets')
  if (build || renderer.anubisSource) {
    const copied = await treeManifest(resolve(root, 'src', 'client', 'electerm-react'))
    if (treeHash(copied) !== rendererSourceHash) {
      throw new Error('Copied renderer source differs from the installed immutable package; run the source install hook')
    }
    if (sharedSources) {
      const shared = await treeManifest(resolve(root, 'src', 'client', 'app', 'common'))
      if (treeHash(shared) !== treeHash(sharedSources)) {
        throw new Error('Copied shared modules differ from the installed immutable package; run the source install hook')
      }
    }
  }
  if (build) {
    await mkdir(resolve(root, 'dist'), { recursive: true })
    const output = await mkdtemp(resolve(root, 'dist', `browser-assets-build-${version}-`))
    assets = resolve(output, 'assets')
    const result = await run(process.execPath, [
      resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build',
      '--config', resolve(root, 'build', 'vite', 'conf.js'),
      '--outDir', assets, '--emptyOutDir'
    ], { cwd: root, env: { ...process.env, NODE_ENV: 'production' }, maxBuffer: 10 * 1024 * 1024 })
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    await cp(resolve(root, 'src', 'client', 'statics'), assets, { recursive: true })
    await cp(resolve(resolveBrandResDir(root), 'res', 'imgs'), resolve(assets, 'images'), { recursive: true })
    await cp(resolve(root, 'node_modules', '@ai-security-tool', 'icons', 'icons'), resolve(assets, 'icons'), { recursive: true })
  }
  for (const filename of [
    resolve(assets, 'js', `basic-${version}.js`),
    resolve(assets, 'js', `electerm-${version}.js`),
    resolve(assets, 'js', `worker-${version}.js`),
    resolve(assets, 'css', `style-${version}.css`),
    resolve(assets, 'images'),
    resolve(assets, 'icons')
  ]) {
    await access(filename)
  }
  const files = await treeManifest(assets)
  for (const pattern of [/\.(woff2?|ttf|otf)$/, /\.wasm$/, /^icons\//, /^images\//]) {
    if (!Object.keys(files).some(name => pattern.test(name))) throw new Error(`Missing required browser assets: ${pattern}`)
  }
  await mkdir(destination)
  await cp(assets, resolve(destination, 'assets'), { recursive: true })
  await cp(resolve(root, 'LICENSE'), resolve(destination, 'LICENSE'))
  const binding = {
    build: { mode: build ? 'isolated' : 'prebuilt' },
    renderer: {
      name: rendererName,
      version,
      integrity: locked.integrity,
      sourceTreeSha256: rendererSourceHash,
      ...(renderer.anubisSource ? { provenance: renderer.anubisSource } : {}),
      ...(sharedSources ? { sharedSources: { treeSha256: treeHash(sharedSources), files: sharedSources } } : {}),
      ...(sourceCommit ? { sourceCommit } : {})
    },
    assets: { treeSha256: treeHash(files), count: Object.keys(files).length, files }
  }
  await writeFile(resolve(destination, 'source.json'), JSON.stringify(binding, null, 2) + '\n')
  await writeFile(resolve(destination, 'package.json'), JSON.stringify({
    name: '@ai-security-tool/anubis-browser-assets',
    version,
    description: 'Shared Anubis browser renderer assets for desktop and Web',
    main: 'package.json',
    license: 'MIT',
    files: ['assets', 'LICENSE', 'source.json'],
    publishConfig: { registry },
    repository: {
      type: 'git',
      url: 'git+https://github.com/Anubis-Security-Tool/anubis-web.git'
    }
  }, null, 2) + '\n')
  console.log(JSON.stringify({ destination, renderer: binding.renderer, assetsTreeSha256: binding.assets.treeSha256, assetCount: binding.assets.count }))
  return { destination, binding }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: { build: { type: 'boolean', default: false }, 'source-commit': { type: 'string' } }
  })
  stageBrowserAssets({ build: values.build, sourceCommit: values['source-commit'] }).catch(error => {
    console.error('Failed to stage browser assets:', error.message)
    process.exitCode = 1
  })
}
