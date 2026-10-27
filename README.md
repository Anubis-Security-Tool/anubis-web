# 🌐 Anubis-Security-Tool Web

Browser-based terminal / SSH / SFTP / RDP / VNC client, with standalone and
approved managed-device access. Brand values live in `src/app/common/brand.config.js`.

[Website](https://anubis.locker) · [Wiki](https://github.com/Anubis-Locker/anubis/wiki) · [Desktop](https://github.com/Anubis-Locker/anubis) · [Managed transport](https://github.com/Anubis-Locker/anubis-managed-access)

Original MIT copyright and attribution, including © ZHAO Xudong, are preserved
in [LICENSE](LICENSE).

Chinese: [README_cn.md](README_cn.md)

## Quick start

Install the independent Web runtime **only from the Anubis registry**:

```bash
npm install --global anubis-web@5.6.12 --registry=https://npm.anubis.locker/
anubis-web
```

The public Web CLI release is `5.6.12`, independently versioned from Desktop
`5.7.2`. Source documentation does not mean a feature is present in an installed
package or deployed service; check the installed version and its release notes.
Updating this repository does not publish a new runtime or deploy a service.

The CLI starts production mode with managed access to `https://api.anubis.locker`
by default. It creates unique Web login credentials in a private
`~/.anubis-web/.env`; `ANUBIS_WEB_HOME` selects another installation directory.
Read that file locally for the Web password. First gateway fingerprint approval
and a separate gateway browser login are required; enrollment is not approval.
`anubis-web --standalone` explicitly disables managed enrollment for that run,
and `anubis-web --init` only initializes configuration without starting a server.
Updating the package does not overwrite existing settings, credentials or data.
Do not install the similarly named package from the public npm registry.

Or build from source:

```bash
# Linux / macOS (Node.js 24+, git, build tools)
curl -fsSL https://raw.githubusercontent.com/Anubis-Locker/anubis-web/main/scripts/one-line-web.sh | bash
# Windows
# download scripts\one-line-web.bat and run it
```

The script clones `ANUBIS_REPO_URL` (default `https://github.com/Anubis-Locker/anubis-web.git`), builds, and creates a private `.env` with generated `SERVER_SECRET` / `SERVER_PASS` and the managed gateway configured. Start with `npm run managed` and open http://127.0.0.1:5577 locally, or use the gateway after approval. Set `ANUBIS_MANAGED_ACCESS=0` before installation for an explicit standalone install. Existing `.env` files are preserved on updates; `npm run managed` supplies the gateway default unless that opt-out is set.

Manual:

```bash
git clone https://github.com/Anubis-Locker/anubis-web.git && cd anubis-web
npm install --legacy-peer-deps --registry=https://npm.anubis.locker/
npm run setup-managed     # generates strong credentials; preserves an existing .env
npm run build
npm run managed
```

## Docker

```bash
cp .sample.env .env   # fill SERVER_SECRET / SERVER_PASS
docker compose up -d --build   # web + nginx on http://127.0.0.1:8080
```

Container runs as non-root, read-only rootfs, all caps dropped, data in the `anubis-data` volume. Put TLS in front (see `examples/nginx-ssl.conf`).

## Security defaults

| Area | Behaviour |
|---|---|
| Auth | ON unless `ENABLE_AUTH=0`. No token is handed to anonymous visitors. |
| Production | Refuses to start if `SERVER_SECRET` / `SERVER_PASS` are missing, weak or default. |
| Login | Per-IP rate limit (`LOGIN_MAX_FAILS`, `LOGIN_WINDOW_MS`), timing-safe compare. Tokens expire after `TOKEN_EXPIRED_TIME` (12h). |
| XSS | `?init=` and other page data are serialized safely in `index.pug`. |
| CORS | No cross-origin access unless listed in `CORS_ORIGINS`. |
| MCP widget | Loopback only (`MCP_ALLOW_REMOTE=1` to override), bearer token required (`MCP_TOKEN`). |
| Proxy | Set `TRUST_PROXY=1` behind nginx. |

See `.sample.env` for all variables. Run behind HTTPS; the app can open shells and read/write files for any authenticated user, so treat credentials like root access.

## Managed external access

The npm CLI, one-line installers, and `npm run managed` default to
`https://api.anubis.locker`. Ordinary source development and `npm run prod`
retain their existing opt-in behavior. To enroll an existing production-built
standalone installation, run `npm run managed` or explicitly set
`ANUBIS_MANAGED_URL=https://api.anubis.locker`, and optionally
`ANUBIS_INSTALLATION_LABEL` (default `Anubis Web`). Keep `HOST=127.0.0.1`,
authentication enabled, a strong `SERVER_SECRET`, and a unique `SERVER_PASS`
of at least 16 characters. Leave `SERVER` and `CDN` unset so browser requests
stay on the installation's authenticated gateway origin. Development/Vite mode
is not exposed by this integration; build first and run with `NODE_ENV=production`.

The shared managed-access client persists a unique installation ID and secret
in `ANUBIS_INSTALLATION_FILE` (default `DB_PATH/managed-installation.json`,
or `./data/managed-installation.json`). Preserve this private file across
restarts, restrict its filesystem permissions, and never copy it to a second
installation or include it in a public backup. No administrator token is embedded
or required. An administrator must approve the first enrollment's fingerprint;
pending or revoked installations are not remotely accessible.
The process prints its installation ID, fingerprint, and connection status to
stdout in production too; verify that fingerprint before approval. The private
installation secret is never printed.

After approval, the client maintains an outbound authenticated tunnel, reconnects
after network loss, and reports availability only while the local HTTP listener is
healthy. The gateway authenticates browser operators separately, and the normal
Web password/JWT login still applies. Registration alone does not mean the
installation is online, and enrollment never uploads SSH/VNC/MCP credentials
or the machine's username. Set `ANUBIS_MANAGED_ACCESS=0` for the managed runner
or use `anubis-web --standalone` to opt out explicitly. For the ordinary
standalone source runner, unset `ANUBIS_MANAGED_URL`.
The existing data-sync configuration is independent of this transport.

Run `npm run test-managed-web` for an isolated real-client channel check against
a temporary local gateway fixture. It verifies Web JWT enforcement and a
WebSocket upgrade through the reverse transport without contacting a public
gateway. It also checks persisted installation identity and enrollment metadata.

Managed `/mcp` access is a separate, exact HTTP/SSE route, not a Web login bypass.
It requires authenticated gateway access and the tunnel client's private
per-process header; arbitrary headers or a Web JWT cannot unlock it directly.
The adapter uses the existing MCP widget's bearer token only on fixed loopback,
never returns or enrolls that token, and does not expose other upstream paths.
An administrator must configure/start the authenticated MCP widget with its
normal renderer connection and policy first; a fresh or stopped MCP widget
honestly returns `503`, not a fabricated connection. `MCP_ENABLED=false` disables
the managed adapter with `404`; the existing standalone/local MCP widget is
unchanged. Gateway-issued MCP grants are separate from both local MCP credentials
and Web login tokens.
Start the widget from the authenticated browser session that will serve its
renderer tools, and keep that session connected. Normal authorized widget
management returns its local API key to that Web UI; this is distinct from
enrollment or gateway-issued grants. The gateway terminates TLS and is a trusted
proxy, not end-to-end encryption against its operator.

## Data and legacy electerm data

Data lives in `DB_PATH` (default `./data`). The web app never moves data automatically: to reuse
an existing electerm desktop/web data folder, **copy** it (do not delete the original) and point
`DB_PATH` at the copy, e.g. `DB_PATH=/home/me/.config/anubis` after
`cp -r ~/.config/electerm ~/.config/anubis` (macOS: `~/Library/Application Support/electerm`,
Windows: `%APPDATA%\electerm`). Docker: mount the copy on the `anubis-data` volume.

## Logos and icons (`BRAND_RES_DIR`)

Logos/icons come from the resource package, found at `BRAND_RES_DIR` (relative to this repo or
absolute), else `../resource`, else `node_modules/@ai-security-tool/resource`. The same folder is
used by the vite dev server, the `@brand-res` alias and `build/bin/copy.js`.

## Shared UI and local verification

Desktop and web use the same client sources, published as
`@ai-security-tool/electerm-react`. The previously published Web runtime `5.6.12` keeps renderer and
browser-asset URLs pinned to `5.6.11` and
includes its Lucide icon dependency. Automatic sync is enabled by default
against `https://sync.anubis.locker/api/sync`; account credentials are still
required before data is uploaded.

Current source/runtime candidates and the separate browser-assets release
pipeline use version `5.7.3`, the exact published shared renderer `5.7.3`, and
managed SDK `1.0.3`. The renderer includes its published browser-safe shared
modules and distinguishes native embedded websites from ordinary browser iframe
sessions. These source changes do not republish the frozen `anubis-web@5.6.12`
runtime or deploy a running service. Standalone candidates remain private until
a separate runtime publication decision.

After building, run `npm run test3` and `npm run test-packaged-web`.
The browser check needs `npx playwright install chromium`; it starts only
a temporary loopback server, checks rejected and successful login, the shared
248 px navigation, settings, actual terminal command output, authenticated MCP
initialization and an MCP tool call into the browser store. It removes its own
database and never connects to or deploys the public demo.
Database tests use their own configuration directories and close SQLite handles
before cleanup, including on Windows.

After a production build, `npm run stage-browser-assets` prepares
`dist/browser-assets-package-<renderer-version>` for `npm pack --ignore-scripts`.
It refuses to overwrite an existing version's staging directory. This creates the
version-matched `@ai-security-tool/anubis-browser-assets` package for the desktop
browser adapter, containing only renderer assets, licensing and provenance, not a server or
database. The desktop resolves its `package.json` and serves the adjacent `assets`
directory, avoiding runtime dependencies on a sibling source checkout.

For an isolated release build, use `npm run stage-browser-assets -- --build
--source-commit <full-renderer-source-commit>`. Compilation uses a fresh versioned
output directory without modifying `dist/assets` or prior packages. The installed
renderer, copied build sources, manifest pin, and own-registry lock integrity must
agree. The source install hook also copies published browser-safe `app/common`
modules alongside the client, preserving their relative imports without a
sibling checkout or version-specific aliases. These shared sources are checked
against the installed package before compilation.
`source.json` records both source trees and the SHA-256 manifest of
every asset, including fonts, WASM, images and icons. Pack and publish only from
the resulting package directory, explicitly using `--registry=https://npm.anubis.locker/`.

`npm pack` checks and includes the backend, production views/assets, and
cross-platform `anubis-web` CLI, but not private data, `.env`, or source-only
renderer dependencies. `npm run test-distribution` packs the Web runtime,
installs that tarball with production dependencies from the Anubis registry,
and checks the installed CLI, strong managed-default configuration, rejected
and successful Web login, and a real browser terminal outside the checkout.
Its browser launch explicitly selects standalone mode, and a separate managed
startup check uses only a deliberately unavailable local fixture, so neither
enrolls a test installation into the public gateway. Set `ANUBIS_WEB_TARBALL`
to an existing tarball's absolute path to verify that exact release artifact
instead of packing a temporary candidate.

### Isolated standalone restoration candidate

Production startup and `anubis-web --check` validate the Pug template,
version-matched entry bundles, worker, CSS, fonts, WASM, icons, and every asset's
SHA-256 against `dist/asset-manifest.json`. A partial deployment exits with an
actionable error before listening instead of returning a broken page. Normal
`npm run build` propagates compilation/copy failures and writes that manifest.
`--check` does not create a profile, open the database, or start a listener.

To stage a reversible candidate without rebuilding or changing frozen browser
assets, run `npm run stage-standalone`. It reads the matching
`dist/browser-assets-package-<renderer-version>`; use
`-- --browser-assets <installed-browser-assets-package>` for another verified
copy. Each invocation creates a fresh `dist/standalone-candidate-<version>-*/package`
containing the server, templates, complete assets, and provenance in `release.json`.
The candidate is explicitly `private: true`, is not a new published runtime
release, and contains no data, `.env`, credentials, or Windows `node_modules`.
Its `npm-shrinkwrap.json` preserves dependency versions/integrities while routing
registry tarball URLs exclusively through `https://npm.anubis.locker/`.

From that candidate's `package` directory, use `npm pack --pack-destination ..`.
Run the checkout's distribution test with `ANUBIS_WEB_TARBALL` set to the
resulting absolute tarball path and `ANUBIS_WEB_EXPECT_PRIVATE=1`. This verifies
an actual clean production install, missing-template/worker startup rejection,
independent password login, shared UI and terminal, with a private test profile.
For `npm run test-managed-web`, `ANUBIS_WEB_APP_ROOT` may select an extracted
candidate after its production dependencies are installed. The local gateway
fixture then verifies that complete runtime and its renderer without replacing
the checkout's older assets or contacting a production gateway.

For Linux deployment, extract the accepted tarball into a **new versioned release
directory**, then run there:

```sh
npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --registry=https://npm.anubis.locker/
ANUBIS_WEB_HOME=/path/to/existing-private-profile node npm/anubis-web.js --check
```

Use Node.js 24 or newer and install native build prerequisites if the host needs
to compile `node-pty` or serial-port bindings. Never copy Windows `node_modules`.
The production install hook skips source copying because this payload does not
include `src/client`; it does not require the omitted development renderer.
Preserve the existing profile, `.env`, absolute `DB_PATH`, custom configuration,
service account, proxy/TLS configuration and login credentials. Do not run
`--init` or generate replacement credentials to repair an existing installation.
After a private-profile smoke test and a protected backup, the deployment owner
can point the service at the new release's CLI with
`ANUBIS_WEB_HOME` selecting the existing profile and `--standalone`. Keep the old
code directory and service configuration for rollback; no data reset is needed.
If an existing service supplies its credentials through its environment and has
no profile `.env`, retain that environment and working directory and use the new
release's absolute `src/app/app.js` entry with `NODE_ENV=production`,
`ANUBIS_MANAGED_ACCESS=0`, and the existing absolute `DB_PATH`. Normal CLI startup
initializes a missing profile; do not use it to regenerate settings for this
restoration case. The direct production entry has the same readiness guard.
Windows execution-context selection belongs to the managed Windows gateway,
not to the standalone Linux server.

`node --test test/packaged/managed-live.js` runs offline safety checks by default.
For controlled production acceptance, set `ANUBIS_MANAGED_LIVE=1` and provide
`ANUBIS_MANAGED_ADMIN_TOKEN` only in the Node test controller's environment.
This opt-in test installs the published package outside the checkout, verifies
its fresh local fingerprint before approval, and exercises the actual HTTPS
admin UI, independent Web login, terminal, MCP tools and active-stream
revocation. It passes no controller credential to the installed application,
revokes only its guarded test identity, and removes its temporary processes and
profile. Failed revocation preserves the profile and reports its exact identity
instead of discarding ownership evidence.

For the controlled VNC framebuffer/keyboard/pointer check, also set
`ANUBIS_VNC_FIXTURE_MODULE` to the absolute path of
`app/src/test/integration/lib/vnc-test-server.js` in the combined source workspace
before running the browser check. Without an explicit fixture module, that
external-protocol check is reported as skipped, not passed.

## Notes

- The default registry and `@ai-security-tool/*` scope both point to `https://npm.anubis.locker/` (see `.npmrc`).
- Upstream attribution is kept in `LICENSE` and widget author fields.

## License

MIT, see [LICENSE](LICENSE).
