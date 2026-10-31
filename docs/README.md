<p align="center">
    <img src="banner.png" alt="sxPanel" width="600">
</p>

<p align="center">
    <b>A full-featured web panel & in-game menu to manage and monitor your FiveM/RedM server.</b>
</p>

<p align="center">
    <a href="https://github.com/Snipzil/sxpanel/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Snipzil/sxpanel?style=flat-square&color=blue&cacheSeconds=3600" alt="License"></a>
    <a href="https://github.com/Snipzil/sxpanel/releases"><img src="https://img.shields.io/github/v/release/Snipzil/sxpanel?style=flat-square&color=green" alt="Release"></a>
    <a href="https://github.com/Snipzil/sxpanel/stargazers"><img src="https://img.shields.io/github/stars/Snipzil/sxpanel?style=flat-square" alt="Stars"></a>
    <a href="https://discord.gg/hUM3pQeGFc"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a>
    <a href="https://sxpanel.org/docs"><img src="https://img.shields.io/badge/docs-sxpanel.org-blue?style=flat-square" alt="Docs"></a>
</p>

<p align="center">
    <a href="https://sxpanel.org">Website</a> •
    <a href="https://sxpanel.org/docs">Documentation</a> •
    <a href="https://sxpanel.org/docs/quick-start">Quick Start</a> •
    <a href="https://discord.gg/hUM3pQeGFc">Discord</a> •
    <a href="https://github.com/Snipzil/sxpanel/releases">Releases</a> •
    <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

**sxPanel** is a full overhaul built on top of [txAdmin](https://github.com/tabarra/txAdmin) — designed as a **drop-in replacement** with full compatibility for existing txAdmin servers, databases, and configurations.

> **Migrating?** Just replace the `monitor` folder in your FXServer artifacts with the sxPanel build. Existing `txData` directories work without modification.

<!-- Replace with an actual screenshot of your panel -->
<!-- <p align="center"><img src="screenshot.png" alt="sxPanel Dashboard" width="800"></p> -->

## Highlights

<table>
<tr>
<td width="50%" valign="top">

### Web Panel

- Live console with block-based buffer & lazy-loading
- Server performance charts (CPU, memory, threads)
- CFG editor & validator with dark mode UI
- Real-time playerlist with fuzzy search & tag filtering

</td>
<td width="50%" valign="top">

### In-Game Menu

- Player Mode: NoClip, God, SuperJump
- Teleport, Vehicle, Heal, Announcements
- Live Spectate from the web panel
- Built-in screenshot capture (no `screenshot-basic`)
- Ban/Warn/DM with editable durations

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Insights & Analytics

- Player count & memory timeline (up to 96h)
- Retention metrics (1d / 7d / 30d)
- Peak hours heatmap & playtime distribution
- Admin actions timeline & session stats
- Server uptime and disconnect reasons

</td>
<td width="50%" valign="top">

### Player Management

- Warning & Ban system with full history
- Whitelist (Discord, License, Role, Admin-only)
- Auto-tags + up to 20 custom tags via resource exports
- Activity heatmap, risk assessment, name history
- Self-contained database — no MySQL required

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Access Control

- Login via Cfx.re or password
- 40+ granular permissions with presets
- Per-admin statistics & action logging
- Structured JSONL system logger

</td>
<td width="50%" valign="top">

### Discord Integration

- Auto-updated status embed with custom footer
- `/status`, `/whitelist`, `/info`, `/admininfo`, `/warn`, `/kick`, `/ban`, `/unban`, `/notes`, `/history` commands
- Notifications for reports, bans, crashes, whitelist

</td>
</tr>
</table>

**Plus:** Recipe-based server deployer (<60s) with GitHub token support & headless CLI • Artifact management • Scheduled restarts with postponable temp schedules • Report system with Discord notifications • 30+ languages • [Full feature list →](https://sxpanel.org/docs/features)

## Quick Start

**1.** Download the [latest release](https://github.com/Snipzil/sxpanel/releases).

**2.** Replace the `monitor/` folder in your FXServer artifacts with the sxPanel build.

**3.** Start FXServer **without** `+exec server.cfg` — sxPanel starts automatically.

**4.** Open the URL shown in the console to set up your account and server.

> See the [Configuration docs](https://sxpanel.org/docs/configuration) for environment variables and advanced options.
> Listen to sxPanel server events in your resources with the [Events API](https://sxpanel.org/docs/events-api).

## Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) before getting started.

- All PRs target the `dev` branch
- Join the [Discord](https://discord.gg/hUM3pQeGFc) before starting significant work
- See the [Contributing Guide](CONTRIBUTING.md) for build & dev setup

## License

[MIT](LICENSE) — Originally created by [tabarra](https://github.com/tabarra) as [txAdmin](https://github.com/tabarra/txAdmin).

---

<p align="center">
    <sub>Built with ❤️ by <a href="https://github.com/Snipzil">snipz</a> and <a href="https://github.com/Snipzil/sxpanel/graphs/contributors">contributors</a></sub>
</p>
