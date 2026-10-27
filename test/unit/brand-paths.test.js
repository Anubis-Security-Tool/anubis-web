import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import brand from '../../src/app/common/brand.config.js'

const client = createRequire(import.meta.url)('../../src/app/common/brand.client.cjs')

test('Web server and injected client use owned Web repository, shared Wiki and actual locale package layout', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(brand.urls.git.repo, 'https://github.com/Anubis-Security-Tool/anubis-web')
  assert.equal(client.repo.url, brand.urls.git.repo)
  assert.equal(client.repo.name, 'anubis-web')
  assert.equal(client.docs.wikiBase, 'https://github.com/Anubis-Security-Tool/anubis/wiki')
  assert.equal(brand.urls.git.wiki, client.docs.wikiBase)
  assert.equal(manifest.languageRepo, 'https://github.com/Anubis-Security-Tool/anubis-packages/tree/main/locales')
  assert.equal(brand.urls.git.locales, manifest.languageRepo)
  assert.equal(client.repo.localesEdit + '/en_us.js',
    'https://github.com/Anubis-Security-Tool/anubis-packages/edit/main/locales/dist/cjs/en_us.js')
})
