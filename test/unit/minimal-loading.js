import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pug = require('pug')
const template = fileURLToPath(new URL('../../src/app/views/index.pug', import.meta.url))

for (const isDev of [false, true]) {
  test(`Web loading screen remains neutral and static in ${isDev ? 'development' : 'production'}`, () => {
    const html = pug.renderFile(template, {
      isDev,
      version: '5.7.3',
      siteName: 'Anubis-Security-Tool',
      cdn: '',
      tokenElecterm: '',
      _global: { brand: { name: 'Anubis-Security-Tool' } }
    })
    assert.match(html, /#content-loading \.morph-shape\s*\{/)
    assert.match(html, /background:\s*#202020/)
    assert.match(html, /animation:\s*none/)
    assert.match(html, /transition:\s*none/)
    assert.match(html, /border-radius:\s*12px/)
    assert.doesNotMatch(html, /linear-gradient|animation:\s*morph/)
    assert.match(html, /src="images\/electerm\.png"/)
    assert.doesNotMatch(html, /loader-api\.com/)
    assert.match(html, /window\.et =/)
    assert.match(html, /<script[^>]+type="module"/)
  })
}
