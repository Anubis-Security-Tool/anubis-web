# 🌐 Anubis-Security-Tool Web

基于浏览器的终端 / SSH / SFTP / RDP / VNC 客户端，支持独立运行和经管理员批准的受控访问。品牌配置见 `src/app/common/brand.config.js`。

[网站](https://anubis.locker) · [Desktop](https://github.com/Anubis-Locker/anubis) · [受控访问组件](https://github.com/Anubis-Locker/anubis-managed-access)

保留 MIT 原始版权和署名，包括 © ZHAO Xudong，见 [LICENSE](LICENSE)。

English: [README.md](README.md)

## 快速开始

需要 Node.js 24 或更新版本。公开 Web CLI 为 `5.6.12`；当前 `5.7.3` 源码候选不代表该 npm 包已更新，也不代表已安装的服务通过验收。

```bash
npm install --global anubis-web@5.6.12 --registry=https://npm.anubis.locker/
anubis-web
```

CLI 默认连接 `https://api.anubis.locker` 注册设备，并在私有目录生成独立的 Web 凭据。管理员必须先核对 fingerprint 并批准设备；批准不代替 Web 登录。不要公开 `.env`、安装凭据或令牌。`anubis-web --standalone` 禁用本次受控注册；`--init` 仅初始化配置。更新保留现有配置和数据。

## 从源码构建

需要 git 和编译工具。脚本使用自己的仓库，生成强 `SERVER_SECRET` / `SERVER_PASS`，保留现有 `.env`：

```bash
curl -fsSL https://raw.githubusercontent.com/Anubis-Locker/anubis-web/main/scripts/one-line-web.sh | bash
# Windows：下载并运行 scripts\one-line-web.bat
```

手动构建：

```bash
git clone https://github.com/Anubis-Locker/anubis-web.git
cd anubis-web
npm install --legacy-peer-deps --registry=https://npm.anubis.locker/
npm run setup-managed
npm run build
npm run managed
```

本机访问 `http://127.0.0.1:5577`。外部访问需要设备批准、gateway 浏览器认证和独立 Web 登录。安装前设置 `ANUBIS_MANAGED_ACCESS=0` 可明确选择独立模式。详细配置和版本边界以 [English README](README.md) 为准。

## Docker

```bash
cp .sample.env .env
docker compose up -d --build   # web + nginx,http://127.0.0.1:8080
```

## 安全默认值

- 认证默认开启,仅 `ENABLE_AUTH=0` 时关闭;不会向匿名访客发放 token。
- 生产环境下,`SERVER_SECRET` / `SERVER_PASS` 缺失、过弱或为默认值时拒绝启动。
- 登录按 IP 限速,token 默认 12 小时过期(`TOKEN_EXPIRED_TIME`)。
- 修复 `?init=` 反射型 XSS;CORS 默认不允许跨域(`CORS_ORIGINS`)。
- MCP 仅监听本机回环地址,必须提供 Bearer token(`MCP_TOKEN`)。
- 位于 nginx 之后请设置 `TRUST_PROXY=1`,并务必使用 HTTPS。

## 说明

- Anubis 自有共享组件使用 `@ai-security-tool/*` 作用域；第三方依赖保留原包名和许可证。使用自己的 registry，见 `.npmrc`。
- 保留上游版权与署名,见 `LICENSE`。

## 许可证

MIT,见 [LICENSE](LICENSE)。
