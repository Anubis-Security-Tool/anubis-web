import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sourcePackageOptions, checkSourceDependencies } from './source-packages.js'

export const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
export const sourceRegistry = 'https://npm.anubis.locker/'

export function sourceInstallPlan ({
  args = [],
  root = sourceRoot,
  nodeVersion = process.versions.node,
  env = process.env,
  platform = process.platform,
  node = process.execPath
} = {}) {
  const options = sourcePackageOptions(args, root)
  if (options.help) return []
  if (Number(nodeVersion.split('.')[0]) < 24) {
    throw new Error(`Node.js 24+ is required; found ${nodeVersion}`)
  }
  const npmCli = env.npm_execpath || resolve(dirname(node), 'node_modules/npm/bin/npm-cli.js')
  if (platform === 'win32' && !existsSync(npmCli)) {
    throw new Error('Cannot locate npm-cli.js beside Node.js; install Node.js with npm or run npm run setup-source')
  }
  const npm = platform === 'win32' || env.npm_execpath ? [node, [npmCli]] : ['npm', []]
  const npmStep = args => ({ command: npm[0], args: [...npm[1], ...args] })
  const childEnv = {
    ...env,
    ANUBIS_WEB_HOME: root,
    ...(options.standalone ? { ANUBIS_MANAGED_ACCESS: '0' } : {})
  }
  return [
    npmStep([
      ...(options.packages.length ? ['install', '--no-save', '--package-lock=false', '--install-links'] : ['ci']),
      '--include=dev', '--legacy-peer-deps', '--no-audit', '--no-fund', `--registry=${sourceRegistry}`,
      ...options.packages
    ]),
    { command: node, args: [resolve(root, 'scripts/install-source.js'), '--check-dependencies'] },
    npmStep(['run', 'build']),
    { command: node, args: [resolve(root, 'npm/anubis-web.js'), '--check'] },
    { command: node, args: [resolve(root, 'scripts/configure-managed.js')] }
  ].map(step => ({ ...step, cwd: root, env: childEnv }))
}

export function installSource ({ run = execFileSync, log = console, ...options } = {}) {
  const plan = sourceInstallPlan(options)
  if (!plan.length) {
    log.info('Usage: node scripts/install-source.js [--standalone] [--renderer-package <local.tgz>] [--sdk-package <local.tgz>] [--resource-package <local.tgz>]')
    log.info('Installs locked development/runtime dependencies, builds and checks assets, then initializes private source settings.')
    log.info('No server is started. Existing settings and data are preserved.')
    return
  }
  for (const step of plan) {
    run(step.command, step.args, { cwd: step.cwd, env: step.env, stdio: 'inherit' })
  }
  log.info('[anubis] Source installation ready. Start in this checkout with npm run managed.')
  log.info('[anubis] Existing .env is preserved; --standalone only selects defaults for a new .env.')
  log.info('[anubis] Read the Web password locally from .env; never share that file. Managed access also requires gateway approval and authentication.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).join(' ') === '--check-dependencies') {
      checkSourceDependencies(sourceRoot)
    } else {
      installSource({ args: process.argv.slice(2) })
    }
  } catch (error) {
    console.error('[anubis] Source installation failed:', error.message)
    process.exitCode = 1
  }
}
