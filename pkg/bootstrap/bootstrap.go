package bootstrap

import (
	"bufio"
	"fmt"
	"io"
	"strings"

	"skiff/pkg/sshclient"
)

// StackConfig selects which purpose-built stack to provision.
type StackConfig struct {
	StackType      string `json:"stackType"` // "esper" | "postgres" | "mysql" | "base"
	DbUser         string `json:"dbUser"`
	DbPassword     string `json:"dbPassword"`
	DbName         string `json:"dbName"`
	SurrealStorage string `json:"surrealStorage"` // "surrealkv" | "file" | "rocksdb"
	SurrealNS      string `json:"surrealNs"`
	EnableSwap     bool   `json:"enableSwap"`
	InstallCaddy   bool   `json:"installCaddy"`
}

// DefaultStackConfig provisions the Esper stack (SurrealDB + Caddy + swap).
func DefaultStackConfig() StackConfig {
	return StackConfig{
		StackType:      "esper",
		DbUser:         "root",
		DbPassword:     "root",
		DbName:         "production",
		SurrealStorage: "surrealkv",
		SurrealNS:      "esper",
		EnableSwap:     true,
		InstallCaddy:   true,
	}
}

// jsonEscape makes a string safe for embedding in double-quoted JSON.
func jsonEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}

// sqlEscape escapes single quotes for SQL string literals.
func sqlEscape(s string) string {
	return strings.ReplaceAll(s, `'`, `''`)
}

// unitEscape escapes percent signs for systemd unit files.
func unitEscape(s string) string {
	return strings.ReplaceAll(s, `%`, `%%`)
}

// GenerateScript builds an idempotent provisioning script for the given stack.
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
for p in curl ca-certificates tar gzip; do
    command -v "$p" &>/dev/null || MISSING="$MISSING $p"
done
if [ -n "$MISSING" ]; then
    apt-get update -qq && apt-get install -y -qq $MISSING
else
    echo "    [OK] Base utilities present."
fi
mkdir -p /opt/skiff/apps /opt/skiff/caddy /opt/skiff/data /opt/skiff/backups
`)

	// 4. Caddy reverse proxy
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

	// 5. Database per stack preset
	switch cfg.StackType {
	case "esper", "surrealdb":
		user := cfg.DbUser
		if user == "" {
			user = "root"
		}
		pass := cfg.DbPassword
		if pass == "" {
			pass = "root"
		}
		ns := cfg.SurrealNS
		if ns == "" {
			ns = "esper"
		}
		db := cfg.DbName
		if db == "" {
			db = "production"
		}
		storage := cfg.SurrealStorage
		if storage == "" {
			storage = "surrealkv"
		}

		launchCmd := fmt.Sprintf("surreal start --bind 0.0.0.0:8000 --user %s --pass %s %s:/opt/skiff/data/surrealdb/db",
			user, pass, storage)

		s.WriteString(fmt.Sprintf(`echo "==> [STEP:database] Configuring SurrealDB (%s engine)..."
if ! command -v surreal &>/dev/null; then
    echo "    [ACTION] Fetching SurrealDB binary..."
    curl -sSf https://install.surrealdb.com | sh
else
    echo "    [OK] SurrealDB already installed ($(surreal version | head -n 1))."
fi

mkdir -p /opt/skiff/data/surrealdb
cat <<'SKIFFEOF' > /opt/skiff/data/surrealdb/info.json
{
  "engine": "SurrealDB",
  "port": 8000,
  "user": "%s",
  "password": "%s",
  "namespace": "%s",
  "database": "%s",
  "dataPath": "/opt/skiff/data/surrealdb/db",
  "storageType": "%s",
  "command": "%s"
}
SKIFFEOF

cat <<SKIFFEOF > /etc/systemd/system/surrealdb.service
[Unit]
Description=SurrealDB Engine (Skiff Managed)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/%s
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SKIFFEOF

systemctl daemon-reload
systemctl enable --now surrealdb
echo "    [OK] SurrealDB service active on port 8000 (ws://0.0.0.0:8000/rpc)."
`,
			storage,
			jsonEscape(user), jsonEscape(pass), jsonEscape(ns), jsonEscape(db),
			jsonEscape(storage), jsonEscape(launchCmd),
			unitEscape(launchCmd)))

	case "postgres":
		user := cfg.DbUser
		if user == "" {
			user = "skiff_user"
		}
		pass := cfg.DbPassword
		if pass == "" {
			pass = "skiff_secure_pass"
		}
		db := cfg.DbName
		if db == "" {
			db = "skiff_db"
		}

		s.WriteString(fmt.Sprintf(`echo "==> [STEP:database] Configuring PostgreSQL 16 (Low-RAM Tuned)..."
if ! command -v psql &>/dev/null; then
    echo "    [ACTION] Installing PostgreSQL..."
    apt-get update -qq && apt-get install -y -qq postgresql postgresql-contrib
else
    echo "    [OK] PostgreSQL is already installed."
fi

systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER %s WITH PASSWORD '%s';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE %s OWNER %s;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE %s TO %s;" 2>/dev/null || true

mkdir -p /opt/skiff/data/postgres
cat <<'SKIFFEOF' > /opt/skiff/data/postgres/info.json
{
  "engine": "PostgreSQL 16",
  "port": 5432,
  "user": "%s",
  "password": "%s",
  "database": "%s",
  "dataPath": "/var/lib/postgresql",
  "storageType": "Heap Tables",
  "command": "postgres -D /etc/postgresql/16/main"
}
SKIFFEOF
echo "    [OK] PostgreSQL active on port 5432."
`,
			sqlEscape(user), sqlEscape(pass), sqlEscape(db), sqlEscape(user),
			sqlEscape(db), sqlEscape(user),
			jsonEscape(user), jsonEscape(pass), jsonEscape(db)))

	case "mysql":
		user := cfg.DbUser
		if user == "" {
			user = "skiff_user"
		}
		pass := cfg.DbPassword
		if pass == "" {
			pass = "skiff_secure_pass"
		}
		db := cfg.DbName
		if db == "" {
			db = "skiff_db"
		}

		s.WriteString(fmt.Sprintf(`echo "==> [STEP:database] Configuring MariaDB / MySQL (Low-RAM Tuned)..."
if ! command -v mysql &>/dev/null; then
    echo "    [ACTION] Installing MariaDB..."
    apt-get update -qq && apt-get install -y -qq mariadb-server mariadb-client
else
    echo "    [OK] MariaDB is already installed."
fi

systemctl enable --now mariadb
mysql -e "CREATE DATABASE IF NOT EXISTS %s;"
mysql -e "CREATE USER IF NOT EXISTS '%s'@'localhost' IDENTIFIED BY '%s';"
mysql -e "GRANT ALL PRIVILEGES ON %s.* TO '%s'@'localhost'; FLUSH PRIVILEGES;"

mkdir -p /opt/skiff/data/mysql
cat <<'SKIFFEOF' > /opt/skiff/data/mysql/info.json
{
  "engine": "MariaDB/MySQL",
  "port": 3306,
  "user": "%s",
  "password": "%s",
  "database": "%s",
  "dataPath": "/var/lib/mysql",
  "storageType": "InnoDB",
  "command": "mysqld_safe --datadir=/var/lib/mysql"
}
SKIFFEOF
echo "    [OK] MariaDB/MySQL active on port 3306."
`,
			sqlEscape(db), sqlEscape(user), sqlEscape(pass), sqlEscape(db), sqlEscape(user),
			jsonEscape(user), jsonEscape(pass), jsonEscape(db)))

	default: // "base" — no database daemon
		s.WriteString(`echo "==> [STEP:database] Base Stack selected: no dedicated database installed (apps use SQLite or remote DB)."
`)
	}

	s.WriteString(`echo "==> [STEP:done] Stack provisioned! Server is ready."
`)

	return s.String()
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
