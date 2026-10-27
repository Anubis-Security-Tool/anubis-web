import { lstat, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { isNoticePath, verifyThirdPartyNotices } from './verify-third-party-notices.js'
import { treeManifest } from '../../src/app/common/asset-manifest.js'

const complianceName = '@ai-security-tool/third-party-compliance'
const complianceKey = `node_modules/${complianceName}`
const legalName = /^(?:licen[cs]es?|copying|notices?|copyright|authors|contributors|patents|ofl|unlicense|third[-_. ]party(?:[-_. ]notices?)?)(?:$|[._ -])/i
const readmeName = /^readme(?:$|[._ -])/i
const fullLicense = /Permission is hereby granted[\s\S]+THE SOFTWARE IS PROVIDED|Permission to use, copy, modify[\s\S]+THE SOFTWARE IS PROVIDED|Redistribution and use[\s\S]+THIS SOFTWARE IS PROVIDED|SIL OPEN FONT LICENSE[\s\S]+PERMISSION & CONDITIONS[\s\S]+DISCLAIMER|Apache License[\s\S]+TERMS AND CONDITIONS|Mozilla Public License[\s\S]+Definitions|GNU (?:LESSER |AFFERO )?GENERAL PUBLIC LICENSE[\s\S]+TERMS AND CONDITIONS|This is free and unencumbered software released into the public domain[\s\S]+THE SOFTWARE IS PROVIDED|Blue Oak Model License[\s\S]+Purpose[\s\S]+Acceptance|Creative Commons[\s\S]+Attribution 4\.0[\s\S]+Section 8/i
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function safePath (path) {
  if (!isNoticePath(path)) {
    throw new Error('Unsafe original compliance path')
  }
  return path
}

async function loadCompliance (root, lock) {
  const pinned = lock.packages[complianceKey]
  if (!pinned) return null
  const directory = resolve(root, ...complianceKey.split('/'))
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (metadata.name !== complianceName || metadata.version !== pinned.version ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pinned.integrity) ||
      !pinned.resolved.startsWith('https://npm.anubis.locker/')) {
    throw new Error('Compliance capsule must match its exact own-registry lock')
  }
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.packages)) {
    throw new Error('Invalid original compliance capsule manifest')
  }
  const files = await treeManifest(directory)
  const folded = new Set()
  for (const path of Object.keys(files)) {
    if (folded.has(path.toLowerCase())) throw new Error('Case-colliding original compliance paths')
    folded.add(path.toLowerCase())
  }
  const seen = new Set()
  for (const file of manifest.files) {
    safePath(file.path)
    if (file.path === 'manifest.json' || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        files[file.path] !== file.sha256 ||
        (await readFile(resolve(directory, ...file.path.split('/')))).length !== file.bytes) {
      throw new Error(`Compliance original checksum/size mismatch: ${file.path}`)
    }
    seen.add(file.path)
  }
  const identities = new Set()
  for (const item of manifest.packages) {
    const identity = `${item.name}@${item.version}`
    const registryOnly = item.upstream?.commit === null && item.status === 'upstream-declaration-only' &&
      item.sourceArchives?.length && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.registryIntegrity)
    if (identities.has(identity) || !Array.isArray(item.noticeFiles) || !Array.isArray(item.sourceArchives) ||
        (!/^[a-f0-9]{40}$/.test(item.upstream?.commit) && !registryOnly)) throw new Error('Unpinned compliance package provenance')
    if (item.status === 'upstream-declaration-only' && !item.sourceArchives.length) {
      throw new Error('An upstream declaration exception requires the original package source')
    }
    identities.add(identity)
    for (const path of [...item.noticeFiles, ...item.sourceArchives]) {
      if (!seen.has(safePath(path))) throw new Error(`Missing original compliance material: ${identity}`)
    }
  }
  return { directory, manifest, metadata, pinned, files }
}

async function originals (directory, prefix = '', inherited = false, headers = false) {
  const result = []
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const name = prefix + entry.name
    const legal = inherited || (legalName.test(entry.name) && !/\.(svg|png|jpe?g|woff2?|ttf|otf)$/i.test(entry.name))
    if (entry.isDirectory()) {
      result.push(...await originals(join(directory, entry.name), name + '/', legal, headers))
    } else if (entry.isFile() && legal) {
      result.push({ path: name, bytes: await readFile(join(directory, entry.name)) })
    } else if (entry.isFile() && headers && /\.(?:[cm]?js|tsx?|css)$/i.test(entry.name)) {
      const handle = await open(join(directory, entry.name), 'r')
      let head
      try {
        const buffer = Buffer.alloc(8192)
        const { bytesRead } = await handle.read(buffer)
        head = buffer.subarray(0, bytesRead).toString('utf8')
      } finally {
        await handle.close()
      }
      if (/@license|@preserve|Permission is hereby granted|licensed under[\s\S]{0,80}(?:MIT|Apache|GPL|BSD)/i.test(head)) {
        result.push({ path: name, bytes: await readFile(join(directory, entry.name)) })
      }
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Original notice must be a regular file: ${name}`)
    }
  }
  return result
}

export async function inspectPackageNotices (directory) {
  const notices = await originals(directory)
  let coverage = notices.length ? 'original-legal-files' : 'readme-only'
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.isFile() && readmeName.test(entry.name)) {
      notices.push({ path: entry.name, bytes: await readFile(resolve(directory, entry.name)) })
    }
    if (!notices.some(notice => fullLicense.test(notice.bytes.toString('utf8')))) {
      for (const notice of await originals(directory, '', false, true)) {
        if (!notices.some(existing => existing.path === notice.path)) notices.push(notice)
      }
    }
  }
  if (!notices.length) coverage = 'metadata-only'
  return { notices, coverage, complete: notices.some(notice => fullLicense.test(notice.bytes.toString('utf8'))) }
}

export async function collectThirdPartyNotices ({ root, assets, requireCompliance = false }) {
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
  const buffers = new Map()
  const files = {}
  const compliance = await loadCompliance(root, lock)
  if (compliance) {
    for (const [path, hash] of Object.entries(compliance.files)) {
      const filename = 'compliance/' + safePath(path)
      buffers.set(filename, await readFile(resolve(compliance.directory, ...path.split('/'))))
      files[filename] = hash
    }
  }
  const save = (bytes, type) => {
    const hash = sha256(bytes)
    const filename = `${type}-${hash}.${type === 'PACKAGE' ? 'json' : 'txt'}`
    buffers.set(filename, bytes)
    files[filename] = hash
    return filename
  }
  const preserve = notice => ({ path: notice.path, file: save(notice.bytes, 'NOTICE') })
  const rootNotices = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && legalName.test(entry.name)) {
      rootNotices.push({ path: entry.name, bytes: await readFile(resolve(root, entry.name)) })
    }
  }
  if (!rootNotices.length) throw new Error('Original project license is missing')
  rootNotices.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const packages = []
  for (const key of Object.keys(lock.packages).sort()) {
    if (!key || key === complianceKey) continue
    if (!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(key) ||
        key.split('/').some(part => part === '.' || part === '..')) {
      throw new Error(`Unsupported dependency path in notice inventory: ${key}`)
    }
    const directory = resolve(root, ...key.split('/'))
    try {
      const location = await lstat(directory)
      if (!location.isDirectory() || location.isSymbolicLink()) throw new Error(`Dependency notice source must be a regular directory: ${key}`)
    } catch (error) {
      if (error.code === 'ENOENT' && lock.packages[key].optional) continue
      throw error
    }
    let metadata
    try {
      metadata = await readFile(resolve(directory, 'package.json'))
    } catch (error) {
      if (error.code === 'ENOENT' && lock.packages[key].optional) continue
      throw error
    }
    const manifest = JSON.parse(metadata)
    if (['_where', '_args', '_location'].some(key => key in manifest)) {
      throw new Error(`Dependency metadata contains private installation paths: ${key}`)
    }
    if (manifest.version !== lock.packages[key].version) {
      throw new Error(`Installed dependency differs from the notice source lock: ${key}`)
    }
    let { notices, coverage, complete } = await inspectPackageNotices(directory)
    const curated = compliance?.manifest.packages.find(item => item.name === manifest.name && item.version === manifest.version)
    if (curated) {
      if (curated.registryIntegrity !== lock.packages[key].integrity || curated.license !== manifest.license) {
        throw new Error(`Compliance material differs from the accepted package: ${key}`)
      }
      for (const path of curated.noticeFiles) {
        const bytes = buffers.get('compliance/' + path)
        notices.push({
          path,
          bytes,
          capsule: 'compliance/manifest.json',
          file: 'compliance/' + path
        })
      }
      complete = complete || notices.some(notice => fullLicense.test(notice.bytes.toString('utf8')))
      if (curated.status === 'upstream-declaration-only' && curated.sourceArchives.length) complete = true
      coverage = `compliance:${curated.status}`
    }
    packages.push({
      path: key,
      name: manifest.name,
      version: manifest.version,
      license: manifest.license || null,
      resolved: lock.packages[key].resolved || null,
      integrity: lock.packages[key].integrity || null,
      coverage,
      complete,
      packageJson: save(metadata, 'PACKAGE'),
      notices: notices.map(notice => ({
        ...(notice.file ? { path: notice.path, file: notice.file } : preserve(notice)),
        ...(notice.capsule ? { capsule: notice.capsule } : {})
      })),
      ...(curated
        ? {
            upstreamStatus: curated.status,
            upstream: curated.upstream,
            sourceArchives: curated.sourceArchives.map(path => 'compliance/' + path)
          }
        : {})
    })
  }
  const index = {
    format: 1,
    root: { notices: rootNotices.map(preserve) },
    packages,
    ...(compliance
      ? {
          compliance: {
            name: complianceName,
            version: compliance.metadata.version,
            integrity: compliance.pinned.integrity,
            manifest: 'compliance/manifest.json'
          }
        }
      : {}),
    files: Object.fromEntries(Object.entries(files).sort())
  }
  const destination = resolve(assets, 'third-party')
  try {
    const previous = await lstat(destination)
    if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error('Notice output must be an owned directory')
    await rm(destination, { recursive: true })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(destination, { recursive: true })
  for (const [filename, bytes] of [...buffers].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    await mkdir(resolve(destination, ...filename.split('/').slice(0, -1)), { recursive: true })
    await writeFile(resolve(destination, filename), bytes)
  }
  await writeFile(resolve(destination, 'index.json'), JSON.stringify(index, null, 2) + '\n')
  await verifyThirdPartyNotices(destination, { requireCompliance })
  return index
}
