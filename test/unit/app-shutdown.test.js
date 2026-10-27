import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createShutdown } from '../../src/app/lib/shutdown.js'

test('standalone shutdown closes the listener, widgets and every terminal', async () => {
  const calls = []
  const shutdown = createShutdown({
    server: { close: () => calls.push('http') },
    stopWidgets: async () => calls.push('widgets'),
    getSessions: () => [
      { kill: () => calls.push('terminal-1') },
      { kill: () => calls.push('terminal-2') }
    ],
    log: { error: assert.fail },
    exit: code => calls.push(code)
  })
  await shutdown()
  assert.deepEqual(calls, ['http', 'widgets', 'terminal-1', 'terminal-2', 0])
})

test('managed shutdown waits for cleanup and repeated signals share one operation', async () => {
  const calls = []
  let finish
  const stopped = new Promise(resolve => { finish = resolve })
  const shutdown = createShutdown({
    server: { close: () => calls.push('http') },
    stopManaged: async () => {
      calls.push('managed')
      await stopped
    },
    stopWidgets: async () => calls.push('widgets'),
    getSessions: () => [],
    log: { error: assert.fail },
    exit: code => calls.push(code)
  })
  const pending = shutdown()
  assert.equal(shutdown(), pending)
  assert.deepEqual(calls, ['http', 'managed', 'widgets'])
  finish()
  await pending
  await shutdown()
  assert.deepEqual(calls, ['http', 'managed', 'widgets', 0])
})

test('shutdown reports failures, attempts remaining resources and exits unsuccessfully', async () => {
  const failure = new Error('device transport refused to stop')
  const calls = []
  const errors = []
  const shutdown = createShutdown({
    server: { close: () => calls.push('http') },
    stopManaged: async () => { throw failure },
    stopWidgets: async () => calls.push('widgets'),
    getSessions: () => [{ kill: () => calls.push('terminal') }],
    log: { error: (...args) => errors.push(args) },
    exit: code => calls.push(code)
  })
  await shutdown()
  assert.deepEqual(calls, ['http', 'widgets', 'terminal', 1])
  assert.equal(errors.length, 1)
  assert.equal(errors[0][1], failure)
})
