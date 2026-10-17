<p align="center">
  <img src="frontend/public/icon.svg" alt="Skiff icon" width="160" height="160" />
</p>

# Skiff

The zero-agent desktop deployment engine for low-end servers.

Skiff is a desktop app (Wails v2 + Go backend, React + Tailwind frontend) that builds your
project **locally** and ships pre-compiled artifacts to a VPS over **plain SSH (port 22)**.
The server runs zero PaaS daemons and zero web UIs — it only needs OpenSSH and `systemd`
(or Docker, if you prefer).

**Philosophy: Fat Client, Hollow Server.** The desktop app runs builds and manages
releases; the VPS just receives atomic releases and runs them.

## Features

- **Server manager** — SSH profiles (key or password auth), one-click connection probe
  with a live VPS health report (RAM gauge, disk, uptime).
- **VPS-first workflow** — pick a VPS, open its management board (telemetry, Caddy /
  SurrealDB service controls, deployed-apps list), then ship from the deployments view.
- **Local build pipeline** — ordered build steps (`npm run build`, `cargo build`, ...)
  executed on your machine with real-time log streaming.
- **Tar-over-SSH deploy** — artifacts are compressed in memory and piped straight into
  `tar -xzf -` on the VPS. No `rsync`, no CI service, no agent.
- **Atomic releases** — `/opt/skiff/apps/<app>/releases/<timestamp>` with a `current`
  symlink, shared files (`.env`, `uploads`) symlinked in, old releases pruned.
- **One-click rollback** — repoint `current` at the previous release and restart.
- **Idempotent VPS bootstrap** — swap, Caddy, SurrealDB, and directory skeleton are
  verified and only installed when missing, with a live streaming console.
- **`skiff.json` auto-discovery** — opening a project folder that contains a
  `skiff.json` populates the deployment recipe automatically.

## Project structure

```
skiff/
├── main.go / app.go          # Wails entrypoint + exposed backend API
├── pkg/
│   ├── sshclient/            # Native SSH client, tar streaming, telemetry
│   ├── builder/              # Local subprocess runner with live output
│   ├── deployer/             # Deploy state machine + rollback
│   ├── bootstrap/            # Idempotent VPS provisioner
│   └── store/                # Local server/project profiles (~/.skiff/)
├── frontend/src/
│   ├── App.jsx               # Servers → Manage → Deployments → Logs views
│   └── components/           # Toasts, modals, CustomSelect, manage board
├── wails.json
└── skiff.json                # Example project recipe
```

## Prerequisites

- Go 1.22+
- Node 20+
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- For Rust targets: `rustup target add x86_64-unknown-linux-musl`

## Quickstart

```bash
cd skiff
wails dev      # live development
wails build    # standalone desktop binary
```

1. **Add Server** — VPS IP, user, SSH key. **Probe** it to see the health report.
2. **Bootstrap VPS** once — installs Caddy, SurrealDB, swap, `/opt/skiff` layout.
3. **New recipe** — Browse to a project folder (auto-loads `skiff.json` if present),
   pick the target VPS, adjust build steps and artifacts.
4. **Ship to VPS** — watch preflight → build → transfer → activation → verification.

## skiff.json

Place in the root of any deployable project:

```json
{
  "id": "esper-production",
  "name": "Esper Backend",
  "localPath": ".",
  "serverId": "",
  "appDir": "/opt/skiff/apps/esper",
  "domain": "api.esper.yourdomain.com",
  "targetPort": 8080,
  "tlsMode": "auto",
  "buildSteps": [
    { "name": "Backend", "command": "cargo build --manifest-path server/Cargo.toml --release --target x86_64-unknown-linux-musl" }
  ],
  "artifacts": [
    { "local": "server/target/x86_64-unknown-linux-musl/release/esper-server", "remote": "esper-server" },
    { "local": "server/src/schema.surql", "remote": "schema.surql" },
    { "local": "setup.sh", "remote": "setup.sh" }
  ],
  "remoteSetupSteps": [
    { "name": "Initialize Environment & SurrealDB Schema", "command": "bash setup.sh" }
  ],
  "sharedFiles": [".env", "uploads"],
  "restartCommand": "sudo systemctl restart esper-server && sudo systemctl reload caddy",
  "healthUrl": "http://127.0.0.1:8080/api/health",
  "keepReleases": 3
}
```

`serverId` is filled in by the desktop client when you pick the target VPS.

Use a loopback `healthUrl` (`http://127.0.0.1:<port>/...`) so the
verify step probes over SSH on the VPS itself. Public URLs are probed
from the desktop instead.

## Backend-only + Cloudflare Pages split

Skiff ships whatever `buildSteps` + `artifacts` you declare — so a
backend-only deploy is just a recipe with no frontend build and no
`dist → public` artifact (see `skiff.json` above). The VPS then only
runs the API; static assets live on Cloudflare Pages.

1. **Skiff recipe:** keep only the backend build (e.g. `cargo build`),
   ship only the binary + `schema.surql` + `setup.sh`. Set `domain` to
   the API host (`api.esper.yourdomain.com`), `targetPort: 8080`,
   `healthUrl: http://127.0.0.1:8080/api/health`.
2. **Backend:** drop the `ServeDir("public")` fallback (return JSON 404
   for non-`/api` routes), keep CORS open for the Pages origin
   (including custom headers like `x-guest-token`), and set `BASE_URL`
   in the VPS shared `.env` to `https://api.esper.yourdomain.com` so
   `/uploads/*` URLs resolve to the API domain.
3. **Cloudflare Pages:** framework `Vite`, build `npm run build`,
   output `dist`, env `VITE_WORKER_URL=https://api.esper.yourdomain.com`
   (+ `VITE_CLERK_PUBLISHABLE_KEY`), SPA fallback via `public/_redirects`
   containing `/* /index.html 200`.
4. **DNS:** frontend `esper.yourdomain.com` → Pages (CNAME to
   `<project>.pages.dev`); backend `api.esper.yourdomain.com` → A record
   to VPS IP (Skiff + Caddy own TLS). If orange-cloud proxied, use
   Cloudflare SSL mode Full/Strict; otherwise DNS-only and let Caddy do
   Let's Encrypt.

## VPS Bandwidth Tracking

Each server profile has an optional **Monthly Bandwidth Limit (GB)**. When set,
Skiff reads `/proc/net/dev` over SSH (loopback, `docker*`, `veth*` and bridge
interfaces are excluded), aggregates RX + TX across the real uplink adapters,
and shows live consumption plus a quota percentage on the Manage VPS board and
the diagnostics modal. The bar turns amber past 75% and rose past 90%. Set the
limit to `0` for unmetered plans — bandwidth is still reported, just untracked.

## Installing on Ubuntu (20.04, 22.04, 24.04 LTS)

### 1. Install System Dependencies
Wails v2 requires GTK3 and WebKit2GTK headers on Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev \
    gcc g++ git curl
```
*(If on Ubuntu 20.04, use `libwebkit2gtk-4.0-dev` instead).*

### 2. Build Skiff
```bash
git clone <your-repo> skiff
cd skiff
wails build
```

### 3. Install to System Menu & Path
Run the included installer:
```bash
sudo ./install.sh
```
This puts:
- Binary: `/usr/local/bin/skiff`
- SVG Icon: `/usr/share/icons/hicolor/scalable/apps/skiff.svg`
- Launcher: `/usr/share/applications/skiff.desktop`

You can now search for **"Skiff"** in your Ubuntu GNOME / Dash application
launcher or launch it from any terminal by typing `skiff`.

## License

MIT
