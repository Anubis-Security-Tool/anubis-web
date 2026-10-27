import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { Bash } from 'node-bash'
import { fsExport } from '../../src/app/lib/fs.js'

test('local commands use the self-disposing public shell invocation and preserve failures', async t => {
  const calls = []
  const invoke = t.mock.method(Bash, 'invoke', async (...args) => {
    calls.push(args)
    return { stdout: Buffer.from('one-shot result') }
  })
  assert.equal(await fsExport.run('fixture command'), 'one-shot result')
  assert.deepEqual(calls, [['fixture command', { executableOptions: { '--login': true } }]])
  const failure = new Error('one-shot failure')
  invoke.mock.mockImplementation(async () => { throw failure })
  await assert.rejects(fsExport.run('failing fixture command'), error => error === failure)
})

test('real Unix one-shot commands release their child processes on success and failure', {
  skip: process.platform === 'win32',
  timeout: 15000
}, () => {
  const moduleUrl = new URL('../../src/app/lib/fs.js', import.meta.url).href
  const code = `
    import assert from 'node:assert/strict'
    import { once } from 'node:events'
    import { setTimeout as delay } from 'node:timers/promises'
    import { fsExport } from ${JSON.stringify(moduleUrl)}
    const children = () => process._getActiveHandles().filter(handle => handle.constructor.name === 'ChildProcess')
    const baseline = new Set(children())
    const owned = () => children().filter(child => !baseline.has(child) && child.exitCode === null && child.signalCode === null)
    try {
      assert.match(await fsExport.run("printf 'ANUBIS_ONE_SHOT_OK\\\\n'"), /ANUBIS_ONE_SHOT_OK/)
      await assert.rejects(fsExport.run("printf 'ANUBIS_ONE_SHOT_ERROR\\\\n' >&2"), /ANUBIS_ONE_SHOT_ERROR/)
      await delay(50)
      assert.deepEqual(owned().map(child => child.spawnfile), [], 'Every one-shot shell must exit before its helper returns')
      console.log('ONE_SHOT_CHILDREN_CLOSED')
    } finally {
      await Promise.all(owned().map(async child => {
        const exited = once(child, 'exit')
        child.kill()
        await exited
      }))
    }
  `
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    timeout: 10000
  })
  assert.match(output, /ONE_SHOT_CHILDREN_CLOSED/)
})
