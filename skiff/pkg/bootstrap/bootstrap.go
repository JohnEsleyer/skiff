package bootstrap

import (
	"bufio"
	"fmt"
	"io"
	"strings"

	"skiff/pkg/sshclient"
)

// IdempotentBootstrapScript safely verifies and configures the VPS without
// destructively re-creating components. Re-running on an already-provisioned
// host detects existing installations and skips them.
const IdempotentBootstrapScript = `#!/usr/bin/env bash
set -eo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "==> [STEP:detect] Detecting system specifications..."
ARCH=$(uname -m)
OS=$(grep -E '^(ID|VERSION_ID)=' /etc/os-release | paste -sd ' ' -)
echo "    Operating System: $OS"
echo "    CPU Architecture: $ARCH"

echo "==> [STEP:swap] Checking virtual memory & swap space..."
CURRENT_SWAP_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
if [ "$CURRENT_SWAP_KB" -gt 500000 ]; then
    SWAP_MB=$((CURRENT_SWAP_KB / 1024))
    echo "    [OK] Active swap space found: ${SWAP_MB}MB. Skipping swap creation."
else
    echo "    [ACTION] Creating and enabling 1.5GB swapfile..."
    if [ ! -f /swapfile ]; then
        fallocate -l 1536M /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1536
        chmod 600 /swapfile
        mkswap /swapfile
    fi
    swapon /swapfile 2>/dev/null || true
    if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    echo "    [OK] Swapfile activated successfully."
fi

echo "==> [STEP:deps] Verifying essential runtime tools..."
MISSING_PKGS=""
for pkg in curl ca-certificates tar gzip; do
    if ! command -v "$pkg" &>/dev/null; then
        MISSING_PKGS="$MISSING_PKGS $pkg"
    fi
done

if [ -n "$MISSING_PKGS" ]; then
    echo "    [ACTION] Installing missing utilities:$MISSING_PKGS..."
    apt-get update -qq
    apt-get install -y -qq $MISSING_PKGS
else
    echo "    [OK] Standard utilities present (curl, tar, gzip, ca-certificates)."
fi

echo "==> [STEP:caddy] Checking Caddy reverse proxy..."
if command -v caddy &>/dev/null; then
    CADDY_VER=$(caddy version | head -n 1)
    echo "    [OK] Caddy is already installed ($CADDY_VER). Skipping installation."
else
    echo "    [ACTION] Adding official Caddy repository..."
    apt-get update -qq
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy
    echo "    [OK] Caddy installed successfully."
fi

echo "==> [STEP:surrealdb] Checking SurrealDB database engine..."
if command -v surreal &>/dev/null; then
    SURREAL_VER=$(surreal version | head -n 1)
    echo "    [OK] SurrealDB is already installed ($SURREAL_VER). Skipping installation."
else
    echo "    [ACTION] Installing SurrealDB binary..."
    curl -sSf https://install.surrealdb.com | sh
    echo "    [OK] SurrealDB installed."
fi

echo "==> [STEP:dirs] Verifying Skiff directory structure..."
mkdir -p /opt/skiff/apps
mkdir -p /opt/skiff/caddy
mkdir -p /opt/skiff/data

if [ ! -f /opt/skiff/caddy/Caddyfile ]; then
    echo "    [ACTION] Creating default placeholder Caddyfile..."
    cat <<'EOF' > /opt/skiff/caddy/Caddyfile
:80 {
    respond "Skiff host ready. Deploy an app to configure domain." 200
}
EOF
fi
echo "    [OK] Deployment directories confirmed (/opt/skiff)."

echo "==> [STEP:systemd] Verifying background service daemons..."
systemctl is-active --quiet caddy && echo "    [OK] Caddy service is active." || systemctl start caddy || true

echo "==> [STEP:done] VPS Bootstrap finished successfully! System is ready for Skiff deployments."
`

// BootstrapRunner streams the idempotent script into `sudo bash` over SSH
// stdin and forwards every stdout/stderr line to onLine in real time.
type BootstrapRunner struct {
	client *sshclient.Client
}

func NewRunner(client *sshclient.Client) *BootstrapRunner {
	return &BootstrapRunner{client: client}
}

func (b *BootstrapRunner) Execute(onLine func(string), stopChan <-chan struct{}) error {
	session, err := b.client.GetRawSSHClient().NewSession()
	if err != nil {
		return fmt.Errorf("failed to open SSH session: %w", err)
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to establish stdin pipe: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to establish stdout pipe: %w", err)
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to establish stderr pipe: %w", err)
	}

	// Start bash with sudo privileges; the script arrives via stdin.
	if err := session.Start("sudo bash"); err != nil {
		return fmt.Errorf("failed to invoke sudo bash: %w", err)
	}

	// Stream script into stdin asynchronously so large scripts never block.
	go func() {
		defer stdin.Close()
		_, _ = io.WriteString(stdin, IdempotentBootstrapScript)
	}()

	// Read stdout and stderr simultaneously with a roomy buffer for
	// long apt/dpkg progress lines.
	scanner := bufio.NewScanner(io.MultiReader(stdout, stderr))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	doneScanning := make(chan struct{})

	go func() {
		defer close(doneScanning)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.TrimSpace(line) != "" {
				onLine(line)
			}
		}
	}()

	// Wait for completion or user cancellation.
	select {
	case <-stopChan:
		_ = session.Signal(sshclient.SigINT())
		_ = session.Close()
		<-doneScanning
		return fmt.Errorf("bootstrap aborted by user")
	case <-doneScanning:
	}

	if err := session.Wait(); err != nil {
		return fmt.Errorf("bootstrap script exited with error: %w", err)
	}

	return nil
}
