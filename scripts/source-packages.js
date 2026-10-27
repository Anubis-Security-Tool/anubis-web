import { readFileSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const names = {
  '--renderer-package': '@ai-security-tool/electerm-react',
  '--sdk-package': '@ai-security-tool/managed-access',
  '--resource-package': '@ai-security-tool/resource'
}

function packageManifest (filename) {
  const stat = lstatSync(filename)
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) {
    throw new Error('Source package must be a regular local tarball no larger than 32 MiB')
  }
  const archive = gunzipSync(readFileSync(filename), { maxOutputLength: 128 * 1024 * 1024 })
  let manifest
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, '').trim()
    const size = parseInt(text(124, 136), 8)
    const checksum = parseInt(text(148, 156), 8)
    const sum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    if (!Number.isSafeInteger(size) || size < 0 || checksum !== sum || offset + 512 + size > archive.length) {
      throw new Error('Invalid source package TAR header')
    }
    const prefix = text(345, 500)
    const name = (prefix ? prefix + '/' : '') + text(0, 100)
    if (name === 'package/package.json') {
      if (manifest || size > 1024 * 1024 || ![0, 48].includes(header[156])) {
        throw new Error('Source package must contain exactly one regular package/package.json')
      }
      manifest = JSON.parse(archive.subarray(offset + 512, offset + 512 + size).toString())
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (!manifest || typeof manifest !== 'object') throw new Error('Source package has no package/package.json')
  return manifest
}

export function sourcePackageOptions (args, root) {
  const packages = []
  const flags = new Set()
  for (let index = 0; index < args.length; index++) {
    const option = args[index]
    if (flags.has(option)) throw new Error('Duplicate source installer option')
    flags.add(option)
    if (['--standalone', '--help'].includes(option)) continue
    if (!names[option]) throw new Error('Unknown source installer option; use --help')
    const value = args[++index]
    if (!value || value.startsWith('--') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || !/\.(tgz|tar\.gz)$/i.test(value)) {
      throw new Error('Source package option requires an existing local .tgz or .tar.gz path')
    }
    const filename = resolve(value)
    const manifest = packageManifest(filename)
    const expected = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const version = expected.dependencies?.[names[option]] || expected.devDependencies?.[names[option]]
    if (manifest.name !== names[option] || manifest.version !== version) {
      throw new Error(`Source package must match ${names[option]}@${version}`)
    }
    packages.push(filename)
  }
  return { packages, standalone: flags.has('--standalone'), help: flags.has('--help') }
}

export function checkSourceDependencies (root) {
  const expected = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  for (const name of Object.values(names)) {
    const actual = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'))
    const version = expected.dependencies?.[name] || expected.devDependencies?.[name]
    if (actual.name !== name || actual.version !== version) {
      throw new Error(`Installed source dependency must match ${name}@${version}`)
    }
  }
}
