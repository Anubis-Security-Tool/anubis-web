import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { startManagedAccess } from '../../src/app/lib/managed-access.js'

const require = createRequire(import.meta.url)
const appRoot = process.env.ANUBIS_WEB_APP_ROOT || fileURLToPath(new URL('../../', import.meta.url))
const appModule = (...parts) => import(pathToFileURL(join(appRoot, 'src', 'app', ...parts)).href)

async function waitFor (predicate) {
  const deadline = Date.now() + 10000
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Managed Web condition timed out')
    await delay(20)
  }
}

test('published gateway requires approval and operator session before independent Web login', { timeout: 90000 }, async t => {
  const moduleName = process.env.ANUBIS_MANAGED_CLIENT_MODULE || '@ai-security-tool/managed-access'
  const { createAgent } = require(moduleName)
  const sdkRequire = createRequire(require.resolve(moduleName))
  const { createGateway } = sdkRequire('./server')
  const { WebSocket } = sdkRequire('ws')
  const directory = await mkdtemp(join(tmpdir(), 'anubis-web-managed-'))
  const previous = { ...process.env }
  const adminSecret = randomBytes(32).toString('hex')
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DB_PATH: join(directory, 'web'),
    DB_TYPE: 'sqlite',
    SERVER_USER: 'managed-fixture-user',
    SERVER_SECRET: randomBytes(32).toString('hex'),
    SERVER_PASS: randomBytes(24).toString('hex'),
    ENABLE_AUTH: '1'
  })
  let access = null
  let local = null
  let browser = null
  let agent = null
  let mcpInstance = null
  let stopMcp = null
  let mcpGrant = null
  const managedLocalAuth = randomBytes(32).toString('hex')
  const states = []
  const browserSockets = new Set()
  const localSockets = new Set()
  const gatewaySockets = new Set()
  const managedGateway = createGateway({
    dataDir: join(directory, 'gateway'),
    domain: 'localhost',
    isAdmin: req => req.headers.authorization === `Bearer ${adminSecret}`,
    channelTimeout: 3000
  })
  const gateway = http.createServer(async (req, res) => {
    if (!await managedGateway.handle(req, res)) {
      res.writeHead(404)
      res.end()
    }
  })
  gateway.on('upgrade', managedGateway.upgrade)
  gateway.on('connection', socket => {
    gatewaySockets.add(socket)
    socket.on('close', () => gatewaySockets.delete(socket))
  })
  t.after(async () => {
    if (mcpInstance) await stopMcp(mcpInstance.instanceId)
    await browser?.close()
    for (const socket of browserSockets) socket.terminate()
    await access?.stop()
    await managedGateway.close()
    for (const socket of gatewaySockets) socket.destroy()
    await new Promise(resolve => gateway.close(resolve))
    if (local) {
      for (const socket of localSockets) socket.destroy()
      local.closeAllConnections()
      await new Promise(resolve => local.close(resolve))
    }
    const { default: globalState } = await appModule('server', 'global-state.js')
    for (const session of Object.values(globalState.data)) {
      if (typeof session.kill === 'function') session.kill()
    }
    const { loadDb } = await appModule('db', 'index.js')
    const db = await loadDb({})
    db.close()
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key]
    }
    Object.assign(process.env, previous)
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    await delay(50)
    t.diagnostic(JSON.stringify({
      remainingSessions: Object.keys(globalState.data).length,
      resources: process.getActiveResourcesInfo(),
      handles: process._getActiveHandles().map(handle => ({
        type: handle.constructor.name,
        fd: handle._handle?.fd,
        listening: handle.listening,
        localPort: handle.localPort,
        remotePort: handle.remotePort
      })),
      nativeHandles: process.report.getReport().libuv.filter(handle => handle.is_active && handle.is_referenced)
        .map(handle => ({ type: handle.type, fd: handle.fd, pid: handle.pid }))
    }))
  })
  const { createApp } = await appModule('server', 'server.js')
  const app = await createApp({ managedLocalAuth })
  local = app.listen(0, '127.0.0.1')
  local.on('connection', socket => {
    localSockets.add(socket)
    socket.on('close', () => localSockets.delete(socket))
  })
  gateway.listen(0, '127.0.0.1')
  await Promise.all([once(local, 'listening'), once(gateway, 'listening')])
  const base = `http://127.0.0.1:${gateway.address().port}`
  const identityFile = join(directory, 'installation.json')
  access = await startManagedAccess({
    server: local,
    env: {
      ...process.env,
      SERVER: '',
      CDN: '',
      ANUBIS_MANAGED_URL: 'https://api.example.test',
      ANUBIS_INSTALLATION_FILE: identityFile
    },
    version: JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8')).version,
    localAuth: managedLocalAuth,
    createAgent: options => {
      agent = createAgent({ ...options, baseUrl: base, heartbeatMs: 1000, reconnectMs: 100 })
      return agent
    },
    onStatus: state => states.push(state)
  })
  const hostname = `device-${agent.id.replace(/-/g, '')}.localhost`
  async function api (path, method = 'GET', admin = true) {
    return fetch(base + path, {
      method,
      headers: admin ? { authorization: `Bearer ${adminSecret}` } : {},
      signal: AbortSignal.timeout(5000)
    })
  }
  async function inventory () {
    return (await (await api('/api/agents')).json()).agents
  }
  function request (path, { cookie, method = 'GET', body, token, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = http.request(base + path, {
        method,
        headers: {
          host: hostname,
          ...(cookie ? { cookie } : {}),
          ...(token ? { token } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers
        }
      }, response => {
        const chunks = []
        response.on('error', reject)
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString()
        }))
      })
      outgoing.on('error', reject)
      outgoing.setTimeout(15000, () => outgoing.destroy(new Error(`Gateway HTTP request timed out: ${body?.method || path}`)))
      outgoing.end(body ? JSON.stringify(body) : undefined)
    })
  }
  function websocket (path, cookie, headers = {}) {
    const socket = new WebSocket(base.replace('http:', 'ws:') + path, {
      headers: { host: hostname, ...(cookie ? { cookie } : {}), ...headers },
      handshakeTimeout: 5000
    })
    browserSockets.add(socket)
    socket.on('close', () => browserSockets.delete(socket))
    socket.on('error', () => {})
    return socket
  }

  await waitFor(() => states.some(state => state.status === 'pending'))
  const saved = JSON.parse(await readFile(identityFile, 'utf8'))
  const pending = (await inventory())[0]
  assert.equal(pending.id, saved.id)
  assert.equal(pending.status, 'pending')
  assert.equal(pending.online, false)
  assert.equal(pending.url, undefined)
  assert.equal(pending.app, 'anubis-web')
  assert.equal(pending.fingerprint, createHash('sha256').update(saved.secret).digest('hex'))
  assert.equal(JSON.stringify(pending).includes(saved.secret), false)
  assert.equal((await api('/api/agents', 'GET', false)).status, 401)
  assert.equal((await api(`/api/agents/${agent.id}/connect`, 'POST')).status, 503)
  assert.equal((await api(`/api/agents/${agent.id}/approve`, 'POST', false)).status, 401)
  assert.equal((await api(`/api/agents/${agent.id}/approve`, 'POST')).status, 200)
  await waitFor(async () => (await inventory())[0].online)

  assert.equal((await request('/')).status, 401)
  const anonymous = websocket('/common/s')
  const [, denied] = await once(anonymous, 'unexpected-response')
  assert.equal(denied.statusCode, 401)
  denied.resume()
  anonymous.terminate()

  const issued = await (await api(`/api/agents/${agent.id}/connect`, 'POST')).json()
  assert.equal(new URL(issued.url).hostname, hostname)
  const exchanged = await request('/_anubis/connect', { method: 'POST', body: { ticket: issued.ticket } })
  assert.equal(exchanged.status, 200)
  assert.match(exchanged.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/)
  const cookie = exchanged.headers['set-cookie'][0].split(';')[0]
  assert.equal((await request('/_anubis/connect', { method: 'POST', body: { ticket: issued.ticket } })).status, 401)
  assert.equal((await request('/api/get-constants', { cookie })).status, 401)
  assert.equal((await request('/api/login', {
    cookie, method: 'POST', body: { password: 'incorrect-fixture-password' }
  })).status, 401)
  const login = await request('/api/login', {
    cookie, method: 'POST', body: { password: process.env.SERVER_PASS }
  })
  assert.equal(login.status, 200)
  assert.equal((await request('/api/get-constants', { cookie, token: login.body })).status, 200)
  assert.equal((await request('/api/get-constants', { token: login.body })).status, 401)
  assert.equal((await request('/mcp', { cookie })).status, 503)
  assert.equal((await fetch(`http://127.0.0.1:${local.address().port}/mcp`, {
    headers: { token: login.body, 'x-anubis-managed-auth': 'spoofed' }
  })).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${local.address().port}/api/get-constants`, {
    headers: { 'x-anubis-managed-auth': managedLocalAuth }
  })).status, 401)

  const invalid = websocket('/common/s?token=invalid-fixture-token', cookie)
  let unauthorizedMessages = 0
  invalid.on('message', () => unauthorizedMessages++)
  await once(invalid, 'open', { signal: AbortSignal.timeout(5000) })
  invalid.send(JSON.stringify({ id: 'invalid-gateway-rpc', action: 'runSync', func: 'getScreenSize' }))
  const socket = websocket(`/common/s?token=${encodeURIComponent(login.body)}`, cookie)
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) })
  const reply = once(socket, 'message', { signal: AbortSignal.timeout(5000) })
  socket.send(JSON.stringify({ id: 'gateway-rpc', action: 'runSync', func: 'getScreenSize' }))
  assert.deepEqual(JSON.parse((await reply)[0].toString()), {
    id: 'gateway-rpc', data: { width: 1920, height: 1080 }
  })
  await delay(200)
  assert.equal(unauthorizedMessages, 0)
  invalid.terminate()

  await t.test('shared browser UI logs in and runs a local terminal through the real gateway', async browserTest => {
    // Chromium treats *.localhost as trustworthy; the real Secure cookie is
    // retained without weakening the production gateway or generating a test CA.
    browser = await chromium.launch({
      args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1', '--no-proxy-server']
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const browserUrl = `http://${hostname}:${gateway.address().port}`
    const initial = await page.goto(browserUrl)
    assert.equal(initial.status(), 401)
    const browserTicket = await (await api(`/api/agents/${agent.id}/connect`, 'POST')).json()
    assert.equal(await page.evaluate(async ticket => {
      const response = await fetch('/_anubis/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket })
      })
      return response.status
    }, browserTicket.ticket), 200)
    const cookies = await page.context().cookies(browserUrl)
    const session = cookies.find(value => value.name === '__Host-anubis-gateway')
    assert.ok(session, 'Browser must accept the actual gateway session cookie')
    assert.equal(session.httpOnly, true)
    assert.equal(session.secure, true)
    assert.equal((await page.reload()).status(), 200)
    await page.locator('input[type="password"]').fill(process.env.SERVER_PASS)
    await page.locator('input[type="password"]').press('Enter')
    await page.waitForFunction(() => window.store?.configLoaded)
    assert.equal(await page.locator('.sidebar').evaluate(node => Math.round(node.getBoundingClientRect().width)), 248)
    await page.evaluate(() => window.store.addTab({ type: 'local', title: 'Gateway terminal', pane: 'terminal' }))
    const input = page.locator('.session-current .xterm-helper-textarea')
    await input.waitFor()
    await page.waitForFunction(platform => {
      const output = document.querySelector('.session-current .xterm-rows')?.innerText || ''
      return platform === 'win32' ? /PS [^\r\n]*>/.test(output) : /[%$#] /.test(output)
    }, process.platform)
    await input.focus()
    await page.keyboard.insertText('node -p "\'ANUBIS_\'+\'GATEWAY_TERMINAL_OK\'"')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() =>
      document.querySelector('.session-current .xterm-rows')?.innerText.includes('ANUBIS_GATEWAY_TERMINAL_OK'))

    await browserTest.test('managed MCP initializes, lists and calls real tools, and streams SSE without exporting local credentials', async () => {
      const { runWidget, stopWidget } = await appModule('widgets', 'load-widget.js')
      stopMcp = stopWidget
      const probe = net.createServer()
      probe.listen(0, '127.0.0.1')
      await once(probe, 'listening')
      const port = probe.address().port
      await new Promise(resolve => probe.close(resolve))
      const localToken = randomBytes(32).toString('hex')
      await page.evaluate(() => window.store.initMcpHandler())
      mcpInstance = await runWidget('mcp-server', { host: '127.0.0.1', port, apiKey: localToken })
      assert.equal((await api(`/api/agents/${agent.id}/mcp-token`, 'POST', false)).status, 401)
      const granted = await api(`/api/agents/${agent.id}/mcp-token`, 'POST')
      assert.equal(granted.status, 200)
      mcpGrant = await granted.json()
      assert.equal(mcpGrant.scope, 'mcp')
      assert.equal(new URL(mcpGrant.url).pathname, '/mcp')
      assert.ok(mcpGrant.expiresAt > Date.now() && mcpGrant.expiresAt <= Date.now() + 3600000)
      assert.notEqual(mcpGrant.token, localToken)
      assert.notEqual(mcpGrant.token, saved.secret)
      const grantHeaders = { authorization: `Bearer ${mcpGrant.token}` }
      assert.equal((await request('/', { headers: grantHeaders })).status, 401)
      assert.equal((await request('/api/get-constants', { headers: grantHeaders })).status, 401)
      assert.equal((await fetch(base + '/api/agents', { headers: grantHeaders })).status, 401)
      assert.equal((await request('/mcp/other', { headers: grantHeaders })).status, 401)
      const forbiddenSocket = websocket('/mcp', undefined, grantHeaders)
      const [, forbiddenUpgrade] = await once(forbiddenSocket, 'unexpected-response')
      assert.equal(forbiddenUpgrade.statusCode, 401)
      forbiddenUpgrade.resume()
      forbiddenSocket.terminate()
      const initialize = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'managed-web-fixture', version: '1' } }
      }
      assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(initialize)
      })).status, 401)
      const call = (body, headers = {}) => request('/mcp?transport=streamable', {
        method: 'POST',
        body,
        headers: { accept: 'application/json, text/event-stream', ...grantHeaders, ...headers }
      })
      const initialized = await call(initialize)
      assert.equal(initialized.status, 200)
      assert.equal(JSON.parse(initialized.body).result.protocolVersion, '2025-11-25')
      const session = initialized.headers['mcp-session-id']
      assert.ok(session)
      const headers = { 'mcp-session-id': session }
      assert.equal((await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, headers)).status, 202)
      const listed = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers)
      assert.equal(listed.status, 200)
      assert.ok(JSON.parse(listed.body).result.tools.some(tool => tool.name === 'list_electerm_tabs'))
      const result = await call({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_electerm_tabs', arguments: {} }
      }, headers)
      assert.equal(result.status, 200)
      assert.match(result.body, /Gateway terminal/)
      for (const response of [initialized, listed, result]) {
        assert.equal(response.body.includes(localToken), false)
        assert.equal(response.body.includes(managedLocalAuth), false)
      }
      await new Promise((resolve, reject) => {
        const stream = http.get(base + '/mcp', {
          headers: { host: hostname, accept: 'text/event-stream', ...grantHeaders, ...headers }
        }, response => {
          try {
            assert.equal(response.statusCode, 200)
            assert.match(response.headers['content-type'], /text\/event-stream/)
          } catch (error) {
            stream.destroy()
            reject(error)
            return
          }
          response.on('error', error => { if (!stream.destroyed) reject(error) })
          response.once('data', chunk => {
            stream.destroy()
            try {
              assert.match(chunk.toString(), /: ping/)
              resolve()
            } catch (error) { reject(error) }
          })
        })
        stream.on('error', reject)
        stream.setTimeout(5000, () => stream.destroy(new Error('Managed SSE did not stream')))
      })
      process.env.MCP_ENABLED = 'false'
      assert.equal((await call(initialize)).status, 404)
      delete process.env.MCP_ENABLED
      assert.equal((await request('/mcp/other', { cookie })).status, 404)
      assert.equal((await request('/mcp', { method: 'DELETE', headers: { ...grantHeaders, ...headers } })).status, 200)
      await stopMcp(mcpInstance.instanceId)
      mcpInstance = null
      assert.equal((await call(initialize)).status, 503)
    })
    await browser.close()
    browser = null
  })

  const revokedSocket = once(socket, 'close', { signal: AbortSignal.timeout(5000) })
  assert.equal((await api(`/api/agents/${agent.id}/revoke`, 'POST')).status, 200)
  await revokedSocket
  assert.equal((await request('/', { cookie })).status, 401)
  assert.equal((await request('/mcp', {
    headers: { authorization: `Bearer ${mcpGrant.token}` }
  })).status, 401)
  await waitFor(() => states.some(state => state.status === 'revoked'))
  assert.equal((await inventory())[0].online, false)
})
