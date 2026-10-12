package bootstrap

import (
	"skiff/pkg/sshclient"
)

// Script installs Caddy, SurrealDB, configures directories, and enables swap
const BootstrapScript = `#!/usr/bin/env bash
set -euo pipefail

echo "==> 1. Enabling 1.5GB Swap for memory stability..."
if [ ! -f /swapfile ]; then
    fallocate -l 1536M /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1536
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> 2. Installing Caddy (Zero-overhead reverse proxy)..."
if ! command -v caddy &> /dev/null; then
    apt-get update -qq
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
fi

echo "==> 3. Installing SurrealDB..."
if ! command -v surreal &> /dev/null; then
    curl -sSf https://install.surrealdb.com | sh
fi

echo "==> 4. Setting up Skiff directory root..."
mkdir -p /opt/skiff/apps

echo "==> VPS bootstrap completed successfully!"
`

func RunBootstrap(client *sshclient.Client, onLog func(string)) error {
	// One-shot synchronous execution; streams combined output via onLog.
	out, err := client.RunCommand("sudo bash -c '" + escapeForSingleQuotes(BootstrapScript) + "'")
	if out != "" && onLog != nil {
		onLog(out)
	}
	return err
}

func escapeForSingleQuotes(s string) string {
	out := ""
	for _, r := range s {
		if r == '\'' {
			out += "'\\''"
		} else {
			out += string(r)
		}
	}
	return out
}
