/**
 * Single source of truth for fork branding and external URLs.
 * Pure ESM with no node-only imports, so it is usable from the server,
 * build scripts and the vite client bundle.
 *
 * Change the values below (or override domain/org/repo via env on the server)
 * instead of hard-coding URLs anywhere else.
 * Service endpoints use managed subdomains; the apex hosts the official site.
 */

const env = (typeof process !== 'undefined' && process.env) || {}

const domain = env.BRAND_DOMAIN || 'anubis.locker'
const org = env.BRAND_GIT_ORG || 'Anubis-Security-Tool'
const repo = env.BRAND_GIT_REPO || 'anubis-web'
const gitHost = 'https://github.com'
const repoUrl = `${gitHost}/${org}/${repo}`

export const brand = {
  name: 'Anubis-Security-Tool',
  id: 'anubis',
  appId: 'locker.anubis.securitytool',
  protocol: 'anubis://',
  domain,
  org,
  npmScope: '@ai-security-tool',
  copyright: 'Anubis-Security-Tool contributors. MIT License. Based on electerm by ZHAO Xudong.',
  urls: {
    home: `https://${domain}`,
    download: `https://download.${domain}`,
    update: `https://update.${domain}`,
    sync: `https://sync.${domain}`,
    theme: `https://theme.${domain}`,
    docs: `https://docs.${domain}`,
    demo: `https://demo.${domain}`,
    ai: `https://ai.${domain}`,
    aiApi: `https://ai.${domain}/api/ai`,
    cloud: `https://cloud.${domain}`,
    sponsor: `https://${domain}/sponsor/`,
    about: `https://${domain}/about/`,
    contact: `https://${domain}/contact/`,
    faq: `https://${domain}/faq/`,
    terms: `https://${domain}/terms/`,
    privacy: `https://${domain}/privacy-policy/`,
    blog: `https://${domain}/blogs/`,
    videos: `https://${domain}/videos/`,
    scripts: `https://download.${domain}/scripts`,
    debRepo: `https://repos.${domain}/deb`,
    rpmRepo: `https://repos.${domain}/rpm`,
    resource: `https://${domain}/static/images`,
    git: {
      host: gitHost,
      org: `${gitHost}/${org}`,
      repo: repoUrl,
      cloneUrl: `${repoUrl}.git`,
      issues: `${repoUrl}/issues`,
      newIssue: `${repoUrl}/issues/new/choose`,
      discussions: `${repoUrl}/discussions`,
      newDiscussion: `${repoUrl}/discussions/new`,
      releases: `${repoUrl}/releases`,
      wiki: `${repoUrl}/wiki`,
      docker: `${gitHost}/${org}/web-docker`,
      locales: `${gitHost}/${org}/anubis-locales`,
      desktop: `${gitHost}/${org}/anubis`
    }
  },
  ai: {
    id: `ai.${domain}`,
    name: `ai.${domain}`,
    baseURLAI: `https://ai.${domain}/api/ai`,
    apiPathAI: '/chat/completions',
    modelAI: 'free',
    authHeaderNameAI: 'Authorization: Bearer'
  }
}

export const defaultAIPreset = { ...brand.ai, nameAI: brand.ai.name }
delete defaultAIPreset.name

export default brand
