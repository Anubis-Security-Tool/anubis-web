# 🌐 Anubis-Security-Tool Web

Browser-based terminal / SSH / SFTP / RDP / VNC client, with standalone and
approved managed-device access. Brand values live in `src/app/common/brand.config.js`.

[Website](https://anubis.locker) · [Wiki](https://github.com/Anubis-Security-Tool/anubis/wiki) · [Desktop](https://github.com/Anubis-Security-Tool/anubis) · [Managed transport](https://github.com/Anubis-Security-Tool/anubis-managed-access)

Original MIT copyright and attribution, including © ZHAO Xudong, are preserved
in [LICENSE](LICENSE).

Chinese: [README_cn.md](README_cn.md)

## Requirements and release status

Use **Node.js 24+**, npm and git. Source builds include native terminal and
serial-port modules: install Python 3 and a C/C++ toolchain if compatible
prebuilt binaries are unavailable. On Windows use Visual Studio Build Tools
with Desktop development with C++; on Debian/Ubuntu install
`python3 make g++`; on macOS install the Xcode command-line tools.

This source targets the coordinated **5.7.6** Web, renderer and browser-assets
release. A source commit is not a publication or deployment. The exact renderer,
managed SDK and resource pins in `package.json` and the matching lock must be
available from the Anubis registry before a normal fresh source install.
Never replace missing release dependencies with a copied installed Desktop
ASAR, a session directory, or packages from a different release.

## Packaged Web runtime

Install the independent Web runtime **only from the Anubis registry**:

```bash
npm install --global anubis-web@5.7.6 --registry=https://npm.anubis.locker/
anubis-web
```

Use that versioned command only after the release owner publishes `5.7.6`.
Check `anubis-web --version`; updating this repository does not change an
already installed runtime or service.

The CLI starts production mode with managed access to `https://api.anubis.locker`
by default. It creates unique Web login credentials in a private
`~/.anubis-web/.env`; `ANUBIS_WEB_HOME` selects another installation directory.
Read that file locally for the Web password. First gateway fingerprint approval
and a separate gateway browser login are required; enrollment is not approval.
`anubis-web --standalone` explicitly disables managed enrollment for that run,
and `anubis-web --init` only initializes configuration without starting a server.
Updating the package does not overwrite existing settings, credentials or data.
Do not install the similarly named package from the public npm registry.

## Build and install from source

Clone this repository and use the cross-platform source installer:

```bash
git clone https://github.com/Anubis-Security-Tool/anubis-web.git
cd anubis-web
node scripts/install-source.js
npm run managed
```

The installer runs locked `npm ci --include=dev --legacy-peer-deps` explicitly
against `https://npm.anubis.locker/`, explicitly runs the owned
`node build/bin/install.js` renderer-copy hook after dependency validation,
builds the browser bundle, verifies the complete asset manifest and only then
creates a private `.env` with unique strong
`SERVER_SECRET` / `SERVER_PASS`. It never starts a service or enrolls a device
itself. An install, build or validation failure stops the sequence.
The owned copy step also runs when npm suppresses install lifecycle scripts;
it does not approve dependency scripts or change npm's script policy.

From a combined source checkout, its bootstrap can invoke this same file by its
path, for example `node web/scripts/install-source.js` from the root.
The installer resolves its own repository directory, not the caller's working
directory. It does not install Desktop or unrelated plugins; the root bootstrap
owns those components.

For an explicit full-source pipeline, the root bootstrap may pass local npm
tarballs produced from the accepted source checkouts:

```bash
node web/scripts/install-source.js --renderer-package /absolute/path/electerm-react-5.7.6.tgz --sdk-package /absolute/path/managed-access-1.0.4.tgz --resource-package /absolute/path/resource-2.2.3.tgz
```

Tarball filenames are arbitrary; their internal `package/package.json` must
match the exact package names and versions in this Web manifest. URLs, missing
or nonregular files, duplicate package manifests, corrupt TAR headers and
mismatched versions are rejected before npm runs. The main source producer
assembles the shared renderer package (not the whole Desktop app); the SDK
producer runs `npm pack --ignore-scripts --pack-destination <staging-directory>`
in its checkout. The root bootstrap owns those absolute staging paths.
Do not pass the Desktop application tarball as the renderer.

With any explicit override the installer uses
`npm install --no-save --package-lock=false` with the same own-registry and
development-dependency flags, followed by exact installed-version checks,
normal source copying, build and payload verification. It does not rewrite
`package.json` or `package-lock.json`. This is a deliberate source-build mode,
not a fallback after a missing registry package. Other dependencies still resolve from the accepted registry pins. Publishing
immutable browser assets still requires the registry-bound renderer and lock;
local source tarballs alone are not release provenance.

For a **new standalone source installation**:

```bash
node scripts/install-source.js --standalone
npm run managed
```

The generated `.env` records `ANUBIS_MANAGED_ACCESS=0`; the managed runner
respects that opt-out. Existing `.env` files, passwords, databases and enrollment
identities are never replaced. On an existing installation, change its private
configuration deliberately or set `ANUBIS_MANAGED_ACCESS=0` in the process
environment for a one-run opt-out. `--standalone` on the installer does not
silently rewrite an existing managed configuration.

Local URL: `http://127.0.0.1:5577`. Read `SERVER_PASS` locally from this checkout's
`.env`, not from the controller admin token or a Windows password. Keep `.env`
and `data` private; on Windows restrict their ACL to the installation's account
and authorized administrators. Starting managed mode requires first device
fingerprint approval and separate browser gateway authorization.

One-line clone wrappers use the same installer:

```bash
# Linux / macOS; inspect the script before executing downloaded code
curl -fsSL https://raw.githubusercontent.com/Anubis-Security-Tool/anubis-web/main/scripts/one-line-web.sh | bash
# Windows: download scripts\one-line-web.bat from this repository and run it
```

Set `ANUBIS_DIR`, `ANUBIS_REPO_URL` or `ANUBIS_REF` to choose a checkout. Existing
tracked edits or a failed fast-forward stop updates instead of building stale
or partially updated source. `ANUBIS_MANAGED_ACCESS=0` also selects standalone
defaults when a wrapper creates a new configuration.

Equivalent manual sequence (all three platforms):

```bash
npm ci --include=dev --legacy-peer-deps --registry=https://npm.anubis.locker/
npm run build
node npm/anubis-web.js --check
npm run setup-managed
npm run managed
```

`npm run prod` runs the built source with production authentication but does
not add a gateway URL; it remains opt-in through the existing environment.
`npm run dev` / `npm start` are development only, not managed remote servers.
The packaged CLI uses `ANUBIS_WEB_HOME` (default `~/.anubis-web`); the source
runner uses this checkout's `.env` and `DB_PATH` (default `./data`). These are
separate installations unless explicitly configured otherwise.

Stop the server with Ctrl+C or SIGTERM. Both standalone and managed mode close
the listener, stop running widgets and terminal sessions, and stop any managed
transport before exiting. Cleanup errors are logged and produce a nonzero exit.

## Docker

```bash
npm run setup-managed
docker compose up -d --build   # web + nginx on http://127.0.0.1:8080
```

Set `ANUBIS_MANAGED_ACCESS=0` before generating a new configuration if the
container should be standalone. Container runs as non-root, read-only rootfs,
all caps dropped, data in the `anubis-data` volume. Put TLS in front (see
`examples/nginx-ssl.conf`). Do not reuse the source database directory as a
second concurrently running installation.

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
standalone Web `SERVER_PASS`/JWT login still applies. Desktop's native SYSTEM
User/Administrator password-file adapter is a different backend contract, not
an API implemented by this standalone Web server. Do not promise those Desktop
role passwords will log in to this installation. Registration alone does not mean the
installation is online, and enrollment never uploads SSH/VNC/MCP credentials
or the machine's username. Set `ANUBIS_MANAGED_ACCESS=0` for the managed runner
or use `anubis-web --standalone` to opt out explicitly. For the ordinary
standalone source runner, unset `ANUBIS_MANAGED_URL`.
The existing data-sync configuration is independent of this transport.

### Local source-suite sync defaults

The root source-suite runner may provide `ANUBIS_SYNC_URL`,
`ANUBIS_SYNC_USER` and `ANUBIS_SYNC_JWT_SECRET` only in the Web process
environment from its private generated configuration. On a **brand-new default
SQLite profile**, Web records those as `syncSetting.customApiUrl`,
`customGistId` and `customAccessToken`, retaining the normal automatic-sync
defaults. The URL must be a loopback HTTP `/api/sync` endpoint and the JWT
secret must be unique and strong. Partial or invalid new-profile configuration
fails explicitly before creating database files. No custom sync password is
generated or assumed.

Existing SQLite files, existing user configuration and legacy profile
directories are never reseeded, even if their sync settings are empty.
Changing these environment variables later does not rotate or overwrite saved
sync credentials. Custom database adapters retain their existing initialization
behavior. This mapping does not write `.env`, contact a sync service, or include
the JWT secret in anonymous page data, logs, enrollment or build assets.
The existing custom-sync protocol exposes its credential only to the
authenticated installation UI; protect its profile and authenticate Web as you
would shell access. The root runner owns the loopback sync service and its
private configuration; Web does not install or start it.

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

Desktop and Web use the same client sources, published as
`@ai-security-tool/electerm-react`. Web `5.7.6` and its browser-assets package
must use the exact accepted `5.7.6` renderer, not a mutable sibling Desktop
checkout. Automatic sync is enabled by default
against `https://sync.anubis.locker/api/sync`; account credentials are still
required before data is uploaded.

The coordinated release pins are recorded in `package.json` and
`package-lock.json`; the release pipeline publishes the renderer first, then
builds Web and immutable browser assets, then binds Desktop to those assets.
The renderer includes its published browser-safe shared
modules and distinguishes native embedded websites from ordinary browser iframe
sessions. Source changes do not publish any package or deploy a running service.
Standalone staging candidates remain private until an explicit publication
decision.

After building, run `npm run test3` and `npm run test-packaged-web`.
The browser check needs `npx playwright install chromium`; it starts only
a temporary loopback server, checks rejected and successful login, the shared
248 px navigation, settings, actual terminal command output, authenticated MCP
initialization and an MCP tool call into the browser store. It removes its own
database and never connects to or deploys the public demo.
Database tests use their own configuration directories and close SQLite handles
before cleanup, including on Windows.

After a production build, `npm run stage-browser-assets -- --source-commit
<full-renderer-source-commit>` prepares
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
For `5.7.4` and newer, staging also requires the renderer publisher's `anubisSource`
metadata to match that source commit, recomputes its source-file hash in the
publisher's canonical path order, and rejects modified copied build sources.

New builds also preserve original project and dependency legal documents under
`dist/assets/third-party/` (the browser package ships the same directory under
`assets/third-party/`). `index.json` maps exact installed/locked package versions,
original relative paths, upstream archive integrities and byte-identical notices
to content-addressed files. Nested/vendored licenses, attribution files and
original READMEs are retained; fallback source headers remain original files,
not rewritten license claims. A license name or link alone is not a substitute
for complete original terms: unresolved runtime or bundled entries fail the
build and are listed in the inventory for review. Supplemental originals require
an exact package version, upstream commit and checksum. The own-registry-pinned
`@ai-security-tool/third-party-compliance@1.0.1` capsule is copied in full,
including its manifest, original supplemental notices, preferred source archives
and rebuilding/relinking instructions. An explicitly recorded
`upstream-declaration-only` exception preserves the upstream declaration and
exact source instead of inventing an upstream copyright or license grant.
The exact optional Rolldown Linux-musl `1.0.3` binding also retains its original
metadata/README and the capsule's original GNU-platform notice: its pinned
registry integrity and upstream project commit prove that the same project
license applies. This bounded relation is recorded in the inventory and does
not permit another version, integrity or an unrelated missing license.

Vite also emits `browser-dependencies.json` from its actual module graph,
containing only normalized dependency identities, never local filesystem paths.
The notice inventory preserves that evidence and records both bundled use and
the locked production/runtime classification. GPL/LGPL/MPL preferred sources
are required for runtime dependencies or code present in any collected graph,
including the dev-dependency noVNC and SPICE libraries. Build-only compilers
such as Lightning CSS retain their original notices and metadata; their native
binaries/code are not shipped merely because the generated CSS is shipped.
Missing bundle evidence or a classification that contradicts it fails the gate.
Native source builds use their own installation root and lock and pass their
actual native Vite proof alongside the embedded-browser proof:
`collectThirdPartyNotices({root, assets, requireCompliance: true,
additionalBundleManifests: [absoluteNativeProofPath]})`. The optional array
defaults to empty; each additional regular file uses the same
`{"format":1,"packages":["node_modules/package-name"]}` schema. All identities
must match the installed/locked inventory. The collector preserves each proof
byte-for-byte in a content-addressed file referenced by
`index.additionalBundleDependencies`, without recording its absolute input path.
Validation reconstructs the union of all proofs.

An incomplete notice catalog is nonfatal only when the package is explicitly
nonruntime and absent from every validated bundle graph. It remains
`complete: false` with `noticeStatus: "incomplete-build-only-notice-catalog"`;
its original metadata and all available notices are still preserved. This is
not a blanket dev-dependency exemption, and unknown or contradictory use
classification cannot qualify.

The asset manifest includes this inventory and every preserved file, so neither
Web packaging nor browser-asset staging can silently discard legal documents.
Build, staging and prepack gates from `5.7.6` onward reject missing, modified or
unresolved runtime/bundled notice inventories. Existing production asset-integrity
checks cover the preserved originals without changing server behavior.
This does not rewrite published
`5.7.5` or `5.7.6` packages or change the shared renderer's source bytes.
Before upload or publication, CI reads both actual `npm pack` archives and
verifies every asset and preserved original against the shared asset manifest;
source-tree checks alone cannot hide files omitted by packaging filters.
The actual archives must not contain copied `node_modules` trees or native
`.node` compiler binaries.

The manually dispatched **Web and browser-assets packages** workflow
(`release-packages.yml`) accepts the full renderer source commit and defaults
to artifact-only mode. After the accepted renderer, SDK and resource releases
exist and this repository's lock records their real integrities, it installs,
builds, runs local browser/tunnel checks and packs both Web and browser assets.
Only explicit `publish=true` uses `NPM_TOKEN` to publish to the Anubis registry.
Existing different content at the same version is rejected; matching content
can be reused without republishing. This workflow does not deploy or restart
anything. Do not trigger a `v*` tag for this package-only flow: the separate
legacy Docker workflow has a VPS rollout job.

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
