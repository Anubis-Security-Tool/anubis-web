import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { list } from 'tar'
import { isNoticePath } from './verify-third-party-notices.js'

export async function verifyAssetArchive ({ file, prefix, files }) {
  const expected = new Map(Object.entries(files).map(([name, hash]) => [`package/${prefix}/${name}`, hash]))
  const observed = new Set()
  const seen = new Set()
  const errors = []
  await list({
    file,
    strict: true,
    onReadEntry (entry) {
      const name = entry.path.replace(/\/$/, '')
      if (!isNoticePath(name) || (name !== 'package' && !name.startsWith('package/')) ||
          !['File', 'Directory'].includes(entry.type) || seen.has(name)) {
        errors.push(`Unsafe or duplicate package archive entry: ${entry.path}`)
        entry.resume()
        return
      }
      seen.add(name)
      if (name.startsWith('package/node_modules/') || /\.node$/i.test(name)) {
        errors.push(`Build-time native modules must not be copied into browser/Web release archives: ${name}`)
      }
      if (entry.type === 'Directory' || !name.startsWith(`package/${prefix}/`)) {
        entry.resume()
        return
      }
      if (!expected.has(name)) errors.push(`Unrecorded packed asset: ${name}`)
      const hash = createHash('sha256')
      entry.on('data', chunk => hash.update(chunk))
      entry.on('end', () => {
        if (hash.digest('hex') !== expected.get(name)) errors.push(`Packed asset checksum mismatch: ${name}`)
        observed.add(name)
      })
    }
  })
  for (const name of expected.keys()) {
    if (!observed.has(name)) errors.push(`Original asset/notice omitted from actual archive: ${name}`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
  return { file, verifiedAssets: observed.size }
}

export async function verifyReleaseArchives (root = process.cwd()) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const version = manifest.version
  const web = JSON.parse(await readFile(resolve(root, 'dist/asset-manifest.json'), 'utf8'))
  const browser = JSON.parse(await readFile(resolve(root, `dist/browser-assets-package-${version}/source.json`), 'utf8'))
  if (web.assets.treeSha256 !== browser.assets.treeSha256 || web.assets.count !== browser.assets.count ||
      JSON.stringify(web.assets.files) !== JSON.stringify(browser.assets.files)) {
    throw new Error('Packed Web and browser assets must preserve the identical renderer and original notices')
  }
  const reports = []
  for (const [filename, prefix] of [
    [`anubis-web-${version}.tgz`, 'dist/assets'],
    [`ai-security-tool-anubis-browser-assets-${version}.tgz`, 'assets']
  ]) {
    reports.push(await verifyAssetArchive({
      file: resolve(root, 'release-artifacts', filename),
      prefix,
      files: web.assets.files
    }))
  }
  return reports
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyReleaseArchives(), null, 2))
}
