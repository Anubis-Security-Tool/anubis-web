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

export function selectLicenseAlternative (expression, notices) {
  if (typeof expression !== 'string' || !/GPL|MPL/.test(expression)) return null
  const grants = {
    MIT: /Copyright[\s\S]+Permission is hereby granted[\s\S]+copyright notice and this permission notice[\s\S]+THE SOFTWARE IS PROVIDED[\s\S]+IN NO EVENT SHALL/i,
    'BSD-3-Clause': /Copyright[\s\S]+Redistribution and use in source and binary forms[\s\S]+Redistributions of source code must retain[\s\S]+Redistributions in binary form must reproduce[\s\S]+Neither the name[\s\S]+endorse or promote[\s\S]+THIS SOFTWARE IS PROVIDED[\s\S]+IN NO EVENT SHALL/i
  }
  const tokens = expression.match(/[()]|[A-Za-z0-9][A-Za-z0-9.+:-]*/g) || []
  const invalid = () => { throw new Error('Invalid SPDX license expression') }
  if (tokens.join('') !== expression.replace(/\s/g, '')) invalid()
  let position = 0
  const identifier = () => {
    const token = tokens[position++]
    if (!token || ['(', ')', 'AND', 'OR', 'WITH'].includes(token)) invalid()
    return token
  }
  function atom () {
    if (tokens[position] === '(') {
      position++
      const result = alternatives()
      if (tokens[position++] !== ')') invalid()
      return result
    }
    const license = identifier()
    if (tokens[position] === 'WITH') {
      position++
      identifier()
      return null
    }
    const notice = Object.hasOwn(grants, license) && notices.find(item => grants[license].test(item.bytes.toString('utf8')))
    return notice ? [{ license, notice: notice.file }] : null
  }
  function conjunction () {
    let result = atom()
    while (tokens[position] === 'AND') {
      position++
      const next = atom()
      result = result && next ? [...result, ...next] : null
    }
    return result
  }
  function alternatives () {
    let result = conjunction()
    while (tokens[position] === 'OR') {
      position++
      const next = conjunction()
      if (!result) result = next
    }
    return result
  }
  const result = alternatives()
  if (position !== tokens.length) invalid()
  return result && [...new Map(result.map(item => [item.license, item])).values()].sort((a, b) => a.license.localeCompare(b.license))
}

export async function verifyThirdPartyNotices (directory, { requireCompliance = false } = {}) {
  const index = JSON.parse(await readFile(resolve(directory, 'index.json'), 'utf8'))
  if (index.format !== 1 || !Array.isArray(index.packages) || !index.packages.length ||
      !index.files || typeof index.files !== 'object') {
    throw new Error('Invalid third-party notice inventory')
  }
  if (requireCompliance && (index.compliance?.name !== '@ai-security-tool/third-party-compliance' ||
      index.compliance.version !== '1.0.1' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(index.compliance.integrity) ||
      !index.files[index.compliance.manifest])) {
    throw new Error('The exact verified original compliance capsule is required')
  }
  const originals = new Map()
  for (const [name, hash] of Object.entries(index.files)) {
    const capsulePath = name.startsWith('compliance/') && isNoticePath(name)
    if ((!/^(NOTICE-[a-f0-9]{64}\.txt|PACKAGE-[a-f0-9]{64}\.json)$/.test(name) && !capsulePath) ||
        !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Unsafe third-party notice inventory entry')
    const bytes = await readFile(resolve(directory, name))
    if (createHash('sha256').update(bytes).digest('hex') !== hash) {
      throw new Error(`Third-party notice checksum mismatch: ${name}`)
    }
    originals.set(name, bytes)
  }
  const files = await treeManifest(directory)
  delete files['index.json']
  if (JSON.stringify(files) !== JSON.stringify(Object.fromEntries(Object.entries(index.files).sort()))) {
    throw new Error('Third-party notice file list is incomplete')
  }
  let bundled
  const recordBundle = bytes => {
    const evidence = JSON.parse(bytes.toString('utf8'))
    if (evidence.format !== 1 || !Array.isArray(evidence.packages) ||
        evidence.packages.some(path => !index.packages.some(item => item.path === path)) ||
        new Set(evidence.packages).size !== evidence.packages.length) {
      throw new Error('Invalid compiled browser dependency evidence')
    }
    if (!bundled) bundled = new Set()
    for (const path of evidence.packages) bundled.add(path)
  }
  if (index.bundleDependencies) {
    if (!index.files[index.bundleDependencies]) throw new Error('Compiled browser dependency evidence is missing')
    const bytes = await readFile(resolve(directory, index.bundleDependencies))
    if (!bytes.equals(await readFile(resolve(directory, '..', 'browser-dependencies.json')))) {
      throw new Error('Compiled browser dependency evidence differs from the original asset')
    }
    recordBundle(bytes)
  } else if (requireCompliance) {
    throw new Error('Compiled browser dependency evidence is required')
  }
  if (index.additionalBundleDependencies !== undefined) {
    if (!bundled || !Array.isArray(index.additionalBundleDependencies)) throw new Error('Invalid additional bundle evidence')
    for (const file of index.additionalBundleDependencies) {
      if (typeof file !== 'string' || !index.files[file]) throw new Error('Additional bundle evidence is missing')
      recordBundle(await readFile(resolve(directory, file)))
    }
  }
  for (const item of index.packages) {
    if (bundled && item.bundled !== bundled.has(item.path)) {
      throw new Error('Compiled browser dependency coverage differs from the original build evidence')
    }
    if (requireCompliance && typeof item.runtime !== 'boolean') {
      throw new Error('Original runtime dependency classification is missing')
    }
  }
  const catalogOnly = item => bundled !== undefined && item.runtime === false && item.bundled === false
  const missing = index.packages.filter(item => !item.complete && !catalogOnly(item))
  if (missing.length) {
    throw new Error('Unresolved original third-party licenses: ' +
      missing.map(item => `${item.path}@${item.version} (${item.coverage})`).join(', '))
  }
  for (const item of [index.root, ...index.packages]) {
    if (!item || !Array.isArray(item.notices) || (!catalogOnly(item) && !item.notices.length) ||
        item.notices.some(notice => !index.files[notice.file])) {
      throw new Error('Third-party notice source has no preserved original')
    }
    if (item !== index.root && !index.files[item.packageJson]) {
      throw new Error('Third-party package metadata is missing')
    }
    if (item.sourceArchives?.some(path => !index.files[path])) {
      throw new Error('Original third-party preferred source is missing')
    }
    if (item.sharedUpstream && (!index.files[item.sharedUpstream.originalNotice] ||
        !index.files[item.sharedUpstream.registryIdentityProof])) {
      throw new Error('Shared upstream original notice provenance is missing')
    }
    if (requireCompliance && (item.runtime || item.bundled) && /GPL|MPL/.test(item.license || '') && !item.sourceArchives?.length) {
      const selection = selectLicenseAlternative(item.license, item.notices.map(notice => ({
        file: notice.file, bytes: originals.get(notice.file)
      })))
      if (!selection) throw new Error(`Original third-party preferred source is required: ${item.name}`)
      if (JSON.stringify(item.licenseSelection) !== JSON.stringify(selection)) {
        throw new Error(`Original permissive license selection proof is missing or contradictory: ${item.name}`)
      }
    }
  }
  return index
}
