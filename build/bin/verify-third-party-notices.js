import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { treeManifest } from '../../src/app/common/asset-manifest.js'

export function noticesRequired (version) {
  const [major, minor, patch] = version.split('.').map(Number)
  return major > 5 || (major === 5 && (minor > 7 || (minor === 7 && patch >= 6)))
}

export function isNoticePath (path) {
  return typeof path === 'string' && !/[\\:<>|?*]/.test(path) &&
    !Array.from(path).some(character => character.charCodeAt(0) < 32) &&
    !path.split('/').some(part => !part || part === '.' || part === '..')
}

export async function verifyThirdPartyNotices (directory, { requireCompliance = false } = {}) {
  const index = JSON.parse(await readFile(resolve(directory, 'index.json'), 'utf8'))
  if (index.format !== 1 || !Array.isArray(index.packages) || !index.packages.length ||
      !index.files || typeof index.files !== 'object') {
    throw new Error('Invalid third-party notice inventory')
  }
  const missing = index.packages.filter(item => !item.complete)
  if (missing.length) {
    throw new Error('Unresolved original third-party licenses: ' +
      missing.map(item => `${item.path}@${item.version} (${item.coverage})`).join(', '))
  }
  if (requireCompliance && (index.compliance?.name !== '@ai-security-tool/third-party-compliance' ||
      index.compliance.version !== '1.0.1' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(index.compliance.integrity) ||
      !index.files[index.compliance.manifest])) {
    throw new Error('The exact verified original compliance capsule is required')
  }
  for (const [name, hash] of Object.entries(index.files)) {
    const capsulePath = name.startsWith('compliance/') && isNoticePath(name)
    if ((!/^(NOTICE-[a-f0-9]{64}\.txt|PACKAGE-[a-f0-9]{64}\.json)$/.test(name) && !capsulePath) ||
        !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Unsafe third-party notice inventory entry')
    const bytes = await readFile(resolve(directory, name))
    if (createHash('sha256').update(bytes).digest('hex') !== hash) {
      throw new Error(`Third-party notice checksum mismatch: ${name}`)
    }
  }
  const files = await treeManifest(directory)
  delete files['index.json']
  if (JSON.stringify(files) !== JSON.stringify(Object.fromEntries(Object.entries(index.files).sort()))) {
    throw new Error('Third-party notice file list is incomplete')
  }
  for (const item of [index.root, ...index.packages]) {
    if (!item || !Array.isArray(item.notices) || !item.notices.length ||
        item.notices.some(notice => !index.files[notice.file])) {
      throw new Error('Third-party notice source has no preserved original')
    }
    if (item !== index.root && !index.files[item.packageJson]) {
      throw new Error('Third-party package metadata is missing')
    }
    if (item.sourceArchives?.some(path => !index.files[path])) {
      throw new Error('Original third-party preferred source is missing')
    }
    if (requireCompliance && /GPL|MPL/.test(item.license || '') && !item.sourceArchives?.length) {
      throw new Error(`Original third-party preferred source is required: ${item.name}`)
    }
  }
  return index
}
