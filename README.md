# SPlayer-FIX

[中文](#中文说明) | [English](#english)

SPlayer-FIX 是基于 [SPlayer](https://github.com/SPlayer-Dev/SPlayer) 的社区派生版本，保留原项目的名称、版权信息和 AGPL-3.0 许可证。本项目不是原版 SPlayer 的官方版本，也不代表原作者或 SPlayer-Dev 团队。

SPlayer-FIX is a community-maintained derivative of [SPlayer](https://github.com/SPlayer-Dev/SPlayer). It retains the original project's name, copyright notices, and AGPL-3.0 license. This repository is not an official SPlayer release and does not represent the original author or the SPlayer-Dev team.

<div align="center">
<img alt="logo" height="100" width="100" src="public/icons/favicon.png" />
<h2> SPlayer-FIX </h2>
<p> 面向自托管 Web、Android 和多设备同步场景的 SPlayer 派生版本 </p>

[下载 / Releases](https://github.com/ChEnLeo-7/SPlayer-FIX/releases) | [源码 / Source](https://github.com/ChEnLeo-7/SPlayer-FIX) | [原版 / Upstream](https://github.com/SPlayer-Dev/SPlayer)

<br />

</div>

![main](/screenshots/SPlayer.jpg)

## 中文说明

### 与原版的比较基线

以下差异以本 fork 开始定制前的原版提交 [`40d9ec60`](https://github.com/SPlayer-Dev/SPlayer/commit/40d9ec606cc1e323c964ffea7bf0ab02f137e93b) 为基线，对比当前 SPlayer-FIX `v3.2.4`。这是“相对分叉时原版快照”的说明，不表示上游项目后续没有加入相似功能。

原版在该基线中已经具备 Electron 桌面客户端、Docker Web 部署、歌曲下载、音源解锁与回退、移动端全屏播放器、滑动操作和快捷键配置。下文只列 SPlayer-FIX 在这些基础上新增、扩展或改变的行为。

### 差异总览

| #   | 能力                   | 原版基线                                                      | SPlayer-FIX v3.2.4                                                                                                                                                            |
| --- | ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Android 应用           | 没有独立 Android 工程或 APK 构建链，移动设备主要使用 Web 页面 | 新增基于 Capacitor 的 Android 应用、独立 Web 构建配置、Gradle 工程和通用 APK 发布流程，最低支持 Android 7.0（API 24）                                                         |
| 2   | Android 原生播放       | 使用浏览器音频能力，没有 Android 原生媒体服务                 | 新增基于 AndroidX Media3/ExoPlayer 的播放器和 `MediaSessionService`，支持后台播放、锁屏与通知栏控制、耳机按键、音频焦点、拔出耳机暂停、播放速度及系统上一首/下一首操作        |
| 3   | Android 播放状态与拖动 | 没有原生桥接层                                                | 原生播放器向 Web 层持续推送播放状态；seek 使用序列号、超时和状态校验，降低连续拖动进度条时旧回调覆盖新位置的问题                                                              |
| 4   | Android 原生下载       | 没有 Android 原生下载服务                                     | 新增前台下载服务，支持通知栏进度、HTTP Range、任务持久化、应用重启后续传、取消和失败重试；下载完成后写入系统媒体库                                                            |
| 5   | Android 文件管理       | 依赖 Web/桌面下载路径                                         | 支持默认保存到 `Download/SPlayer`、Storage Access Framework 自选目录、同名文件覆盖或保留副本，以及 MP3/FLAC 标题、歌手、专辑和封面等标签写入                                  |
| 6   | 自托管服务器连接       | Web 地址由部署或浏览器决定                                    | Android 启动页可输入、检测、保存和切换自托管 SPlayer 地址；连接前校验健康接口、产品标识、移动 API 版本、URL、TLS 和重定向，并限制 Capacitor 桥接的注入来源                    |
| 7   | SPlayer 独立账户       | 只有音乐平台登录状态，没有本项目自己的账户系统                | 新增独立的 SPlayer 注册、登录、退出、修改密码、恢复密钥、密码恢复、管理员一次性临时密码和会话管理；它不替代网易云账号，而是用于保存和同步应用数据                             |
| 8   | 端到端加密             | 没有 SPlayer 账户保险库                                       | 客户端生成随机 256 位保险库密钥，使用 AES-256-GCM 加密同步内容；密码通过 PBKDF2-SHA-256 派生后只用于包裹保险库密钥，服务端仅保存密文、包裹后的密钥和验证材料                  |
| 9   | 多设备增量同步         | 没有跨设备的 SPlayer 数据同步协议                             | 新增实体级加密增量同步。每台设备维护设备 ID、递增序号、拉取游标、版本表和离线 outbox，只上传发生变化的实体，而不是每次上传完整数据                                            |
| 10  | 实时同步与离线恢复     | 没有该能力                                                    | 服务端通过 SSE 通知新游标，客户端在上线、页面恢复和定时轮询时同步；失败后指数退避，离线操作保留并在网络恢复后重传                                                             |
| 11  | 并发冲突处理           | 没有多设备冲突模型                                            | 根据因果关系、设备序号、删除优先级和稳定 operation rank 做确定性合并；私人歌单成员逐项合并并保留 tombstone，减少两台设备同时修改时相互覆盖                                    |
| 12  | 同步的数据范围         | 本机保存为主                                                  | 可加密同步收藏歌曲、歌单、专辑、歌手、MV、播客、私人歌单及成员、歌曲详情、播放历史、播放队列、白名单设置、应用状态和快捷键                                                    |
| 13  | Guest 与账户隔离       | 没有 SPlayer 账户作用域                                       | Guest、本项目 SPlayer 账户和网易云 provider 缓存分开保存；退出 SPlayer 账户前会先同步，再恢复本机 Guest 快照，避免不同用户的数据直接混合                                      |
| 14  | 未登录收藏             | 原版主要围绕音乐平台登录数据                                  | 未登录用户可收藏歌曲、专辑、歌单和歌手，也可创建私人歌单；Docker 部署可将游客收藏保存到 `/data/splayer/local-favorites.json`，同一部署中的 Web 客户端可读取这些数据           |
| 15  | 侧边栏收藏入口         | 已有歌单侧栏，但游客数据和收藏专辑展示有限                    | 侧边栏增加收藏专辑，并可展示 Guest 或 SPlayer 账户保存的收藏歌单和专辑；网易云登录用户的数据仍与这些本地/同步数据区分                                                         |
| 16  | 未登录下载             | 下载入口和数据获取更依赖登录状态                              | 允许未登录用户进入下载流程并优先请求公开播放地址；会员、付费和版权限制仍由上游接口决定，本项目不会绕过真实权限限制                                                            |
| 17  | 下载文件名             | 原版提供固定命名选项                                          | 新增文件名模板，可组合 `{title}`、`{artist}`、`{album}`、`{quality}`、`{duration}`、下载日期/时间和发行日期，并处理非法字符、Windows 保留名和长度限制                         |
| 18  | Web 下载回退           | 原版已有桌面下载队列、歌词、封面和标签等能力                  | 保留原版高级下载能力，并为 Web 增加“直连原地址 -> 重新获取播放地址 -> 浏览器原生下载”的回退；不再通过自托管服务器中转音频流量                                                 |
| 19  | 网页音源匹配           | 原版包含多音源解锁和 Electron 内置解锁实现                    | Docker Web 改用 API Enhanced 的 `/song/url/match`，带 5 分钟缓存与并发请求去重；播放顺序为官方地址、匹配地址、最后本地缓存，并移除旧的 Electron 内置酷我/波点等实现           |
| 20  | CORS 播放回退          | Web Audio 遇到部分跨域音源时可能无法完成分析或播放            | 当 Web Audio 无法处理跨域音源时，可回退到不接入音频图谱的原生 `<audio>` 直连播放，优先保证声音可用                                                                            |
| 21  | Docker 服务组成        | 原版已经支持 Docker Web 部署                                  | 单容器进一步整合 Web、网易云 API、SQLite 账户服务、游客收藏服务，以及可选的 Music Together UNM 兼容代理；新增持久化数据卷、健康检查和面向 NAS 的构建内存优化                  |
| 22  | Docker 播放 Cookie     | 通常依赖全局 Cookie 或部署配置                                | 可通过 Docker Secret 注入仅用于歌曲 URL 解析的 `MUSIC_U`，只作用于指定播放接口，不用于歌单、收藏、推荐或账户接口，也不会下发给浏览器                                          |
| 23  | 服务器音频流量         | 曾提供音频代理路径                                            | 旧 `/api/unblock` 返回 404，旧音频代理返回 410；Web 播放和下载直接访问音源，避免 NAS 或自托管服务器承担持续的音频上行带宽                                                     |
| 24  | 移动端布局             | 已有基础移动布局和移动全屏播放器                              | 继续完善刘海/安全区、矮屏、横屏双栏、动态封面、两行导航、全宽搜索、窄屏卡片、详情文字截断和操作按钮换行                                                                       |
| 25  | 移动端手势             | 原版已有迷你播放器滑动切歌、全屏信息页/歌词页切换             | 增加手势开关并调整触发阈值；触摸进度条时阻止页面切换和切歌手势，降低拖动进度时误操作                                                                                          |
| 26  | 播放快捷键             | 原版默认播放/暂停为 `CmdOrCtrl+Space`，并支持自定义           | 默认值改为 `Space`；仅自动迁移仍使用旧默认值的配置，不覆盖用户自定义快捷键；快捷键也可随 SPlayer 账户加密同步                                                                 |
| 27  | 账户服务安全           | 没有本项目账户 API                                            | 增加 Host/同源 Origin 校验、可选 HTTPS 强制、登录与注册限流、请求大小限制、恒定时间比较、哈希会话令牌，以及 `HttpOnly`、`SameSite=Strict` Cookie                              |
| 28  | Android 设备密钥       | 没有该能力                                                    | 在 HTTPS 自托管服务下，可使用 Android Keystore AES-GCM 保护本机自动解锁密钥；HTTP 服务仍可登录和同步，但应用重启后必须重新输入同步密码                                        |
| 29  | 多架构发布             | 原版已有桌面构建流程                                          | 本 fork 的 Release 工作流分别构建 Windows、macOS、Linux 的 x64/arm64 包，合并更新清单，并同时发布 Android APK；打包与 GitHub Release 上传相互分离，避免构建器误发布到上游仓库 |

### 使用边界与安全提示

1. **游客收藏不是私人账户数据。** `/api/local-favorites` 没有用户认证，保存的是当前部署级共享数据。需要用户隔离、跨设备同步或加密时，请使用 SPlayer 账户。
2. **公网部署应使用 HTTPS。** Android 允许连接可信局域网内的 HTTP 服务，但 HTTP 下不会持久化账户保险库解锁密钥。公开网络建议配置可信 HTTPS，并关闭不安全 HTTP 选项。
3. **服务端无法读取同步正文。** 端到端加密保护同步内容，但用户名、会话、设备同步游标、密文大小和操作时间等服务运行所需的元数据不属于隐藏范围。
4. **解灰不等于获取版权。** 音源匹配和播放回退只提高可播放性，不保证所有歌曲可用，也不会消除会员、付费、地区或版权限制。
5. **发布包签名。** `v3.2.4` Android APK 使用 debug 证书签名；桌面包没有商业代码签名，系统可能显示未知开发者或安全提示。安装更新前请核对 Release 页面提供的 SHA-256。

## English

### Comparison baseline

The comparison below uses upstream commit [`40d9ec60`](https://github.com/SPlayer-Dev/SPlayer/commit/40d9ec606cc1e323c964ffea7bf0ab02f137e93b), the last upstream commit before this fork's custom work, as its baseline and compares it with SPlayer-FIX `v3.2.4`. It describes differences from the upstream snapshot at the time of the fork; it does not claim that upstream has not added similar features since then.

At that baseline, upstream SPlayer already included an Electron desktop app, Docker-based Web deployment, song downloads, source unblocking and fallback, a mobile full-screen player, swipe gestures, and configurable shortcuts. The list below only covers behavior that SPlayer-FIX added, extended, or changed on top of that foundation.

### Detailed differences

| #   | Area                           | Upstream baseline                                                                         | SPlayer-FIX v3.2.4                                                                                                                                                                                                                                                 |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Android application            | No standalone Android project or APK pipeline; mobile use primarily relied on the Web app | Adds a Capacitor-based Android application, a dedicated Web build, a Gradle project, and a universal APK release pipeline supporting Android 7.0 (API 24) and newer                                                                                                |
| 2   | Native Android playback        | Relied on browser audio and had no Android media service                                  | Adds an AndroidX Media3/ExoPlayer player and `MediaSessionService` with background playback, lock-screen and notification controls, headset buttons, audio focus, pause-on-unplug, playback speed, and system previous/next actions                                |
| 3   | Android state and seeking      | No native bridge existed                                                                  | The native player continuously reports state to the Web layer. Seek requests use sequence numbers, timeouts, and state validation so stale callbacks are less likely to overwrite a newer scrub position                                                           |
| 4   | Native Android downloads       | No Android-native download service                                                        | Adds a foreground download service with notification progress, HTTP Range, persistent tasks, restart recovery, cancellation, retry, and publication into the system media library                                                                                  |
| 5   | Android file handling          | Used Web or desktop download destinations                                                 | Supports `Download/SPlayer`, a user-selected Storage Access Framework directory, overwrite-or-keep-both conflict handling, and MP3/FLAC title, artist, album, and artwork metadata                                                                                 |
| 6   | Self-hosted server connection  | The Web address was determined by deployment or the browser                               | The Android start screen can enter, probe, save, and switch self-hosted SPlayer servers. It validates the health endpoint, product identity, mobile API version, URL, TLS, and redirects, and restricts Capacitor bridge injection to approved origins             |
| 7   | Independent SPlayer accounts   | Only music-provider login state; no project-owned account system                          | Adds SPlayer registration, login, logout, password changes, recovery keys, password recovery, administrator-issued one-time temporary passwords, and session management. It complements rather than replaces a NetEase account                                     |
| 8   | End-to-end encryption          | No SPlayer account vault                                                                  | The client creates a random 256-bit vault key and encrypts synchronized content with AES-256-GCM. PBKDF2-SHA-256 derives a wrapping key from the password; the server stores ciphertext, wrapped keys, and verification material rather than plaintext content     |
| 9   | Multi-device incremental sync  | No cross-device SPlayer data protocol                                                     | Adds encrypted entity-level incremental sync. Each device keeps an ID, sequence number, pull cursor, version table, and offline outbox, uploading changed entities instead of the complete dataset each time                                                       |
| 10  | Live sync and offline recovery | Not available                                                                             | The server sends new-cursor notifications over SSE. Clients sync when connectivity or the page resumes and use polling as a fallback; failures use exponential backoff, while offline operations remain queued for retry                                           |
| 11  | Concurrent conflict handling   | No multi-device conflict model                                                            | Concurrent operations are merged deterministically using causality, device sequence, deletion priority, and a stable operation rank. Private-playlist members merge independently and retain tombstones to reduce whole-list overwrites                            |
| 12  | Synchronized data              | Primarily stored on the local device                                                      | Encrypted sync covers liked songs, playlists, albums, artists, MVs, podcasts, private playlists and members, song details, history, the play queue, whitelist settings, application state, and shortcuts                                                           |
| 13  | Guest/account isolation        | No SPlayer account scope                                                                  | Guest data, SPlayer account data, and NetEase provider caches are isolated. Logout first attempts a sync and then restores the local Guest snapshot instead of directly mixing users' state                                                                        |
| 14  | Guest favorites                | Primarily centered on music-provider account data                                         | Guests can like songs, albums, playlists, and artists and create private playlists. Docker deployments can persist guest favorites in `/data/splayer/local-favorites.json` for Web clients using the same deployment                                               |
| 15  | Favorites in the sidebar       | Included playlist navigation, with limited guest and liked-album presentation             | Adds liked albums and can show playlists and albums saved by a Guest or SPlayer account. NetEase account data remains separate from this local/synchronized state                                                                                                  |
| 16  | Downloads without login        | Download entry and data retrieval depended more heavily on login state                    | Guests can open the download flow and first request a public playback URL. Membership, payment, and copyright restrictions are still determined by the upstream service and are not bypassed                                                                       |
| 17  | Download file names            | Offered fixed naming choices                                                              | Adds templates using `{title}`, `{artist}`, `{album}`, `{quality}`, `{duration}`, download date/time, and release date, with validation for invalid characters, Windows reserved names, and length limits                                                          |
| 18  | Web download fallback          | Already provided advanced desktop downloads, lyrics, artwork, and tags                    | Keeps those upstream capabilities and adds a Web fallback chain: direct source URL, refreshed playback URL, then native browser download. Audio is not relayed through the self-hosted server                                                                      |
| 19  | Web source matching            | Included multi-source unblocking and Electron-side implementations                        | Docker Web playback now uses API Enhanced `/song/url/match` with a five-minute cache and concurrent-request deduplication. The order is official URL, matched URL, then local cache; legacy built-in Kuwo/Bodian implementations were removed                      |
| 20  | CORS playback fallback         | Some cross-origin sources could fail when routed through Web Audio                        | If Web Audio cannot process a cross-origin source, playback can fall back to a direct native `<audio>` element without audio-visualization routing, prioritizing audible playback                                                                                  |
| 21  | Docker service composition     | Upstream already supported Docker Web deployment                                          | The single container additionally integrates the Web app, NetEase API, SQLite account service, guest-favorites service, and an optional Music Together UNM compatibility proxy, plus a persistent data volume, health checks, and NAS-oriented build-memory limits |
| 22  | Docker playback cookie         | Usually depended on a global cookie or deployment configuration                           | A Docker Secret can provide a dedicated `MUSIC_U` used only by selected song-URL endpoints. It is not used for playlists, favorites, recommendations, or account APIs and is never sent to the browser                                                             |
| 23  | Server audio traffic           | Previously exposed an audio-proxy path                                                    | Legacy `/api/unblock` returns 404 and the old audio proxy returns 410. Web playback and downloads connect to the source directly so the NAS or self-hosted server does not carry continuous outbound audio traffic                                                 |
| 24  | Mobile layout                  | Already had a basic mobile layout and full-screen player                                  | Extends notch/safe-area handling, short-screen and landscape two-column layouts, dynamic artwork sizing, two-row navigation, full-width search, narrow-screen cards, text truncation, and wrapping action controls                                                 |
| 25  | Mobile gestures                | Already supported mini-player swipe-to-skip and full-screen info/lyrics swiping           | Adds a gesture toggle and revised thresholds. Touching the progress bar suppresses page and track-swipe gestures to reduce accidental actions while scrubbing                                                                                                      |
| 26  | Playback shortcut              | Default play/pause was `CmdOrCtrl+Space`, with customization support                      | Changes the default to `Space`. Only configurations still using the old default are migrated, custom bindings are preserved, and shortcuts can be encrypted and synchronized with a SPlayer account                                                                |
| 27  | Account-service security       | No project-owned account API                                                              | Adds Host and same-origin Origin validation, optional HTTPS enforcement, login/registration rate limits, request-size limits, constant-time comparisons, hashed session tokens, and `HttpOnly`, `SameSite=Strict` cookies                                          |
| 28  | Android device keys            | Not available                                                                             | On HTTPS self-hosted servers, Android Keystore AES-GCM protects the local automatic-unlock key. Accounts still work over HTTP, but the sync password must be entered again after every application restart                                                         |
| 29  | Multi-architecture releases    | Upstream already had desktop build automation                                             | This fork builds Windows, macOS, and Linux packages for x64 and arm64, merges update manifests, and publishes an Android APK. Packaging and GitHub Release upload are separated to prevent the builder from publishing to the upstream repository                  |

### Scope and security notes

1. **Guest favorites are not private account data.** `/api/local-favorites` has no per-user authentication and stores deployment-wide shared data. Use a SPlayer account when user isolation, cross-device sync, or encryption is required.
2. **Use HTTPS on public networks.** Android can connect to HTTP on a trusted LAN, but it will not persist the account-vault unlock key over HTTP. Public deployments should use trusted HTTPS and disable insecure HTTP support.
3. **The server cannot read synchronized payloads.** End-to-end encryption protects content, but operational metadata such as usernames, sessions, device cursors, ciphertext sizes, and operation times is not hidden.
4. **Source matching does not grant content rights.** Matching and fallback improve playback availability but do not guarantee access or remove membership, payment, regional, or copyright restrictions.
5. **Release signing.** The `v3.2.4` Android APK is signed with a debug certificate, and desktop packages do not use a commercial code-signing certificate. The operating system may show an unknown-developer warning; verify the SHA-256 value published on the Release page before updating.

<div align="center">
<a href="#splayer-fix">返回顶部 / Back to top</a>
</div>

## 说明

![提示](/screenshots/gitcodes.png)

> [!IMPORTANT]
>
> ### 严肃警告
>
> - 请务必遵守 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可协议
> - 在您的修改、演绎、分发或派生项目中，必须同样采用 **AGPL-3.0** 许可协议，**并在适当的位置包含本项目的许可和版权信息**
> - 若您用于售卖或其他盈利用途，**必须提供本项目的源代码及原项目链接**。另外由于本项目涉及第三方，**售卖后可能遭受法律或诉讼风险**。如若发现违反许可协议，作者保留追究法律责任的权利
> - 禁止在二开项目中修改程序原版权信息（ 您可以添加二开作者信息 ）
> - 感谢您的尊重与理解

- 本项目采用 [Vue 3](https://cn.vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) + [Naïve UI](https://www.naiveui.com/) + [Electron](https://www.electronjs.org/zh/docs/latest/) 开发
- Node.js 版本要求：>= 20，包管理器：pnpm >= 10
- 默认会构建原生模块，需准备 Rust 工具链；如仅需要网页端构建或暂时跳过，可设置环境变量 `SKIP_NATIVE_BUILD=true`
- 支持网页端与客户端，由于设备有限，目前仅保证 Windows 系统的适配，其他平台如遇问题可以提 Issue 或自行解决后选择提 PR
<!-- - 仅对移动端做了基础适配，**不保证功能全部可用** -->

<!--  > 请注意，本程序不打算开发移动端，也不会对移动端进行完美适配，仅保证基础可用性 -->

- 欢迎各位大佬 `Star` 😍

## 🧑‍💻 开发

### 快速开始

1. 安装依赖：`pnpm install`
2. 复制 `.env.example` 为 `.env` 并按需修改
3. 启动开发：`pnpm dev`
4. 构建：
   - `pnpm build`
   - `pnpm build:win`

### 跳过原生模块构建

默认会编译 `native/*` 下的原生模块（需要 Rust）。如果你的场景不需要原生能力，可设置 `SKIP_NATIVE_BUILD=true` 后再执行 `pnpm dev` / `pnpm build`。

## 🖼️ 界面展示

> 开发中，仅供参考

<details>
<summary> 主页面 </summary>

![主页面](/screenshots/SPlayer%20-%20主页面.jpg)

</details>

<details>
<summary> 播放页面 </summary>

![播放页面](/screenshots/SPlayer%20-%20播放页面.jpg)

</details>

<details>
<summary> 发现页面 </summary>

![发现页面](/screenshots/SPlayer%20-%20发现页面.jpg)

</details>

<details>
<summary> 歌单页面 </summary>

![发现页面](/screenshots/SPlayer%20-%20歌单页面.jpg)

</details>

<details>
<summary> 评论页面 </summary>

![发现页面](/screenshots/SPlayer%20-%20评论页面.jpg)

</details>

<details>
<summary> 本地音乐 </summary>

![发现页面](/screenshots/SPlayer%20-%20本地音乐.jpg)

</details>

### 自行部署方案

#### ⚙️ Docker 部署

> 安装及配置 `Docker` 将不在此处说明，请自行解决

##### 本地构建

> 请拉取 Github 仓库文件后使用本地构建

```bash
# 构建
docker build -t splayer .

# 运行
docker run -d --name SPlayer -p 25884:25884 splayer
# 或使用 Docker Compose
docker-compose up -d
```

Docker 镜像内包含网页端以及运行所需的服务，默认通过 `25884` 端口访问。

#### ⚙️ 本地部署

1. 本地部署需要用到 `Node.js`（>= 20），可前往 [Node.js 官网](https://nodejs.org/zh-cn/) 下载安装包，请下载最新稳定版
2. 安装 pnpm（>= 10）

   ```bash
   corepack enable
   # 或
   npm install pnpm -g
   ```

3. 克隆仓库并拉取至本地，此处不再赘述
4. 使用 `pnpm install` 安装项目依赖（若安装过程中遇到网络错误，请使用国内镜像源替代，此处不再赘述）
5. 复制 `.env.example` 文件并重命名为 `.env` 并修改配置（如需跳过原生模块构建，可设置 `SKIP_NATIVE_BUILD=true`）
6. 打包客户端，请依据你的系统类型来选择，打包成功后，会输出安装包或可执行文件在 `/dist` 目录中，可自行安装

   > 默认情况下，构建命令仅会构建当前系统架构的版本。如需构建特定架构（如 x64 + arm64），请在命令后追加参数，例如：`pnpm build:win --x64 --arm64`

   | 命令               | 系统类型 |
   | ------------------ | -------- |
   | `pnpm build:win`   | Windows  |
   | `pnpm build:linux` | Linux    |
   | `pnpm build:mac`   | macOS    |

## 😘 鸣谢

特此感谢为本项目提供支持与灵感的项目：

- [NeteaseCloudMusicApi](https://github.com/neteasecloudmusicapienhanced/api-enhanced)
- [YesPlayMusic](https://github.com/qier222/YesPlayMusic)
- [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server)
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics)
- [Vue-mmPlayer](https://github.com/maomao1996/Vue-mmPlayer)
- [refined-now-playing-netease](https://github.com/solstice23/refined-now-playing-netease)
- [material-color-utilities](https://github.com/material-foundation/material-color-utilities)

## 🗺️ 贡献者联盟

欢迎加入我们 🥰! 一起为 SPlayer 贡献一份力量。
感谢以下所有贡献者 💖

<a href="https://github.com/imsyy/SPlayer/graphs/contributors" target="_blank" rel="noopener">
  <img src="https://contrib.rocks/image?repo=imsyy/SPlayer&max=30&anon=1&v=1"
    alt="SPlayer 项目贡献者"
    width="650"
    loading="lazy"
  />
</a>

## 📢 免责声明

本项目部分功能使用了网易云音乐的第三方 API 服务，**仅供个人学习研究使用，禁止用于商业及非法用途**

同时，本项目开发者承诺 **严格遵守相关法律法规和网易云音乐 API 使用协议，不会利用本项目进行任何违法活动。** 如因使用本项目而引起的任何纠纷或责任，均由使用者自行承担。**本项目开发者不承担任何因使用本项目而导致的任何直接或间接责任，并保留追究使用者违法行为的权利**

请使用者在使用本项目时遵守相关法律法规，**不要将本项目用于任何商业及非法用途。如有违反，一切后果由使用者自负。** 同时，使用者应该自行承担因使用本项目而带来的风险和责任。本项目开发者不对本项目所提供的服务和内容做出任何保证

感谢您的理解

## 📜 开源许可

- **本项目仅供个人学习研究使用，禁止用于商业及非法用途**
- 本项目基于 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可进行开源
  1. **修改和分发：** 任何对本项目的修改和分发都必须基于 AGPL-3.0 进行，源代码必须一并提供
  2. **派生作品：** 任何派生作品必须同样采用 AGPL-3.0，并在适当的地方注明原始项目的许可证
  3. **注明原作者：** 在任何修改、派生作品或其他分发中，必须在适当的位置明确注明原作者及其贡献
  4. **免责声明：** 根据 AGPL-3.0，本项目不提供任何明示或暗示的担保。请详细阅读 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 以了解完整的免责声明内容
  5. **社区参与：** 欢迎社区的参与和贡献，我们鼓励开发者一同改进和维护本项目
  6. **许可证链接：** 请阅读 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 了解更多详情
