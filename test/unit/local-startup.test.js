import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { terminalLocal } from '../../src/app/server/session-local.js'

test('local PTY preserves startup output until the browser stream attaches', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'anubis-local-startup-'))
  const ready = join(directory, 'ready')
  const marker = 'ANUBIS_INITIAL_PTY_OUTPUT_FIXTURE'
  const code = `process.stdout.write('${marker}');require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(function(){},1000)`
  const args = ['-e', code]
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
  const session = await terminalLocal({
    uid: 'local-startup-fixture',
    type: 'local',
    termType: 'local',
    term: 'xterm-256color',
    cols: 200,
    rows: 24,
    execWindows: process.execPath,
    execWindowsArgs: args,
    execLinux: process.execPath,
    execLinuxArgs: args,
    execMac: '/bin/bash',
    execMacArgs: ['--noprofile', '--norc', '-c', `exec ${quote(process.execPath)} -e ${quote(code)}`]
  })
  const exited = new Promise(resolve => session.term.onExit(resolve))
  t.after(async () => {
    session.kill()
    await Promise.race([
      exited,
      delay(3000, undefined, { ref: false }).then(() => { throw new Error('Fixture PTY did not exit') })
    ])
    await rm(directory, { recursive: true, force: true })
  })
  // ConPTY requires its cursor-position handshake even without an xterm client.
  if (process.platform === 'win32') session.write('\x1b[1;1R')
  const deadline = Date.now() + 5000
  while (true) {
    try {
      await access(ready)
      break
    } catch (error) {
      if (error.code !== 'ENOENT' || Date.now() >= deadline) throw error
      await delay(20)
    }
  }
  await delay(100)
  let output = ''
  const consume = chunk => { output += chunk.toString() }
  session.on('data', consume)
  for (let attempt = 0; attempt < 50 && !output.includes(marker); attempt++) await delay(20)
  session.off('data', consume)
  assert.ok(output.includes(marker), 'The browser must receive the output produced before its listener existed')
})
