import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stageBrowserAssets } from '../../build/bin/browser-assets.js'

const renderer = '@ai-security-tool/electerm-react'
const version = '5.7.2'
const sourceCommit = 'a'.repeat(40)
const run = promisify(execFile)
const installScript = fileURLToPath(new URL('../../build/bin/install.js', import.meta.url))

async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'anubis-browser-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = async (path, content) => {
    const filename = join(root, path)
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }
  const installed = join('node_modules', '@ai-security-tool', 'electerm-react')
  await file('package.json', JSON.stringify({ type: 'module', devDependencies: { [renderer]: version } }))
  await file(join(installed, 'package.json'), JSON.stringify({ name: renderer, version }))
  const license = await readFile(new URL('../../LICENSE', import.meta.url))
  await file(join(installed, 'LICENSE'), license)
  await file(join(installed, 'client', 'entry.jsx'), 'published immutable renderer')
  await file('package-lock.json', JSON.stringify({
    packages: {
      [`node_modules/${renderer}`]: {
        version,
        resolved: `https://npm.anubis.locker/@ai-security-tool/electerm-react/-/electerm-react-${version}.tgz`,
        integrity: 'sha512-' + Buffer.alloc(64, 1).toString('base64')
      }
    }
  }))
  await file('LICENSE', license)
  for (const name of [
    join('js', `basic-${version}.js`), join('js', `electerm-${version}.js`), join('js', `worker-${version}.js`),
    join('css', `style-${version}.css`), join('images', 'logo.png'), join('icons', 'terminal.svg'),
    join('assets', 'font.woff2'), join('assets', 'protocol.wasm')
  ]) {
    await file(join('dist', 'assets', name), name)
  }
  await file(join('dist', 'browser-assets-package', 'preserved.txt'), 'old immutable package')
  return { root, file, installed }
}

test('browser asset staging preserves prior outputs and binds complete assets to exact own renderer', async t => {
  const { root } = await fixture(t)
  const { destination, binding } = await stageBrowserAssets({ root, sourceCommit })
  assert.equal(destination, join(root, 'dist', `browser-assets-package-${version}`))
  const manifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@ai-security-tool/anubis-browser-assets')
  assert.equal(manifest.version, version)
  assert.equal(manifest.main, 'package.json')
  assert.equal(manifest.publishConfig.registry, 'https://npm.anubis.locker/')
  assert.ok(manifest.files.includes('source.json'))
  assert.equal(binding.renderer.sourceCommit, sourceCommit)
  assert.equal(binding.renderer.version, version)
  assert.equal(binding.assets.count, 11)
  assert.ok(binding.assets.files['third-party/index.json'])
  assert.match(binding.assets.treeSha256, /^[0-9a-f]{64}$/)
  for (const [name, hash] of Object.entries(binding.assets.files)) {
    const contents = await readFile(join(destination, 'assets', ...name.split('/')))
    assert.equal(createHash('sha256').update(contents).digest('hex'), hash)
  }
  const recorded = await readFile(join(destination, 'source.json'), 'utf8')
  assert.deepEqual(JSON.parse(recorded), binding)
  await assert.rejects(stageBrowserAssets({ root, sourceCommit }), /Refusing to replace/)
  assert.equal(await readFile(join(destination, 'source.json'), 'utf8'), recorded)
  assert.equal(await readFile(join(root, 'dist', 'browser-assets-package', 'preserved.txt'), 'utf8'), 'old immutable package')
})

test('browser asset staging rejects installed version mismatch and public-registry source', async t => {
  const { root, installed, file } = await fixture(t)
  await file(join(installed, 'package.json'), JSON.stringify({ name: renderer, version: '5.7.0' }))
  await assert.rejects(stageBrowserAssets({ root }), /match the exact/)
  await file(join(installed, 'package.json'), JSON.stringify({ name: renderer, version }))
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  lock.packages[`node_modules/${renderer}`].resolved = 'https://registry.npmjs.org/uncontrolled.tgz'
  await file('package-lock.json', JSON.stringify(lock))
  await assert.rejects(stageBrowserAssets({ root }), /own HTTPS registry/)
  await assert.rejects(access(join(root, 'dist', `browser-assets-package-${version}`)), { code: 'ENOENT' })
})

test('browser asset staging requires fonts and WASM instead of publishing an incomplete tree', async t => {
  const { root } = await fixture(t)
  await rm(join(root, 'dist', 'assets', 'assets', 'protocol.wasm'))
  await assert.rejects(stageBrowserAssets({ root }), /Missing required browser assets/)
  await assert.rejects(access(join(root, 'dist', `browser-assets-package-${version}`)), { code: 'ENOENT' })
})

test('new renderer releases cannot omit publisher-bound provenance or an accepted source commit', async t => {
  const { root, file, installed } = await fixture(t)
  await file('package.json', JSON.stringify({ type: 'module', devDependencies: { [renderer]: '5.7.5' } }))
  await file(join(installed, 'package.json'), JSON.stringify({ name: renderer, version: '5.7.5' }))
  await assert.rejects(stageBrowserAssets({ root }), /publisher-bound source provenance/)
  await assert.rejects(access(join(root, 'dist', 'browser-assets-package-5.7.5')), { code: 'ENOENT' })
})

test('isolated build refuses stale copied renderer source before invoking compilation', async t => {
  const { root, file } = await fixture(t)
  await file(join('src', 'client', 'electerm-react', 'entry.jsx'), 'outdated renderer')
  await assert.rejects(stageBrowserAssets({ root, build: true, sourceCommit }), /Copied renderer source differs/)
  await assert.rejects(access(join(root, 'dist', `browser-assets-package-${version}`)), { code: 'ENOENT' })
  await assert.rejects(stageBrowserAssets({ root, sourceCommit: 'partial' }), /full Git commit hash/)
})

test('source install preserves published shared modules with natural imports and integrity binding', async t => {
  const { root, file, installed } = await fixture(t)
  await file(join('src', 'client', 'entry-web', 'entry.js'), '')
  await file(join(installed, 'client', 'common', 'parse-vv.js'), "export { parseVv } from '../../app/common/parse-vv.mjs'")
  const shared = "export const parseVv = () => 'published-shared-parser'"
  await file(join(installed, 'app', 'common', 'parse-vv.mjs'), shared)
  await run(process.execPath, [installScript], { cwd: root })
  const copied = join(root, 'src', 'client', 'app', 'common', 'parse-vv.mjs')
  assert.equal(await readFile(copied, 'utf8'), shared)
  const entry = join(root, 'src', 'client', 'electerm-react', 'common', 'parse-vv.js')
  assert.equal((await import(pathToFileURL(entry).href)).parseVv(), 'published-shared-parser')
  await writeFile(copied, 'modified copied parser')
  await assert.rejects(stageBrowserAssets({ root, build: true, sourceCommit }), /Copied shared modules differ/)
  await writeFile(copied, shared)
  const { binding } = await stageBrowserAssets({ root, sourceCommit })
  assert.equal(binding.renderer.sharedSources.files['parse-vv.mjs'], createHash('sha256').update(shared).digest('hex'))
})

test('source install rejects an incomplete renderer package before replacing existing sources', async t => {
  const { root, file, installed } = await fixture(t)
  await file(join('src', 'client', 'entry-web', 'entry.js'), '')
  await file(join(installed, 'client', 'common', 'parse-vv.js'), "export { parseVv } from '../../app/common/parse-vv.mjs'")
  await file(join('src', 'client', 'electerm-react', 'preserved.js'), 'previous-complete-source')
  await assert.rejects(run(process.execPath, [installScript], { cwd: root }), /Published renderer is missing/)
  assert.equal(await readFile(join(root, 'src', 'client', 'electerm-react', 'preserved.js'), 'utf8'), 'previous-complete-source')
})
