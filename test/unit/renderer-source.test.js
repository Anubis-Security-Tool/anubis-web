import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyRendererSource } from '../../build/bin/renderer-source.js'

const hash = text => createHash('sha256').update(text).digest('hex')
const commit = 'a'.repeat(40)

async function fixture (t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anubis-renderer-provenance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = {
    'app/common/parse-vv.mjs': 'export const parseVv = 1\n',
    'client/a/one.js': 'first source\n',
    'client/z.js': 'last source\n'
  }
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, name)), { recursive: true })
    await writeFile(resolve(root, name), content)
  }
  const manifest = {
    files: ['client', 'app/common/parse-vv.mjs', 'README.md', 'LICENSE'],
    anubisSource: {
      repository: 'Anubis-Security-Tool/anubis',
      commit,
      filesSha256: hash(JSON.stringify(Object.entries(files).map(([path, text]) => ({ path, sha256: hash(text) }))))
    }
  }
  return { root, manifest }
}

test('renderer provenance validates publisher path ordering and exact source bytes', async t => {
  const { root, manifest } = await fixture(t)
  assert.deepEqual(await verifyRendererSource(root, manifest, commit), manifest.anubisSource)
  await writeFile(resolve(root, 'client/z.js'), 'modified')
  await assert.rejects(verifyRendererSource(root, manifest, commit), /source bytes/)
})

test('renderer source rejects a different accepted commit, missing provenance and escaping file paths', async t => {
  const { root, manifest } = await fixture(t)
  await assert.rejects(verifyRendererSource(root, manifest, 'b'.repeat(40)), /matching publisher-bound/)
  await assert.rejects(verifyRendererSource(root, { files: ['client'] }, commit), /matching publisher-bound/)
  await assert.rejects(verifyRendererSource(root, { ...manifest, files: ['client', '../private'] }, commit), /safe package source paths/)
  await assert.rejects(verifyRendererSource(root, { ...manifest, files: ['client', 'app/common/../private'] }, commit), /safe package source paths/)
  await assert.rejects(verifyRendererSource(root, { ...manifest, files: ['client', 'client'] }, commit), /matching publisher-bound/)
})
