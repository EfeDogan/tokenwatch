# TokenWatch

Track your AI coding subscription usage from the GNOME top panel — session, weekly and monthly
limits with live reset countdowns, in a clean, native popup.

TokenWatch brings the OpenUsage-style menu bar experience to Linux: pin the metric you care about
next to the clock, click the gauge to see every window, and never guess how much of your plan is
left.

> **Not affiliated with OpenUsage, Anthropic, OpenAI or OpenCode.** An independent, open-source
> panel indicator.

## Supported providers

| Provider | Metrics | Credential source |
|---|---|---|
| OpenCode (Go) | Session (5h), Weekly, Monthly | `~/.local/share/opencode/auth.json` (`opencode-go`) |
| Claude | Session (5h), Weekly | `~/.claude/.credentials.json` (Claude Code login) |
| Codex | Session (5h), Weekly | `~/.codex/auth.json` (Codex CLI login) |

Sign in with each provider's CLI as usual — TokenWatch picks up the login automatically, with no
extra authentication step. Providers that are not signed in show a quiet "Not logged in" state.

## Features

- **Panel pin** — icon plus a color-coded percentage per provider (green < 70%, amber < 90%,
  red ≥ 90%). Choose which metric each provider pins in preferences.
- **Dashboard popup** — one section per provider with progress bars, percentages and reset
  countdowns (`2d 14h`).
- **Stale-while-revalidate** — cached values render instantly; data refreshes every 5 minutes
  (configurable, 1–30 min) and whenever you open the popup after it went stale.
- **Preferences** — refresh interval, panel position, per-provider toggles and pinned metrics.
- **Zero setup** — no daemon, no background service, no browser. Runs entirely inside GNOME Shell.

## Privacy

TokenWatch reads your provider credential files **read-only, locally**, and sends them only to the
corresponding provider's own usage API. Nothing is collected, tracked or sent anywhere else.

## Installation

### From extensions.gnome.org

*(link pending review — will appear here once published)*

### Manual install

Requirements: GNOME Shell 50 (Ubuntu 26.04 or any distribution shipping GNOME 50).

```bash
git clone https://github.com/EfeDogan/tokenwatch.git
cd tokenwatch
./build.sh     # produces build/tokenwatch@efedogan.zip
./install.sh   # installs to ~/.local/share/gnome-shell/extensions and enables it
```

Then log out and back in (Wayland), or restart the shell on X11 (Alt+F2, `r`). Verify with
`gnome-extensions info tokenwatch@efedogan` — state should be `ACTIVE`.

## Development

```bash
./build.sh     # compile schemas + zip
./install.sh   # install + enable locally
```

A headless smoke test without disturbing your session:

```bash
dbus-run-session -- \
  env G_MESSAGES_DEBUG=all gnome-shell --headless --virtual-monitor 1600x900
# then in another terminal of that session:
gdbus call --session --dest org.gnome.Shell.Extensions \
  --object-path /org/gnome/Shell/Extensions \
  --method org.gnome.Shell.Extensions.GetExtensionInfo "tokenwatch@efedogan"
```

## License

[MIT](LICENSE)
