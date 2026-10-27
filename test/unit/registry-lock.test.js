import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownRegistryLock } from '../../build/bin/registry-lock.js'

test('own-registry lock normalization preserves versions and SRI including legacy dependency entries', () => {
  const entry = {
    version: '1.0.0',
    integrity: 'sha512-fixture',
    resolved: 'https://registry.npmmirror.com/example/-/example-1.0.0.tgz'
  }
  const lock = {
    packages: { 'node_modules/example': { ...entry } },
    dependencies: { example: { ...entry, dependencies: { nested: { ...entry } } } }
  }
  ownRegistryLock(lock)
  for (const actual of [lock.packages['node_modules/example'], lock.dependencies.example, lock.dependencies.example.dependencies.nested]) {
    assert.equal(actual.version, entry.version)
    assert.equal(actual.integrity, entry.integrity)
    assert.equal(actual.resolved, 'https://npm.anubis.locker/example/-/example-1.0.0.tgz')
  }
})

test('own-registry lock rejects credentials, arbitrary sources and non-tarball dependency references', () => {
  for (const resolved of [
    'https://outside.example.test/a.tgz',
    'https://user:password@registry.npmjs.org/a.tgz',
    'https://registry.npmjs.org/a.tgz?token=forbidden',
    'http://registry.npmjs.org/a.tgz',
    'file:../local-source'
  ]) assert.throws(() => ownRegistryLock({ resolved }), /unsupported package source/)
})
