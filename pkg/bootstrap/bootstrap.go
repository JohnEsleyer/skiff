package bootstrap

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"time"

	"skiff/pkg/sshclient"
)

// StackConfig selects which purpose-built stack to provision.
type StackConfig struct {
	StackType      string `json:"stackType"` // "surrealdb" | "postgres" | "mysql" | "base"
	Version        string `json:"version"`   // e.g. "v2.2.1", "16", "10.11" (preset default when empty)
	DbUser         string `json:"dbUser"`
	DbPassword     string `json:"dbPassword"`
	DbName         string `json:"dbName"`
	SurrealStorage string `json:"surrealStorage"` // "surrealkv" | "file" | "rocksdb"
	EnableSwap     bool   `json:"enableSwap"`
	InstallCaddy   bool   `json:"installCaddy"`
}

// GeneratePassword creates a cryptographically secure 20-hex-char password
// for database root accounts. Never fall back to a well-known default.
func GeneratePassword() string {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("skiff-fallback-%d", time.Now().Unix())
	}
	return hex.EncodeToString(b)
}

// DefaultStackConfig provisions a clean-slate SurrealDB engine + Caddy + swap.
// The database starts with NO pre-baked namespaces; each deployed app creates
// its own via its recipe's remote setup steps.
func DefaultStackConfig() StackConfig {
	return StackConfig{
		StackType:      "surrealdb",
		Version:        "v2.2.1",
		DbUser:         "admin",
		DbPassword:     GeneratePassword(),
		DbName:         "",
		SurrealStorage: "surrealkv",
		EnableSwap:     true,
		InstallCaddy:   true,
	}
}

func jsonEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}

func sqlEscape(s string) string {
	return strings.ReplaceAll(s, `'`, `''`)
}

func unitEscape(s string) string {
	return strings.ReplaceAll(s, `%`, `%%`)
}

// GenerateScript builds an idempotent provisioning script for the selected stack.
// Re-running on an already-provisioned host skips existing components.
func GenerateScript(cfg StackConfig) string {
	var s strings.Builder
	s.WriteString("#!/usr/bin/env bash\nset -eo pipefail\nexport DEBIAN_FRONTEND=noninteractive\n\n")

	// 1. System detection
	s.WriteString(`echo "==> [STEP:detect] Inspecting system architecture and resources..."
ARCH=$(uname -m)
OS=$(grep -E '^(ID|VERSION_ID)=' /etc/os-release | paste -sd ' ' -)
echo "    OS: $OS | CPU: $ARCH"
`)

	// 2. Swap space
	if cfg.EnableSwap {
		s.WriteString(`echo "==> [STEP:swap] Checking memory stability & swap..."
CURRENT_SWAP_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
if [ "$CURRENT_SWAP_KB" -gt 500000 ]; then
    echo "    [OK] Swap already active ($((CURRENT_SWAP_KB / 1024))MB). Skipping creation."
else
    echo "    [ACTION] Allocating 1.5GB swapfile..."
    if [ ! -f /swapfile ]; then
        fallocate -l 1536M /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1536
        chmod 600 /swapfile
        mkswap /swapfile
    fi
    swapon /swapfile 2>/dev/null || true
    if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    echo "    [OK] Swap activated."
fi
`)
	}

	// 3. Base utilities + directory skeleton
	s.WriteString(`echo "==> [STEP:deps] Verifying base utilities..."
MISSING=""
for p in curl ca-certificates tar gzip ufw; do
    command -v "$p" &>/dev/null || MISSING="$MISSING $p"
done
if [ -n "$MISSING" ]; then
    apt-get update -qq && apt-get install -y -qq $MISSING
else
    echo "    [OK] Base utilities present."
fi
mkdir -p /opt/skiff/apps /opt/skiff/caddy /opt/skiff/data /opt/skiff/backups
`)

	// 4. Firewall: allow HTTP/HTTPS/Caddy and SurrealDB when UFW is active
	s.WriteString(`echo "==> [STEP:firewall] Configuring firewall access..."
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    echo "    [ACTION] Opening ports 80 (HTTP), 443 (HTTPS), 8000 (Database)..."
    ufw allow 80/tcp comment "HTTP Caddy" 2>/dev/null || true
    ufw allow 443/tcp comment "HTTPS Caddy" 2>/dev/null || true
    ufw allow 8000/tcp comment "SurrealDB" 2>/dev/null || true
else
    echo "    [OK] UFW inactive or not blocking port 8000."
fi
`)

	// 5. Caddy reverse proxy
	if cfg.InstallCaddy {
		s.WriteString(`echo "==> [STEP:caddy] Verifying Caddy reverse proxy..."
if command -v caddy &>/dev/null; then
    echo "    [OK] Caddy is already installed ($(caddy version | head -n 1))."
else
    echo "    [ACTION] Installing Caddy package..."
    apt-get update -qq && apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq && apt-get install -y -qq caddy
fi
systemctl enable --now caddy 2>/dev/null || true
`)
	}

	// 6. Database per stack preset.
	// SurrealDB is a clean slate: no pre-baked namespaces or databases.
	// Each deployed app provisions its own via its recipe's remote setup steps.
	switch cfg.StackType {
	case "surrealdb", "esper":
		user := cfg.DbUser
		if user == "" {
			user = "admin"
		}
		pass := cfg.DbPassword
		if pass == "" {
			pass = GeneratePassword()
		}
		storage := cfg.SurrealStorage
		if storage == "" {
			storage = "surrealkv"
		}
		version := strings.TrimSpace(cfg.Version)
		if version == "" || version == "latest" {
			version = "v2.2.1"
		}
		// Compare without the leading "v": `surreal version` prints "2.2.1".
		wantVer := strings.TrimPrefix(version, "v")

		launchCmd := fmt.Sprintf("surreal start --bind 0.0.0.0:8000 --user %s --pass %s --allow-all %s:/opt/skiff/data/surrealdb/db",
			user, pass, storage)

		s.WriteString(fmt.Sprintf(`echo "==> [STEP:database] Configuring Clean-Slate SurrealDB %s (%s engine)..."
INSTALL_NEEDED=1
if command -v surreal &>/dev/null; then
    CURRENT_V=$(surreal version 2>/dev/null | head -n 1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n 1 || true)
    if [ "$CURRENT_V" = "%s" ]; then
        echo "    [OK] SurrealDB %s is already active."
        INSTALL_NEEDED=0
    fi
fi

if [ "$INSTALL_NEEDED" -eq 1 ]; then
    echo "    [ACTION] Installing SurrealDB %s..."
    curl -sSf https://install.surrealdb.com | sh -s -- --version %s
fi

ACTUAL_V=$(surreal version 2>/dev/null | head -n 1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n 1 || true)
if [ -z "$ACTUAL_V" ]; then ACTUAL_V="%s"; fi
mkdir -p /opt/skiff/data/surrealdb
cat <<'SKIFFEOF' > /opt/skiff/data/surrealdb/info.json
{
  "engine": "SurrealDB",
  "version": "%s",
  "port": 8000,
  "user": "%s",
  "password": "%s",
  "dataPath": "/opt/skiff/data/surrealdb/db",
  "storageType": "%s",
  "command": "%s"
}
SKIFFEOF
# Record the actually installed version (sanitized digits/dots only, sed-safe)
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$ACTUAL_V\"/" /opt/skiff/data/surrealdb/info.json

cat <<SKIFFEOF > /etc/systemd/system/surrealdb.service
[Unit]
Description=SurrealDB Clean Engine (Skiff Managed)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/%s
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SKIFFEOF

systemctl daemon-reload
systemctl enable --now surrealdb
echo "    [OK] SurrealDB $ACTUAL_V active on port 8000 (ws://0.0.0.0:8000/rpc)."
`,
			version, storage,
			wantVer, version,
			version, version,
			version,
			jsonEscape(version), jsonEscape(user), jsonEscape(pass),
			jsonEscape(storage), jsonEscape(launchCmd),
			unitEscape(launchCmd)))

	case "postgres":
		user := cfg.DbUser
		if user == "" {
			user = "skiff_user"
		}
		pass := cfg.DbPassword
		if pass == "" {
			pass = GeneratePassword()
		}
		db := cfg.DbName
		if db == "" {
			db = "skiff_db"
		}

		pgVersion := strings.TrimSpace(cfg.Version)
		if pgVersion == "" {
			pgVersion = "16"
		}

		s.WriteString(fmt.Sprintf(`echo "==> [STEP:database] Configuring PostgreSQL %s..."
# PGDG repository provides all supported major versions on any Ubuntu LTS
if ! grep -rq "apt.postgresql.org" /etc/apt/sources.list.d/ 2>/dev/null; then
    echo "    [ACTION] Adding official PostgreSQL (PGDG) repository..."
    apt-get update -qq && apt-get install -y -qq curl ca-certificates gnupg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor --yes -o /usr/share/keyrings/postgresql.gpg
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" > /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
fi
if ! dpkg -l 2>/dev/null | grep -q "postgresql-%s"; then
    echo "    [ACTION] Installing PostgreSQL %s..."
    apt-get install -y -qq postgresql-%s postgresql-contrib
else
    echo "    [OK] PostgreSQL %s is already installed."
fi

systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER %s WITH PASSWORD '%s';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE %s OWNER %s;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE %s TO %s;" 2>/dev/null || true

ACTUAL_V=$(psql --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -n 1 || true)
mkdir -p /opt/skiff/data/postgres
cat <<'SKIFFEOF' > /opt/skiff/data/postgres/info.json
{
  "engine": "PostgreSQL",
  "version": "%s",
  "port": 5432,
  "user": "%s",
  "password": "%s",
  "database": "%s",
  "dataPath": "/var/lib/postgresql",
  "storageType": "Heap Tables",
  "command": "postgres -D /etc/postgresql/%s/main"
}
SKIFFEOF
[ -n "$ACTUAL_V" ] && sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$ACTUAL_V\"/" /opt/skiff/data/postgres/info.json || true
echo "    [OK] PostgreSQL $ACTUAL_V active on port 5432."
`,
			pgVersion,
			pgVersion, pgVersion, pgVersion, pgVersion,
			sqlEscape(user), sqlEscape(pass), sqlEscape(db), sqlEscape(user),
			sqlEscape(db), sqlEscape(user),
			jsonEscape(pgVersion), jsonEscape(user), jsonEscape(pass), jsonEscape(db),
			pgVersion))

	case "mysql":
		user := cfg.DbUser
		if user == "" {
			user = "skiff_user"
		}
		pass := cfg.DbPassword
		if pass == "" {
			pass = GeneratePassword()
		}
		db := cfg.DbName
		if db == "" {
			db = "skiff_db"
		}
		wantVer := strings.TrimSpace(cfg.Version)
		if wantVer == "" {
			wantVer = "10.11"
		}

		s.WriteString(fmt.Sprintf(`echo "==> [STEP:database] Configuring MariaDB %s..."
if ! command -v mysql &>/dev/null; then
    echo "    [ACTION] Installing MariaDB (distro packages)..."
    apt-get update -qq && apt-get install -y -qq mariadb-server mariadb-client
else
    echo "    [OK] MariaDB is already installed."
fi

systemctl enable --now mariadb
mysql -e "CREATE DATABASE IF NOT EXISTS %s;" 2>/dev/null || true
mysql -e "CREATE USER IF NOT EXISTS '%s'@'localhost' IDENTIFIED BY '%s';" 2>/dev/null || true
mysql -e "GRANT ALL PRIVILEGES ON %s.* TO '%s'@'localhost'; FLUSH PRIVILEGES;" 2>/dev/null || true

# Distro packages decide the exact MariaDB release; record what is real.
ACTUAL_V=$(mariadb --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n 1 || true)
if [ -z "$ACTUAL_V" ]; then ACTUAL_V="%s"; fi
mkdir -p /opt/skiff/data/mysql
cat <<'SKIFFEOF' > /opt/skiff/data/mysql/info.json
{
  "engine": "MariaDB",
  "version": "%s",
  "port": 3306,
  "user": "%s",
  "password": "%s",
  "database": "%s",
  "dataPath": "/var/lib/mysql",
  "storageType": "InnoDB",
  "command": "mysqld_safe --datadir=/var/lib/mysql"
}
SKIFFEOF
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$ACTUAL_V\"/" /opt/skiff/data/mysql/info.json
echo "    [OK] MariaDB $ACTUAL_V active on port 3306."
`,
			wantVer,
			sqlEscape(db), sqlEscape(user), sqlEscape(pass), sqlEscape(db), sqlEscape(user),
			jsonEscape(wantVer),
			jsonEscape(wantVer),
			jsonEscape(user), jsonEscape(pass), jsonEscape(db)))

	default:
		s.WriteString(`echo "==> [STEP:database] Base Stack: no database daemon installed."
`)
	}

	s.WriteString(`echo "==> [STEP:done] Stack provisioned! Server is ready."
`)

	return s.String()
}

// GenerateResetScript tears down all Skiff-managed apps, database daemons,
// Caddy, swap, custom firewall rules, and wipes /opt/skiff back to zero.
// OS packages stay installed (fast re-provision); only Skiff state is razed.
func GenerateResetScript() string {
	return `#!/usr/bin/env bash
set -eo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> [STEP:reset-init] Commencing complete VPS reset to clean slate..."

# 1. Stop and remove all deployed app units
echo "==> [STEP:apps] Stopping and removing deployed app systemd units..."
if [ -d /opt/skiff/apps ]; then
    for app in /opt/skiff/apps/*; do
        if [ -d "$app" ]; then
            APP_NAME=$(basename "$app")
            echo "    [ACTION] Halting app service: $APP_NAME..."
            systemctl stop "$APP_NAME" 2>/dev/null || true
            systemctl disable "$APP_NAME" 2>/dev/null || true
            rm -f "/etc/systemd/system/$APP_NAME.service"
        fi
    done
fi

# 2. Stop database daemons & Caddy, drop Skiff-owned units/binaries
echo "==> [STEP:services] Stopping and disabling managed services..."
for s in surrealdb postgresql mariadb caddy; do
    echo "    [ACTION] Stopping $s..."
    systemctl stop "$s" 2>/dev/null || true
    systemctl disable "$s" 2>/dev/null || true
done
rm -f /etc/systemd/system/surrealdb.service
rm -f /usr/local/bin/surreal

# 3. Swapfile teardown
echo "==> [STEP:swap] Deactivating and removing swapfile..."
if [ -f /swapfile ]; then
    swapoff /swapfile 2>/dev/null || true
    rm -f /swapfile
    sed -i '/\/swapfile/d' /etc/fstab 2>/dev/null || true
    echo "    [OK] Swapfile removed."
else
    echo "    [OK] No swapfile present."
fi

# 4. Custom firewall rules (only rules Skiff added)
echo "==> [STEP:firewall] Cleaning Skiff firewall rules..."
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw delete allow 8000/tcp 2>/dev/null || true
fi

# 5. Wipe all Skiff state
echo "==> [STEP:wipe] Deleting /opt/skiff layout, releases, and databases..."
rm -rf /opt/skiff

# 6. Reload systemd
systemctl daemon-reload
systemctl reset-failed 2>/dev/null || true

echo "==> [STEP:done] Full VPS reset complete! Host is back to clean baseline."
`
}

// Runner streams a provisioning script into `sudo bash` over SSH stdin,
// forwarding every stdout/stderr line to onLine in real time.
type Runner struct {
	client *sshclient.Client
}

func NewRunner(client *sshclient.Client) *Runner {
	return &Runner{client: client}
}

func (b *Runner) ExecuteScript(script string, onLine func(string), stopChan <-chan struct{}) error {
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

	if err := session.Start("sudo bash"); err != nil {
		return fmt.Errorf("failed to invoke sudo bash: %w", err)
	}

	go func() {
		defer stdin.Close()
		_, _ = io.WriteString(stdin, script)
	}()

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

	select {
	case <-stopChan:
		_ = session.Signal(sshclient.SigINT())
		_ = session.Close()
		<-doneScanning
		return fmt.Errorf("bootstrap aborted by user")
	case <-doneScanning:
	}

	return session.Wait()
}
