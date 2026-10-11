# SPlayer-FIX

<div align="center">

<img alt="SPlayer-FIX 标志" width="100" height="100" src="public/icons/favicon.png" />

<h2>SPlayer-FIX</h2>

<p>面向自托管 Web、Android 和多设备同步场景的 SPlayer 社区派生版本。</p>

[English](./README.en.md) | **简体中文**

[下载](https://github.com/ChEnLeo-7/SPlayer-FIX/releases) | [源码](https://github.com/ChEnLeo-7/SPlayer-FIX) | [原版](https://github.com/SPlayer-Dev/SPlayer)

</div>

![SPlayer 主界面](/screenshots/SPlayer.jpg)

## 关于本项目

SPlayer-FIX 是基于 [SPlayer](https://github.com/SPlayer-Dev/SPlayer) 的社区派生版本，保留原项目的名称、版权信息和 AGPL-3.0 许可证。本项目不是原版 SPlayer 的官方版本，也不代表原作者或 SPlayer-Dev 团队。

### 与原版的比较基线

以下差异以本 fork 开始定制前的原版提交 [`40d9ec60`](https://github.com/SPlayer-Dev/SPlayer/commit/40d9ec606cc1e323c964ffea7bf0ab02f137e93b) 为基线，对比当前 SPlayer-FIX `v3.2.4`。这是“相对分叉时原版快照”的说明，不表示上游项目后续没有加入相似功能。

原版在该基线中已经具备 Electron 桌面客户端、Docker Web 部署、歌曲下载、音源解锁与回退、移动端全屏播放器、滑动操作和快捷键配置。下文只列 SPlayer-FIX 在这些基础上新增、扩展或改变的行为。

### 详细差异

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

## 说明

> [!IMPORTANT]
>
> - 请务必遵守 [GNU Affero General Public License（AGPL-3.0）](https://www.gnu.org/licenses/agpl-3.0.html)许可协议。
> - 修改、演绎、分发或派生项目必须继续采用 AGPL-3.0，并保留适当的许可和版权信息。
> - 若用于售卖或其他盈利用途，必须提供完整源代码及原项目链接。由于本项目涉及第三方服务，商业使用可能产生额外法律风险。
> - 禁止删除或修改原版权信息；可以增加二次开发者信息。

- 本项目采用 [Vue 3](https://cn.vuejs.org/)、[TypeScript](https://www.typescriptlang.org/)、[Naive UI](https://www.naiveui.com/) 和 [Electron](https://www.electronjs.org/zh/docs/latest/) 开发。
- Node.js 版本要求为 >= 20，pnpm 版本要求为 >= 10。
- 默认会构建原生模块，需要 Rust 工具链；不需要原生能力时可设置 `SKIP_NATIVE_BUILD=true`。
- 支持 Web 端和桌面客户端。由于测试设备有限，目前 Windows 的兼容性验证最充分。

## 开发

### 快速开始

1. 使用 `pnpm install` 安装依赖。
2. 复制 `.env.example` 为 `.env` 并按需修改。
3. 使用 `pnpm dev` 启动开发环境。
4. 使用 `pnpm build` 或 `pnpm build:win` 构建。

### 跳过原生模块构建

默认会编译 `native/*` 下的原生模块，需要 Rust 工具链。如果不需要原生能力，可设置 `SKIP_NATIVE_BUILD=true` 后再执行 `pnpm dev` 或 `pnpm build`。

## 界面展示

> 开发中，仅供参考。

<details>
<summary>主页面</summary>

![主页面](/screenshots/SPlayer%20-%20主页面.jpg)

</details>

<details>
<summary>播放页面</summary>

![播放页面](/screenshots/SPlayer%20-%20播放页面.jpg)

</details>

<details>
<summary>发现页面</summary>

![发现页面](/screenshots/SPlayer%20-%20发现页面.jpg)

</details>

<details>
<summary>歌单页面</summary>

![歌单页面](/screenshots/SPlayer%20-%20歌单页面.jpg)

</details>

<details>
<summary>评论页面</summary>

![评论页面](/screenshots/SPlayer%20-%20评论页面.jpg)

</details>

<details>
<summary>本地音乐</summary>

![本地音乐](/screenshots/SPlayer%20-%20本地音乐.jpg)

</details>

## 部署

### Docker Web 部署

在本地构建并运行镜像：

```bash
docker build -t splayer .
docker run -d --name SPlayer -p 25884:25884 splayer

# 也可以使用 Docker Compose
docker-compose up -d
```

镜像包含 Web 端及运行所需的服务，默认通过 `25884` 端口访问。

### 本地构建桌面客户端

1. 安装 Node.js >= 20 和 pnpm >= 10。
2. 克隆本仓库。
3. 执行 `pnpm install`。
4. 复制 `.env.example` 为 `.env` 并按需修改。
5. 根据目标平台执行构建命令，产物会生成到 `dist/`。

默认只构建当前系统架构。如需指定架构，可追加参数，例如 `pnpm build:win --x64 --arm64`。

| 命令               | 系统    |
| ------------------ | ------- |
| `pnpm build:win`   | Windows |
| `pnpm build:linux` | Linux   |
| `pnpm build:mac`   | macOS   |

## 鸣谢

- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced)
- [YesPlayMusic](https://github.com/qier222/YesPlayMusic)
- [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server)
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics)
- [Vue-mmPlayer](https://github.com/maomao1996/Vue-mmPlayer)
- [refined-now-playing-netease](https://github.com/solstice23/refined-now-playing-netease)
- [material-color-utilities](https://github.com/material-foundation/material-color-utilities)

## 贡献者

感谢所有为 SPlayer 作出贡献的开发者。

<a href="https://github.com/imsyy/SPlayer/graphs/contributors" target="_blank" rel="noopener">
  <img src="https://contrib.rocks/image?repo=imsyy/SPlayer&max=30&anon=1&v=1"
    alt="SPlayer 项目贡献者"
    width="650"
    loading="lazy"
  />
</a>

## 免责声明

本项目部分功能使用网易云音乐第三方 API 服务，仅供个人学习研究使用，禁止用于商业及非法用途。

使用者应遵守相关法律法规及服务协议，并自行承担使用本项目带来的风险和责任。本项目不提供任何明示或暗示的保证，开发者不承担因使用本项目产生的直接或间接责任。

## 开源许可

本项目基于 [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html) 开源。修改版和派生作品必须继续采用 AGPL-3.0，提供完整源代码，保留原作者署名，并包含适用的许可证信息。
