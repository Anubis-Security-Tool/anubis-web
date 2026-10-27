import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceInstallPlan, installSource, sourceRoot } from '../../scripts/install-source.js'
import { configureManagedInstallation } from '../../scripts/configure-managed.js'
import { gzipSync } from 'node:zlib'

const quiet = { info () {} }

test('source install is root-location independent, locked and does not start or enroll a server', () => {
  const root = resolve(tmpdir(), 'anubis source with spaces')
  const plan = sourceInstallPlan({ root, platform: 'linux', env: {}, nodeVersion: '24.0.0' })
  assert.equal(plan.length, 5)
  assert.deepEqual(plan[0].args, [
    'ci', '--include=dev', '--legacy-peer-deps', '--no-audit', '--no-fund',
    '--registry=https://npm.anubis.locker/'
  ])
  assert.deepEqual(plan[1].args, [resolve(root, 'scripts/install-source.js'), '--check-dependencies'])
  assert.deepEqual(plan[2].args, ['run', 'build'])
  assert.deepEqual(plan[3].args, [resolve(root, 'npm/anubis-web.js'), '--check'])
  assert.deepEqual(plan[4].args, [resolve(root, 'scripts/configure-managed.js')])
  for (const step of plan) {
    assert.equal(step.cwd, root)
    assert.equal(step.env.ANUBIS_WEB_HOME, root)
    assert.equal(step.env.ANUBIS_MANAGED_ACCESS, undefined)
    assert.equal(step.args.some(arg => ['start', 'managed', 'prod', '--init'].includes(arg)), false)
  }
})

test('Windows uses Node and npm-cli directly without a command shell or interpolated arguments', () => {
  const root = resolve(tmpdir(), 'Anubis & source')
  const npmCli = fileURLToPath(new URL(import.meta.url))
  const plan = sourceInstallPlan({
    root, platform: 'win32', nodeVersion: '24.12.0', env: { npm_execpath: npmCli }
  })
  assert.equal(plan[0].command, process.execPath)
  assert.equal(plan[0].args[0], npmCli)
  let count = 0
  installSource({
    root,
    platform: 'win32',
    nodeVersion: '24.12.0',
    env: { npm_execpath: npmCli },
    log: quiet,
    run (command, args, options) {
      count++
      assert.equal(options.shell, undefined)
      assert.equal(options.cwd, root)
      assert.ok(Array.isArray(args))
    }
  })
  assert.equal(count, 5)
})

test('installation errors stop immediately before later build, check or configuration stages', () => {
  for (let failure = 0; failure < 5; failure++) {
    let count = 0
    assert.throws(() => installSource({
      platform: 'linux',
      nodeVersion: '24.0.0',
      env: {},
      log: quiet,
      run () {
        if (count++ === failure) throw new Error('fixture-stage-failed')
      }
    }), /fixture-stage-failed/)
    assert.equal(count, failure + 1)
  }
})

test('Node preflight and unsupported arguments fail before launching npm', () => {
  assert.throws(() => sourceInstallPlan({ nodeVersion: '22.20.0' }), /Node.js 24\+/)
  assert.throws(() => sourceInstallPlan({ args: ['--disable-auth'] }), /Unknown source installer option/)
  assert.deepEqual(sourceInstallPlan({ args: ['--help'], nodeVersion: '22.0.0' }), [])
})

test('standalone installer environment generates strong private settings and preserves existing settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'anubis-source-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await copyFile(resolve(sourceRoot, '.sample.env'), join(root, '.sample.env'))
  const plan = sourceInstallPlan({
    root, platform: 'linux', env: {}, nodeVersion: '24.0.0', args: ['--standalone']
  })
  await configureManagedInstallation({ directory: root, env: plan[4].env, log: quiet })
  const original = await readFile(join(root, '.env'), 'utf8')
  assert.match(original, /^ANUBIS_MANAGED_ACCESS=0$/m)
  assert.match(original, /^ENABLE_AUTH=1$/m)
  assert.match(original, /^HOST=127\.0\.0\.1$/m)
  assert.match(original, /^SERVER_SECRET=[a-f0-9]{64}$/m)
  assert.match(original, /^SERVER_PASS=[A-Za-z0-9_-]{32}$/m)
  await configureManagedInstallation({ directory: root, env: {}, log: quiet })
  assert.equal(await readFile(join(root, '.env'), 'utf8'), original)
})

test('actual help invocation works from an unrelated working directory without installed dependencies', () => {
  const help = execFileSync(process.execPath, [resolve(sourceRoot, 'scripts/install-source.js'), '--help'], {
    cwd: tmpdir(), encoding: 'utf8'
  })
  assert.match(help, /Usage: node scripts\/install-source\.js/)
  assert.match(help, /No server is started/)
})

function packedManifest (manifest, { type = '0', duplicate = false, corrupt = false } = {}) {
  const contents = Buffer.from(JSON.stringify(manifest))
  const header = Buffer.alloc(512)
  header.write('package/package.json')
  header.write(contents.length.toString(8).padStart(11, '0') + '\0', 124)
  header.fill(32, 148, 156)
  header.write(type, 156)
  header.write('ustar\0', 257)
  const sum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  if (corrupt) header[0]++
  const entry = Buffer.concat([header, contents, Buffer.alloc((512 - contents.length % 512) % 512)])
  return gzipSync(Buffer.concat([entry, ...(duplicate ? [entry] : []), Buffer.alloc(1024)]))
}

test('explicit local source tarballs require exact names/versions and do not rewrite lock or manifest', async t => {
  const root = await mkdtemp(join(tmpdir(), 'anubis-local-packages-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = {
    devDependencies: { '@ai-security-tool/electerm-react': '5.7.4', '@ai-security-tool/resource': '2.2.3' },
    dependencies: { '@ai-security-tool/managed-access': '1.0.4' }
  }
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'package-lock.json'), 'preserved-lock')
  const renderer = join(root, 'renderer source & package.tgz')
  const sdk = join(root, 'sdk.tgz')
  const resource = join(root, 'resource.tgz')
  await writeFile(renderer, packedManifest({ name: '@ai-security-tool/electerm-react', version: '5.7.4' }))
  await writeFile(sdk, packedManifest({ name: '@ai-security-tool/managed-access', version: '1.0.4' }))
  await writeFile(resource, packedManifest({ name: '@ai-security-tool/resource', version: '2.2.3' }))
  const plan = sourceInstallPlan({
    root,
    env: {},
    nodeVersion: '24.0.0',
    platform: 'linux',
    args: ['--renderer-package', renderer, '--sdk-package', sdk, '--resource-package', resource, '--standalone']
  })
  assert.equal(plan[0].args[0], 'install')
  assert.ok(plan[0].args.includes('--no-save'))
  assert.ok(plan[0].args.includes('--package-lock=false'))
  assert.ok(plan[0].args.includes('--registry=https://npm.anubis.locker/'))
  assert.deepEqual(plan[0].args.slice(-3), [renderer, sdk, resource])
  assert.equal(plan[4].env.ANUBIS_MANAGED_ACCESS, '0')
  assert.equal(await readFile(join(root, 'package-lock.json'), 'utf8'), 'preserved-lock')
  assert.deepEqual(JSON.parse(await readFile(join(root, 'package.json'))), manifest)
})

test('local source package inputs reject remote URLs, wrong identities, corrupt or duplicate manifests', async t => {
  const root = await mkdtemp(join(tmpdir(), 'anubis-local-package-reject-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    dependencies: { '@ai-security-tool/managed-access': '1.0.4' }
  }))
  const filename = join(root, 'sdk.tgz')
  const plan = args => sourceInstallPlan({ root, env: {}, nodeVersion: '24.0.0', args })
  for (const args of [
    ['--sdk-package'], ['--sdk-package', '--standalone'],
    ['--sdk-package', 'https://npm.anubis.locker/sdk.tgz'],
    ['--sdk-package', 'not-an-archive.json'],
    ['--standalone', '--standalone']
  ]) assert.throws(() => plan(args))
  for (const [manifest, options, pattern] of [
    [{ name: 'wrong', version: '1.0.4' }, {}, /must match/],
    [{ name: '@ai-security-tool/managed-access', version: '1.0.3' }, {}, /must match/],
    [{ name: '@ai-security-tool/managed-access', version: '1.0.4' }, { corrupt: true }, /Invalid source package TAR/],
    [{ name: '@ai-security-tool/managed-access', version: '1.0.4' }, { duplicate: true }, /exactly one/],
    [{ name: '@ai-security-tool/managed-access', version: '1.0.4' }, { type: '2' }, /regular/]
  ]) {
    await writeFile(filename, packedManifest(manifest, options))
    assert.throws(() => plan(['--sdk-package', filename]), pattern)
  }
})

test('installer accepts an actual npm-packed source tarball without installing dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'anubis-real-source-pack-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const producer = join(root, 'producer')
  await mkdir(producer)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    dependencies: { '@ai-security-tool/managed-access': '1.0.4' }
  }))
  await writeFile(join(producer, 'package.json'), JSON.stringify({
    name: '@ai-security-tool/managed-access', version: '1.0.4', files: ['index.js']
  }))
  await writeFile(join(producer, 'index.js'), 'module.exports = {}\n')
  const npm = sourceInstallPlan({ root })[0]
  const prefix = npm.command === process.execPath ? [npm.args[0]] : []
  const packed = JSON.parse(execFileSync(npm.command, [
    ...prefix, 'pack', producer, '--ignore-scripts', '--offline', '--json',
    '--cache', join(root, 'npm-cache'), '--pack-destination', root
  ], { cwd: root, encoding: 'utf8' }))
  const filename = join(root, packed[0].filename)
  const plan = sourceInstallPlan({ root, args: ['--sdk-package', filename] })
  assert.equal(plan[0].args.at(-1), filename)
  assert.ok(plan[0].args.includes('--no-save'))
})
