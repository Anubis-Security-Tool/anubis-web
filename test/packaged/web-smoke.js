import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

test('locally built web application authenticates, renders shared UI and executes a terminal command', { timeout: 90000 }, async t => {
  const data = mkdtempSync(join(tmpdir(), 'anubis-web-smoke-'))
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const password = randomBytes(24).toString('hex')
  const server = spawn(process.execPath, ['src/app/app.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DB_PATH: data,
      DB_TYPE: 'sqlite',
      ENABLE_AUTH: '1',
      SERVER_SECRET: randomBytes(32).toString('hex'),
      SERVER_PASS: password
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => { output += chunk })
  }
  let browser = null
  let vnc = null
  t.after(async () => {
    if (browser) await browser.close()
    if (vnc) await vnc.close()
    let forced = false
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit')
      const deadline = setTimeout(() => {
        forced = true
        server.kill('SIGKILL')
      }, 3000)
      deadline.unref()
      try {
        server.kill()
        await exited
      } finally {
        clearTimeout(deadline)
      }
    }
    rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    assert.equal(forced, false, 'Fixture Web server must stop without a forced kill')
  })
  const url = `http://127.0.0.1:${port}`
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Web server exited: ${output}`)
    try {
      const response = await fetch(url)
      assert.equal(response.status, 200, output)
      ready = true
      break
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw error
      await delay(100)
    }
  }
  assert.ok(ready, `Web server did not become ready: ${output}`)
  const denied = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'incorrect-fixture-password' })
  })
  assert.equal(denied.status, 401)
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure().errorText}`))
  await page.goto(url)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('input[type="password"]').press('Enter')
  await page.waitForFunction(() => window.store?.configLoaded)
  const sync = await page.evaluate(() => window.store.config.syncSetting)
  assert.equal(sync.autoSync, true)
  assert.equal(sync.cloudApiUrl, 'https://sync.anubis.locker/api/sync')
  assert.equal(await page.locator('.sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width)), 248)
  await page.locator('.control-icon-wrap[title="Setting"]').click()
  for (const name of ['bookmarks', 'setting', 'terminalThemes', 'quickCommands', 'triggers', 'profiles', 'widgets']) {
    await page.locator(`.setting-tabs [data-node-key="${name}"] [role="tab"]`).click()
    await page.waitForFunction(() => !document.querySelector('.ant-spin-spinning'))
  }
  await page.locator('.close-setting-wrap:visible').first().click()
  await page.evaluate(() => window.store.addTab({ type: 'local', title: 'Web terminal smoke', pane: 'terminal' }))
  await page.locator('.session-current .xterm-helper-textarea').waitFor()
  await page.waitForFunction(platform => {
    const output = document.querySelector('.session-current .xterm-rows')?.innerText || ''
    return platform === 'win32' ? /PS [^\r\n]*>/.test(output) : /[%$#] /.test(output)
  }, process.platform)
  await page.locator('.session-current .xterm-helper-textarea').focus()
  await page.keyboard.insertText('node -p "\'ANUBIS_\'+\'WEB_TERMINAL_OK\'"')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.body.innerText.includes('ANUBIS_WEB_TERMINAL_OK'))
  await t.test('authenticated MCP initialization and tool calls reach the actual browser store', async () => {
    const token = randomBytes(32).toString('hex')
    const listener = net.createServer()
    listener.listen(0, '127.0.0.1')
    await once(listener, 'listening')
    const mcpPort = listener.address().port
    await new Promise(resolve => listener.close(resolve))
    const instance = await page.evaluate(config => window.store.runWidget('mcp-server', config), {
      host: '127.0.0.1',
      port: mcpPort,
      apiKey: token
    })
    assert.ok(instance.instanceId)
    try {
      const call = (body, extra = {}) => fetch(instance.serverInfo.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          ...extra
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      })
      const initialize = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'web-smoke', version: '1' } }
      }
      const denied = await call(initialize, { Authorization: '' })
      assert.equal(denied.status, 401)
      const response = await call(initialize)
      assert.equal(response.status, 200)
      assert.match(await response.text(), /"protocolVersion"/)
      const sessionId = response.headers.get('mcp-session-id')
      assert.ok(sessionId)
      const notification = await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': sessionId })
      assert.equal(notification.status, 202)
      const result = await call({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'list_electerm_tabs', arguments: {} }
      }, { 'mcp-session-id': sessionId })
      assert.equal(result.status, 200)
      assert.match(await result.text(), /Web terminal smoke/)
    } finally {
      await page.evaluate(id => window.store.stopWidget(id), instance.instanceId)
    }
  })
  await t.test('VNC browser framebuffer, keyboard and pointer work through the authenticated wrapper', {
    skip: !process.env.ANUBIS_VNC_FIXTURE_MODULE
  }, async () => {
    const { startTestVncServer } = createRequire(import.meta.url)(process.env.ANUBIS_VNC_FIXTURE_MODULE)
    vnc = await startTestVncServer()
    await page.evaluate(port => window.store.addTab({
      type: 'vnc', host: '127.0.0.1', port, title: 'Web VNC fixture', scaleViewport: false, viewOnly: false
    }), vnc.port)
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.session-current canvas')
      if (!canvas || canvas.width !== 64 || canvas.height !== 48) return false
      const pixel = canvas.getContext('2d').getImageData(10, 10, 1, 1).data
      return pixel[0] === 0 && pixel[1] === 255 && pixel[2] === 0
    })
    await page.locator('.session-current canvas').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('a')
    for (let attempt = 0; attempt < 50 && !vnc.events.keys.some(event => event.down && event.key === 97); attempt++) {
      await delay(100)
    }
    assert.ok(vnc.events.keys.some(event => event.down && event.key === 97))
    assert.ok(vnc.events.pointers.some(event => event.buttons === 1))
    assert.deepEqual(vnc.errors, [])
  })
  assert.deepEqual(errors, [])
  assert.doesNotMatch(output, /\berror [›>]|uncaughtException|unhandledRejection/)
})
