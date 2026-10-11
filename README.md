# SPlayer-FIX

<div align="center">

<img alt="SPlayer-FIX logo" width="100" height="100" src="public/icons/favicon.png" />

<h2>SPlayer-FIX</h2>

<p>A community-maintained SPlayer derivative focused on self-hosted Web, Android, and multi-device synchronization.</p>

**English** | [简体中文](./README.zh-CN.md)

[Releases](https://github.com/ChEnLeo-7/SPlayer-FIX/releases) | [Source](https://github.com/ChEnLeo-7/SPlayer-FIX) | [Upstream](https://github.com/SPlayer-Dev/SPlayer)

</div>

![SPlayer main interface](/screenshots/SPlayer.jpg)

## About This Fork

SPlayer-FIX is a community-maintained derivative of [SPlayer](https://github.com/SPlayer-Dev/SPlayer). It retains the original project's name, copyright notices, and AGPL-3.0 license. This repository is not an official SPlayer release and does not represent the original author or the SPlayer-Dev team.

### Comparison Baseline

The comparison below uses upstream commit [`40d9ec60`](https://github.com/SPlayer-Dev/SPlayer/commit/40d9ec606cc1e323c964ffea7bf0ab02f137e93b), the last upstream commit before this fork's custom work, as its baseline and compares it with SPlayer-FIX `v3.2.4`. It describes differences from the upstream snapshot at the time of the fork; it does not claim that upstream has not added similar features since then.

At that baseline, upstream SPlayer already included an Electron desktop app, Docker-based Web deployment, song downloads, source unblocking and fallback, a mobile full-screen player, swipe gestures, and configurable shortcuts. The list below only covers behavior that SPlayer-FIX added, extended, or changed on top of that foundation.

### Detailed Differences

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

### Scope and Security Notes

1. **Guest favorites are not private account data.** `/api/local-favorites` has no per-user authentication and stores deployment-wide shared data. Use a SPlayer account when user isolation, cross-device sync, or encryption is required.
2. **Use HTTPS on public networks.** Android can connect to HTTP on a trusted LAN, but it will not persist the account-vault unlock key over HTTP. Public deployments should use trusted HTTPS and disable insecure HTTP support.
3. **The server cannot read synchronized payloads.** End-to-end encryption protects content, but operational metadata such as usernames, sessions, device cursors, ciphertext sizes, and operation times is not hidden.
4. **Source matching does not grant content rights.** Matching and fallback improve playback availability but do not guarantee access or remove membership, payment, regional, or copyright restrictions.
5. **Release signing.** The `v3.2.4` Android APK is signed with a debug certificate, and desktop packages do not use a commercial code-signing certificate. The operating system may show an unknown-developer warning; verify the SHA-256 value published on the Release page before updating.

## Important Notice

> [!IMPORTANT]
>
> - You must comply with the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html).
> - Modified, distributed, or derivative versions must use AGPL-3.0 and retain the appropriate license and copyright notices.
> - If the project is sold or otherwise used for profit, the complete source code and a link to the original project must be provided. Third-party services may introduce additional legal risk.
> - Do not remove or alter the original copyright information. You may add attribution for your derivative work.

- Built with [Vue 3](https://vuejs.org/), [TypeScript](https://www.typescriptlang.org/), [Naive UI](https://www.naiveui.com/), and [Electron](https://www.electronjs.org/).
- Requires Node.js >= 20 and pnpm >= 10.
- Native modules are built by default and require a Rust toolchain. Set `SKIP_NATIVE_BUILD=true` when native capabilities are not needed.
- Web and desktop clients are supported. Windows receives the most compatibility testing because available test devices are limited.

## Development

### Quick Start

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` and adjust it as needed.
3. Start development with `pnpm dev`.
4. Build with `pnpm build` or `pnpm build:win`.

### Skipping Native Modules

The native modules under `native/*` are compiled by default and require Rust. Set `SKIP_NATIVE_BUILD=true` before running `pnpm dev` or `pnpm build` when native capabilities are not required.

## Screenshots

> Work in progress; screenshots are for reference only.

<details>
<summary>Main page</summary>

![Main page](/screenshots/SPlayer%20-%20主页面.jpg)

</details>

<details>
<summary>Player</summary>

![Player](/screenshots/SPlayer%20-%20播放页面.jpg)

</details>

<details>
<summary>Discover</summary>

![Discover](/screenshots/SPlayer%20-%20发现页面.jpg)

</details>

<details>
<summary>Playlist</summary>

![Playlist](/screenshots/SPlayer%20-%20歌单页面.jpg)

</details>

<details>
<summary>Comments</summary>

![Comments](/screenshots/SPlayer%20-%20评论页面.jpg)

</details>

<details>
<summary>Local music</summary>

![Local music](/screenshots/SPlayer%20-%20本地音乐.jpg)

</details>

## Deployment

### Docker Web Deployment

Build and run the image locally:

```bash
docker build -t splayer .
docker run -d --name SPlayer -p 25884:25884 splayer

# Alternatively, use Docker Compose
docker-compose up -d
```

The image contains the Web client and required services. It listens on port `25884` by default.

### Local Desktop Build

1. Install Node.js >= 20 and pnpm >= 10.
2. Clone the repository.
3. Run `pnpm install`.
4. Copy `.env.example` to `.env` and adjust it as needed.
5. Run the build command for the target platform. Artifacts are written to `dist/`.

By default, the current architecture is built. Pass architecture flags when needed, for example `pnpm build:win --x64 --arm64`.

| Command            | Platform |
| ------------------ | -------- |
| `pnpm build:win`   | Windows  |
| `pnpm build:linux` | Linux    |
| `pnpm build:mac`   | macOS    |

## Acknowledgements

- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced)
- [YesPlayMusic](https://github.com/qier222/YesPlayMusic)
- [UnblockNeteaseMusic](https://github.com/UnblockNeteaseMusic/server)
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics)
- [Vue-mmPlayer](https://github.com/maomao1996/Vue-mmPlayer)
- [refined-now-playing-netease](https://github.com/solstice23/refined-now-playing-netease)
- [material-color-utilities](https://github.com/material-foundation/material-color-utilities)

## Contributors

Thanks to everyone who has contributed to SPlayer.

<a href="https://github.com/imsyy/SPlayer/graphs/contributors" target="_blank" rel="noopener">
  <img src="https://contrib.rocks/image?repo=imsyy/SPlayer&max=30&anon=1&v=1"
    alt="SPlayer contributors"
    width="650"
    loading="lazy"
  />
</a>

## Disclaimer

Some features use third-party NetEase Cloud Music API services. This project is intended for personal learning and research only and must not be used for commercial or unlawful purposes.

Users are responsible for complying with applicable laws, regulations, and the terms of the relevant services. The project developers make no warranty and accept no liability for direct or indirect consequences arising from use of the project.

## License

This project is licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html). Modified and derivative works must also use AGPL-3.0, provide their complete source code, retain the original attribution, and include the applicable license notices.
