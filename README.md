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
  "name": "Esper Notes",
  "localPath": ".",
  "serverId": "",
  "appDir": "/opt/skiff/apps/esper",
  "buildSteps": [
    { "name": "Frontend", "command": "npm run build" },
    { "name": "Backend", "command": "cargo build --manifest-path server/Cargo.toml --release --target x86_64-unknown-linux-musl" }
  ],
  "artifacts": [
    { "local": "dist", "remote": "public" },
    { "local": "server/target/x86_64-unknown-linux-musl/release/esper-server", "remote": "esper-server" }
  ],
  "sharedFiles": [".env", "uploads"],
  "restartCommand": "sudo systemctl restart esper-server && sudo systemctl reload caddy",
  "healthUrl": "http://127.0.0.1:8080/api/health",
  "keepReleases": 3
}
```

`serverId` is filled in by the desktop client when you pick the target VPS.

## License

MIT
