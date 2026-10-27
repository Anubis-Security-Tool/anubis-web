import { createHash } from 'node:crypto'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function verifyRendererSource (directory, manifest, commit) {
  const binding = manifest.anubisSource
  if (!binding || binding.repository !== 'Anubis-Security-Tool/anubis' ||
      binding.commit !== commit || !/^[a-f0-9]{40}$/.test(commit) ||
      !/^[a-f0-9]{64}$/.test(binding.filesSha256) || !Array.isArray(manifest.files) ||
      !manifest.files.includes('client') || new Set(manifest.files).size !== manifest.files.length) {
    throw new Error('Renderer package must carry matching publisher-bound source provenance')
  }
  const rows = []
  async function visit (name) {
    const filename = resolve(directory, ...name.split('/'))
    const stat = await lstat(filename)
    if (stat.isDirectory()) {
      for (const child of (await readdir(filename)).sort()) await visit(name + '/' + child)
    } else if (stat.isFile()) {
      rows.push({ path: name, sha256: createHash('sha256').update(await readFile(filename)).digest('hex') })
    } else {
      throw new Error('Renderer source provenance does not allow symlinks or special files')
    }
  }
  for (const name of [...manifest.files].sort()) {
    if (typeof name !== 'string' || name.includes('\\') ||
        name.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Renderer provenance requires safe package source paths')
    }
    if (name === 'client' || name.startsWith('app/common/')) await visit(name)
  }
  const actual = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  if (actual !== binding.filesSha256) throw new Error('Published renderer source bytes do not match provenance')
  return binding
}
