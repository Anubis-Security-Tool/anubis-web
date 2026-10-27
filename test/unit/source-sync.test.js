import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { sourceSyncDefaults } from '../../src/app/lib/source-sync.js'

const syncEnv = {
  ANUBIS_SYNC_URL: 'http://127.0.0.1:5678/api/sync',
  ANUBIS_SYNC_USER: 'source-fixture-user',
  ANUBIS_SYNC_JWT_SECRET: '0123456789abcdef'.repeat(4)
}

test('new-profile sync mapping is explicit, loopback-only and requires complete strong configuration', () => {
  assert.equal(sourceSyncDefaults({}), null)
  assert.deepEqual(sourceSyncDefaults(syncEnv), {
    customApiUrl: syncEnv.ANUBIS_SYNC_URL,
    customAccessToken: syncEnv.ANUBIS_SYNC_JWT_SECRET,
    customGistId: syncEnv.ANUBIS_SYNC_USER
  })
  for (const patch of [
    { ANUBIS_SYNC_USER: undefined },
    { ANUBIS_SYNC_JWT_SECRET: 'weak' },
    { ANUBIS_SYNC_JWT_SECRET: 'x'.repeat(64) },
    { ANUBIS_SYNC_USER: 'id####injection' },
    { ANUBIS_SYNC_URL: 'http://outside.example.test/api/sync' },
    { ANUBIS_SYNC_URL: 'http://user:password@127.0.0.1:5678/api/sync' },
    { ANUBIS_SYNC_URL: 'http://127.0.0.1:5678/api/sync?token=forbidden' }
  ]) assert.throws(() => sourceSyncDefaults({ ...syncEnv, ...patch }))
})

async function fixture (t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anubis-source-sync-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sqlite = new URL('../../src/app/db/sqlite/index.js', import.meta.url).href
  return (script, env = {}) => {
    const childEnv = { ...process.env }
    for (const key of Object.keys(syncEnv)) delete childEnv[key]
    return execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      const { createDb } = await import(${JSON.stringify(sqlite)})
      const db = createDb()
      try { ${script} } finally { db.close() }
    `], {
      cwd: root,
      env: { ...childEnv, ...env, DB_PATH: root, DB_TYPE: 'sqlite' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }
}

test('actual new SQLite profile persists sync defaults once; restart and changed env preserve saved values', async t => {
  const run = await fixture(t)
  run(`
    const config = await db.dbAction('data', 'findOne', {_id:'userConfig'})
    assert.equal(config.syncSetting.customApiUrl, process.env.ANUBIS_SYNC_URL)
    assert.equal(config.syncSetting.customGistId, process.env.ANUBIS_SYNC_USER)
    assert.equal(config.syncSetting.customAccessToken, process.env.ANUBIS_SYNC_JWT_SECRET)
    assert.equal(config.syncSetting.customSyncPassword, undefined)
    assert.equal(config.syncSetting.autoSync, true)
  `, syncEnv)
  run(`
    const config = await db.dbAction('data', 'findOne', {_id:'userConfig'})
    assert.equal(config.syncSetting.customGistId, 'source-fixture-user')
    assert.notEqual(config.syncSetting.customGistId, process.env.ANUBIS_SYNC_USER)
  `, { ...syncEnv, ANUBIS_SYNC_USER: 'different-user' })
})

test('existing SQLite profile without a userConfig is not seeded later; absent env creates no sync config', async t => {
  const run = await fixture(t)
  run('assert.equal(await db.dbAction(\'data\', \'findOne\', {_id:\'userConfig\'}), null)')
  run('assert.equal(await db.dbAction(\'data\', \'findOne\', {_id:\'userConfig\'}), null)', syncEnv)
  run(`
    await db.dbAction('data', 'insert', {_id:'userConfig',syncSetting:{customApiUrl:'https://existing.example.test/api/sync',customGistId:'owner'}})
  `)
  run(`
    const config = await db.dbAction('data', 'findOne', {_id:'userConfig'})
    assert.deepEqual(config.syncSetting, {customApiUrl:'https://existing.example.test/api/sync',customGistId:'owner'})
  `, { ANUBIS_SYNC_URL: 'invalid-partial-env' })
})

test('invalid new-profile configuration fails before database creation and can be corrected without resetting data', async t => {
  const run = await fixture(t)
  assert.throws(() => run('', { ANUBIS_SYNC_URL: syncEnv.ANUBIS_SYNC_URL }), /New-profile local sync requires/)
  run('assert.equal((await db.dbAction("data", "findOne", {_id:"userConfig"})).syncSetting.customGistId, process.env.ANUBIS_SYNC_USER)', syncEnv)
})
