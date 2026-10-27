import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { collectThirdPartyNotices } from '../../build/bin/third-party-notices.js'
import { verifyThirdPartyNotices } from '../../build/bin/verify-third-party-notices.js'
import { verifyProductionAssets, writeProductionManifest } from '../../src/app/lib/production-assets.js'
import { treeManifest } from '../../src/app/common/asset-manifest.js'
import { verifyAssetArchive } from '../../build/bin/verify-release-archives.js'
import { create } from 'tar'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const original = await readFile(new URL('../../LICENSE', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const run = promisify(execFile)

async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'anubis-original-notices-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = async (name, bytes) => {
    const target = join(root, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  await file('LICENSE', original)
  await file('package-lock.json', JSON.stringify({
    packages: {
      '': { name: 'notice-fixture' },
      'node_modules/example': { version: '1.0.0', resolved: 'https://npm.anubis.locker/example/-/example-1.0.0.tgz' },
      'node_modules/optional-host': { version: '1.0.0', optional: true }
    }
  }))
  await file('node_modules/example/package.json', '{"name":"example","version":"1.0.0","license":"MIT"}')
  await file('node_modules/example/LICENSE', original)
  await file('node_modules/example/NOTICE', Buffer.from('Original project attribution\r\n'))
  await file('node_modules/example/README.md', '# Original upstream documentation\r\n')
  await file('node_modules/example/vendor/licenses/pako.txt', original)
  return { root, assets: join(root, 'dist/assets'), file }
}

async function capsuleFixture ({ root, file }, { declarationOnly = false } = {}) {
  const name = '@ai-security-tool/third-party-compliance'
  const directory = `node_modules/${name}`
  const integrity = 'sha512-' + Buffer.alloc(64, 1).toString('base64')
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json')))
  lock.packages[`node_modules/${name}`] = {
    version: '1.0.1',
    resolved: 'https://npm.anubis.locker/compliance/-/compliance-1.0.1.tgz',
    integrity
  }
  lock.packages['node_modules/example'].integrity = integrity
  await file('package-lock.json', JSON.stringify(lock))
  const source = Buffer.from('exact original source archive fixture bytes')
  const files = declarationOnly
    ? [{ path: 'sources/example.tar.gz', bytes: source.length, sha256: hash(source) }]
    : [{ path: 'notices/example.txt', bytes: original.length, sha256: hash(original) },
        { path: 'sources/example.tar.gz', bytes: source.length, sha256: hash(source) }]
  const manifest = {
    schemaVersion: 1,
    packages: [{
      name: 'example',
      version: '1.0.0',
      license: 'MIT',
      registryIntegrity: integrity,
      upstream: { repository: 'https://github.com/original/project', commit: declarationOnly ? null : 'a'.repeat(40) },
      noticeFiles: declarationOnly ? [] : ['notices/example.txt'],
      sourceArchives: ['sources/example.tar.gz'],
      status: declarationOnly ? 'upstream-declaration-only' : 'original-notices'
    }],
    files
  }
  await file(`${directory}/package.json`, JSON.stringify({ name, version: '1.0.1' }))
  await file(`${directory}/manifest.json`, JSON.stringify(manifest))
  await file(`${directory}/sources/example.tar.gz`, source)
  if (!declarationOnly) await file(`${directory}/notices/example.txt`, original)
  return { directory, manifest }
}

test('preserves original nested/root notices, README and metadata byte-for-byte, deterministically', async t => {
  const { root, assets } = await fixture(t)
  const first = await collectThirdPartyNotices({ root, assets })
  const directory = join(assets, 'third-party')
  const recorded = await readFile(join(directory, 'index.json'))
  assert.equal(first.packages.length, 1)
  assert.equal(first.packages[0].coverage, 'original-legal-files')
  assert.equal(first.packages[0].complete, true)
  for (const notice of first.packages[0].notices) {
    assert.deepEqual(
      await readFile(join(directory, notice.file)),
      await readFile(join(root, 'node_modules/example', notice.path))
    )
  }
  assert.ok(first.packages[0].notices.some(notice => notice.path === 'vendor/licenses/pako.txt'))
  assert.ok(first.packages[0].notices.some(notice => notice.path === 'README.md'))
  await collectThirdPartyNotices({ root, assets })
  assert.deepEqual(await readFile(join(directory, 'index.json')), recorded)
  assert.deepEqual(await verifyThirdPartyNotices(directory), first)
})

test('a license label or upstream URL alone cannot substitute for original legal terms', async t => {
  const { root, assets, file } = await fixture(t)
  await rm(join(root, 'node_modules/example/LICENSE'))
  await rm(join(root, 'node_modules/example/NOTICE'))
  await rm(join(root, 'node_modules/example/vendor'), { recursive: true })
  await file('node_modules/example/README.md', 'License: MIT. https://example.test/LICENSE')
  const header = '/** @license Original authors. MIT; see LICENSE. */\nexport const unchanged = 1\n'
  await file('node_modules/example/src/index.ts', header)
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /Unresolved original.*example@1.0.0.*readme-only/)
  const index = JSON.parse(await readFile(join(assets, 'third-party/index.json')))
  assert.equal(index.packages[0].complete, false)
  assert.equal(index.packages[0].coverage, 'readme-only')
  const preservedHeader = index.packages[0].notices.find(item => item.path === 'src/index.ts')
  assert.deepEqual(await readFile(join(assets, 'third-party', preservedHeader.file)), Buffer.from(header))
  await file('node_modules/example/README.md', original)
  await collectThirdPartyNotices({ root, assets })
})

test('capsule originals reject changed bytes, unsafe paths and unpinned provenance', async t => {
  const context = await fixture(t)
  const { root, assets, file } = context
  const { directory, manifest } = await capsuleFixture(context)
  await file(`${directory}/sources/example.tar.gz`, 'modified original')
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /checksum\/size mismatch/)
  manifest.files[0].path = '../outside.txt'
  await file(`${directory}/manifest.json`, JSON.stringify(manifest))
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /Unsafe original compliance path/)
  await capsuleFixture(context)
  manifest.files[0].path = 'notices/example.txt'
  manifest.packages[0].upstream.commit = 'partial'
  await file(`${directory}/manifest.json`, JSON.stringify(manifest))
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /Unpinned compliance package provenance/)
})

test('rejects missing, changed, extra and traversal notice entries', async t => {
  const { root, assets, file } = await fixture(t)
  const index = await collectThirdPartyNotices({ root, assets })
  const directory = join(assets, 'third-party')
  const notice = index.packages[0].notices[0].file
  await writeFile(join(directory, notice), 'changed')
  await assert.rejects(verifyThirdPartyNotices(directory), /checksum mismatch/)
  await collectThirdPartyNotices({ root, assets })
  await rm(join(directory, notice))
  await assert.rejects(verifyThirdPartyNotices(directory), { code: 'ENOENT' })
  await collectThirdPartyNotices({ root, assets })
  await file('dist/assets/third-party/unrecorded.txt', 'not recorded')
  await assert.rejects(verifyThirdPartyNotices(directory), /file list is incomplete/)
  delete index.files[notice]
  index.files['../outside.txt'] = 'a'.repeat(64)
  await writeFile(join(directory, 'index.json'), JSON.stringify(index))
  await assert.rejects(verifyThirdPartyNotices(directory), /Unsafe third-party/)
})

test('stale or absent nonoptional installed packages cannot be attributed to the accepted lock', async t => {
  const { root, assets, file } = await fixture(t)
  await file('node_modules/example/package.json', '{"name":"example","version":"2.0.0"}')
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /differs from the notice source lock/)
  await rm(join(root, 'node_modules/example/package.json'))
  await assert.rejects(collectThirdPartyNotices({ root, assets }), { code: 'ENOENT' })
  await file('node_modules/example/package.json', '{"name":"example","version":"1.0.0","_where":"C:\\\\private-profile"}')
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /private installation paths/)
})

test('copies the complete capsule/source with exact provenance and rejects a different accepted SRI', async t => {
  const context = await fixture(t)
  const { root, assets, file } = context
  const { directory, manifest } = await capsuleFixture(context)
  await rm(join(root, 'node_modules/example/LICENSE'))
  await rm(join(root, 'node_modules/example/vendor'), { recursive: true })
  const index = await collectThirdPartyNotices({ root, assets })
  assert.equal(index.compliance.name, '@ai-security-tool/third-party-compliance')
  assert.equal(index.packages[0].coverage, 'compliance:original-notices')
  for (const original of manifest.files) {
    assert.deepEqual(
      await readFile(join(assets, 'third-party/compliance', original.path)),
      await readFile(join(root, directory, original.path))
    )
  }
  await verifyThirdPartyNotices(join(assets, 'third-party'), { requireCompliance: true })
  const missingSource = structuredClone(index)
  missingSource.packages[0].license = 'MPL-2.0'
  delete missingSource.packages[0].sourceArchives
  await file('dist/assets/third-party/index.json', JSON.stringify(missingSource))
  await assert.rejects(verifyThirdPartyNotices(join(assets, 'third-party'), { requireCompliance: true }), /preferred source is required/)
  manifest.packages[0].registryIntegrity = 'sha512-' + Buffer.alloc(64, 2).toString('base64')
  await file(`${directory}/manifest.json`, JSON.stringify(manifest))
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /differs from the accepted package/)
})

test('records an explicit upstream declaration-only exception without fabricating a grant', async t => {
  const context = await fixture(t)
  const { root, assets } = context
  await capsuleFixture(context, { declarationOnly: true })
  await rm(join(root, 'node_modules/example/LICENSE'))
  await rm(join(root, 'node_modules/example/vendor'), { recursive: true })
  const index = await collectThirdPartyNotices({ root, assets })
  assert.equal(index.packages[0].upstreamStatus, 'upstream-declaration-only')
  assert.equal(index.packages[0].complete, true)
  assert.equal(index.packages[0].sourceArchives.length, 1)
  const document = index.packages[0].notices.find(item => item.path === 'README.md')
  assert.equal((await readFile(join(assets, 'third-party', document.file), 'utf8')), '# Original upstream documentation\r\n')
})

test('exact musl binding reuses its proven shared-project notice, never another version or integrity', async t => {
  const context = await fixture(t)
  const { root, assets, file } = context
  const { directory, manifest } = await capsuleFixture(context)
  const proof = JSON.parse(await readFile(new URL('../../build/notices/rolldown-musl-common-notice.json', import.meta.url)))
  const notice = proof.noticeFile
  manifest.files.push({ path: notice, bytes: original.length, sha256: hash(original) })
  manifest.packages.push({
    name: proof.exactSameUpstreamCommitAsSupplement,
    version: proof.version,
    license: proof.license,
    registryIntegrity: 'sha512-' + Buffer.alloc(64, 3).toString('base64'),
    upstream: { repository: 'https://github.com/rolldown/rolldown', commit: proof.gitHead },
    noticeFiles: [notice],
    sourceArchives: [],
    status: 'original-source-notice'
  })
  await file(`${directory}/${notice}`, original)
  await file(`${directory}/manifest.json`, JSON.stringify(manifest))
  const key = `node_modules/${proof.name}`
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json')))
  lock.packages[key] = { version: proof.version, integrity: proof.integrity }
  await file('package-lock.json', JSON.stringify(lock))
  await file(`${key}/package.json`, JSON.stringify({ name: proof.name, version: proof.version, license: proof.license }))
  const readme = '# Original optional musl compiler binding\n'
  await file(`${key}/README.md`, readme)
  const index = await collectThirdPartyNotices({ root, assets, requireCompliance: true })
  const binding = index.packages.find(item => item.name === proof.name)
  assert.equal(binding.upstreamStatus, 'shared-upstream-original-notice')
  assert.equal(binding.upstream.commit, proof.gitHead)
  assert.equal(binding.sharedUpstream.package, proof.exactSameUpstreamCommitAsSupplement)
  const savedReadme = binding.notices.find(item => item.path === 'README.md')
  assert.equal(await readFile(join(assets, 'third-party', savedReadme.file), 'utf8'), readme)
  assert.deepEqual(await readFile(join(assets, 'third-party', binding.sharedUpstream.registryIdentityProof)),
    await readFile(new URL('../../build/notices/rolldown-musl-common-notice.json', import.meta.url)))
  lock.packages[key].integrity = 'sha512-' + Buffer.alloc(64, 4).toString('base64')
  await file('package-lock.json', JSON.stringify(lock))
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /does not match the exact musl binding/)
  lock.packages[key].integrity = proof.integrity
  lock.packages[key].version = '1.0.4'
  await file('package-lock.json', JSON.stringify(lock))
  await file(`${key}/package.json`, JSON.stringify({ name: proof.name, version: '1.0.4', license: proof.license }))
  await assert.rejects(collectThirdPartyNotices({ root, assets }), /does not match the exact musl binding/)
})

test('576 build gates require the capsule and existing production integrity covers its originals', async t => {
  const context = await fixture(t)
  const { root, assets, file } = context
  const version = '5.7.6'
  for (const name of [
    `js/basic-${version}.js`, `js/electerm-${version}.js`, `js/worker-${version}.js`,
    `css/style-${version}.css`, 'images/electerm.png', 'images/electerm-watermark.png',
    'icons/terminal.svg', 'assets/font.woff2', 'assets/protocol.wasm'
  ]) await file(join('dist/assets', name), name)
  await file('dist/views/index.pug', 'p ready')
  await assert.rejects(verifyThirdPartyNotices(join(assets, 'third-party'), { requireCompliance: true }), { code: 'ENOENT' })
  await collectThirdPartyNotices({ root, assets })
  await assert.rejects(collectThirdPartyNotices({ root, assets, requireCompliance: true }), /compliance capsule is required/)
  await capsuleFixture(context)
  const index = await collectThirdPartyNotices({ root, assets })
  await writeProductionManifest({ root, version })
  await verifyProductionAssets({ root, version })
  const manifest = JSON.parse(await readFile(join(root, 'dist/asset-manifest.json')))
  assert.equal(manifest.assets.files['third-party/index.json'], hash(await readFile(join(assets, 'third-party/index.json'))))
  await rm(join(assets, 'third-party', index.packages[0].notices[0].file))
  await assert.rejects(verifyProductionAssets({ root, version }), /payload is not ready/)
})

test('actual archive gates detect dropped or modified notice/source bytes after npm-style packing', async t => {
  const context = await fixture(t)
  const { root, assets } = context
  await capsuleFixture(context)
  const index = await collectThirdPartyNotices({ root, assets })
  const files = await treeManifest(assets)
  const directory = join(root, 'archive-stage')
  await mkdir(join(directory, 'package/assets'), { recursive: true })
  await cp(assets, join(directory, 'package/assets'), { recursive: true })
  const file = join(root, 'package.tgz')
  const pack = () => create({ cwd: directory, file, gzip: true }, ['package'])
  await pack()
  assert.equal((await verifyAssetArchive({ file, prefix: 'assets', files })).verifiedAssets, Object.keys(files).length)
  const source = index.packages[0].sourceArchives[0]
  await rm(join(directory, 'package/assets/third-party', source))
  await pack()
  await assert.rejects(verifyAssetArchive({ file, prefix: 'assets', files }), /omitted from actual archive/)
  await cp(assets, join(directory, 'package/assets'), { recursive: true })
  await writeFile(join(directory, 'package/assets/third-party', source), 'changed source')
  await pack()
  await assert.rejects(verifyAssetArchive({ file, prefix: 'assets', files }), /checksum mismatch/)
})

test('real npm packing preserves nested capsule originals, source archives and notice metadata', async t => {
  const context = await fixture(t)
  const { root, assets, file } = context
  await capsuleFixture(context)
  await collectThirdPartyNotices({ root, assets })
  const directory = join(root, 'npm-stage')
  await file('npm-stage/package.json', '{"name":"anubis-notice-fixture","version":"0.0.0","files":["assets"]}')
  await cp(assets, join(directory, 'assets'), { recursive: true })
  const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const { stdout } = await run(process.execPath, [
    npm, 'pack', directory, '--ignore-scripts', '--json', '--pack-destination', root
  ], { cwd: root })
  const [packed] = JSON.parse(stdout)
  const files = await treeManifest(assets)
  const report = await verifyAssetArchive({ file: join(root, packed.filename), prefix: 'assets', files })
  assert.equal(report.verifiedAssets, Object.keys(files).length)
})
