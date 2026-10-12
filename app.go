package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"skiff/pkg/bootstrap"
	"skiff/pkg/deployer"
	"skiff/pkg/sshclient"
	"skiff/pkg/store"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// versionRegexp extracts the first version-like token (e.g. 2.2.1, 16.4)
// from `<binary> --version` output.
var versionRegexp = regexp.MustCompile(`[0-9]+\.[0-9]+(\.[0-9]+)?`)

type ServiceStatus struct {
	Name    string `json:"name"`
	Active  bool   `json:"active"`
	Running bool   `json:"running"`
	Status  string `json:"status"` // e.g. "active", "inactive"
	Version string `json:"version,omitempty"`
}

type ServerOverview struct {
	Telemetry    *sshclient.Telemetry `json:"telemetry"`
	Services     []ServiceStatus      `json:"services"`
	DeployedApps []string             `json:"deployedApps"`
}

type App struct {
	ctx      context.Context
	store    *store.Manager
	pipeline *deployer.Pipeline
	stopLog  chan struct{}
}

func NewApp() *App {
	mgr, _ := store.NewManager()
	return &App{store: mgr}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.pipeline = deployer.NewPipeline(a.store, func(event string, data any) {
		runtime.EventsEmit(a.ctx, event, data)
	})
}

// ----------------- Native OS Dialogs & Config Discovery -----------------

// SelectFolderDialog opens the native OS directory chooser.
func (a *App) SelectFolderDialog() (string, error) {
	selectedDir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Project Directory",
	})
	if err != nil {
		return "", err
	}
	return selectedDir, nil
}

// ReadSkiffConfigFromPath checks for skiff.json (or .skiff.json) in the
// folder and parses it into a ProjectConfig.
func (a *App) ReadSkiffConfigFromPath(folderPath string) (*store.ProjectConfig, error) {
	if folderPath == "" {
		return nil, fmt.Errorf("empty folder path")
	}

	candidates := []string{
		filepath.Join(folderPath, "skiff.json"),
		filepath.Join(folderPath, ".skiff.json"),
	}

	var foundPath string
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			foundPath = c
			break
		}
	}

	if foundPath == "" {
		return nil, fmt.Errorf("no skiff.json found in folder")
	}

	data, err := os.ReadFile(foundPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s: %w", foundPath, err)
	}

	var cfg store.ProjectConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("malformed skiff.json: %w", err)
	}

	// The opened folder is authoritative for the local path.
	cfg.LocalPath = folderPath
	return &cfg, nil
}

// ----------------- VPS Management & Telemetry -----------------

// GetServerOverview returns telemetry, core service states, and the list of
// deployed apps under /opt/skiff/apps in a single SSH session.
func (a *App) GetServerOverview(serverID string) (*ServerOverview, error) {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return nil, err
	}

	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	tele, err := client.GetTelemetry()
	if err != nil {
		return nil, err
	}

	// Only report services whose systemd unit actually exists on the host.
	// `systemctl is-active` alone cannot distinguish "installed but stopped"
	// from "never installed" (both are non-active), so gate on `systemctl cat`
	// succeeding. Also discover per-app services matching /opt/skiff/apps/*.
	// Live binary versions are captured for the management UI.
	checkServicesCmd := `sh -c '
CANDIDATES="caddy surrealdb postgresql mariadb mysql"
for s in $CANDIDATES; do
  if systemctl cat "$s.service" 2>/dev/null || [ -d "/opt/skiff/data/$s" ]; then
    STATUS=$(systemctl is-active "$s" 2>/dev/null || echo "stopped")
    VERSION=""
    case "$s" in
      surrealdb)
        VERSION=$(surreal version 2>/dev/null | head -n 1 | grep -oE "[0-9]+\.[0-9]+(\.[0-9]+)?" | head -n 1 || true)
        ;;
      caddy)
        VERSION=$(caddy version 2>/dev/null | head -n 1 | grep -oE "v?[0-9]+\.[0-9]+(\.[0-9]+)?" | head -n 1 || true)
        ;;
      postgresql)
        VERSION=$(psql --version 2>/dev/null | head -n 1 | grep -oE "[0-9]+\.[0-9]+" | head -n 1 || true)
        ;;
      mariadb|mysql)
        VERSION=$(mariadb --version 2>/dev/null | head -n 1 | grep -oE "[0-9]+\.[0-9]+(\.[0-9]+)?" | head -n 1 || true)
        ;;
    esac
    echo "service:$s:$STATUS:$VERSION"
  fi
done
if [ -d /opt/skiff/apps ]; then
  for app in /opt/skiff/apps/*; do
    if [ -d "$app" ]; then
      APP_NAME=$(basename "$app")
      if systemctl cat "$APP_NAME.service" 2>/dev/null; then
        STATUS=$(systemctl is-active "$APP_NAME" 2>/dev/null || echo "stopped")
        echo "appservice:$APP_NAME:$STATUS:"
      fi
    fi
  done
fi
echo "---"
ls -1 /opt/skiff/apps 2>/dev/null || true
'`
	out, _ := client.RunCommand(checkServicesCmd)

	services := make([]ServiceStatus, 0)
	deployedApps := make([]string, 0)

	parts := strings.Split(out, "---")
	if len(parts) >= 1 {
		for _, l := range strings.Split(strings.TrimSpace(parts[0]), "\n") {
			if strings.TrimSpace(l) == "" {
				continue
			}
			fields := strings.SplitN(strings.TrimSpace(l), ":", 4)
			if len(fields) < 3 {
				continue
			}
			kind, name, st := fields[0], fields[1], strings.TrimSpace(fields[2])
			version := ""
			if len(fields) >= 4 {
				version = strings.TrimSpace(fields[3])
			}
			if name == "" {
				continue
			}
			isActive := st == "active"

			// App daemons are labeled so the UI can strip the suffix
			// before issuing systemctl commands.
			displayName := name
			if kind == "appservice" {
				displayName = fmt.Sprintf("%s (App)", name)
			}

			services = append(services, ServiceStatus{
				Name:    displayName,
				Active:  isActive,
				Running: isActive,
				Status:  st,
				Version: version,
			})
		}
	}

	if len(parts) >= 2 {
		for _, app := range strings.Split(strings.TrimSpace(parts[1]), "\n") {
			if trimmed := strings.TrimSpace(app); trimmed != "" {
				deployedApps = append(deployedApps, trimmed)
			}
		}
	}

	return &ServerOverview{
		Telemetry:    tele,
		Services:     services,
		DeployedApps: deployedApps,
	}, nil
}

// ControlServerService runs `sudo systemctl <action> <service>` on the VPS.
func (a *App) ControlServerService(serverID, serviceName, action string) error {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}

	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return err
	}
	defer client.Close()

	switch action {
	case "start", "stop", "restart", "reload":
		// allowed
	default:
		return fmt.Errorf("invalid service action: %s", action)
	}

	cmd := fmt.Sprintf("sudo systemctl %s %s", action, serviceName)
	_, err = client.RunCommand(cmd)
	return err
}

// ----------------- Wails Exposed RPC Methods -----------------

func (a *App) GetServers() []store.ServerConfig {
	return a.store.GetServers()
}

func (a *App) SaveServer(s store.ServerConfig) error {
	return a.store.SaveServer(s)
}

func (a *App) DeleteServer(id string) error {
	return a.store.DeleteServer(id)
}

func (a *App) TestServerConnection(s store.ServerConfig) (*sshclient.Telemetry, error) {
	client, err := sshclient.NewClient(s)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	return client.GetTelemetry()
}

func (a *App) GetProjects() []store.ProjectConfig {
	return a.store.GetProjects()
}

func (a *App) SaveProject(p store.ProjectConfig) error {
	return a.store.SaveProject(p)
}

func (a *App) DeployProject(projectID string) error {
	projects := a.store.GetProjects()
	for _, p := range projects {
		if p.ID == projectID {
			go func(proj store.ProjectConfig) {
				if err := a.pipeline.Execute(proj); err != nil {
					runtime.EventsEmit(a.ctx, "deploy:error", err.Error())
				}
			}(p)
			return nil
		}
	}
	return fmt.Errorf("project not found")
}

func (a *App) RollbackProject(projectID string) error {
	projects := a.store.GetProjects()
	for _, p := range projects {
		if p.ID == projectID {
			return a.pipeline.Rollback(p)
		}
	}
	return fmt.Errorf("project not found")
}

func (a *App) StartLogStream(serverID, command string) error {
	if a.stopLog != nil {
		close(a.stopLog)
	}
	a.stopLog = make(chan struct{})

	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return err
	}

	go func() {
		defer client.Close()
		_ = client.StreamLogs(command, func(line string) {
			runtime.EventsEmit(a.ctx, "remote:log", line)
		}, a.stopLog)
	}()
	return nil
}

func (a *App) StopLogStream() {
	if a.stopLog != nil {
		close(a.stopLog)
		a.stopLog = nil
	}
}

func (a *App) BootstrapVPS(serverID string) error {
	return a.BootstrapVPSWithStack(serverID, bootstrap.DefaultStackConfig())
}

// BootstrapVPSWithStack provisions the VPS with the selected stack preset,
// streaming live output via bootstrap:log / bootstrap:status events.
func (a *App) BootstrapVPSWithStack(serverID string, cfg bootstrap.StackConfig) error {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}

	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return fmt.Errorf("SSH connection failed: %w", err)
	}

	script := bootstrap.GenerateScript(cfg)
	runner := bootstrap.NewRunner(client)

	if a.stopLog != nil {
		close(a.stopLog)
	}
	a.stopLog = make(chan struct{})

	go func() {
		defer client.Close()
		runtime.EventsEmit(a.ctx, "bootstrap:status", "running")

		err := runner.ExecuteScript(script, func(line string) {
			runtime.EventsEmit(a.ctx, "bootstrap:log", line)
		}, a.stopLog)

		if err != nil {
			runtime.EventsEmit(a.ctx, "bootstrap:status", "failed")
			runtime.EventsEmit(a.ctx, "bootstrap:error", err.Error())
		} else {
			runtime.EventsEmit(a.ctx, "bootstrap:status", "success")
		}
	}()

	return nil
}

func (a *App) CancelBootstrap() {
	if a.stopLog != nil {
		close(a.stopLog)
		a.stopLog = nil
	}
}

// ResetVPS wipes all Skiff-managed state from the server back to a clean
// baseline, streaming progress via reset:log / reset:status / reset:error.
func (a *App) ResetVPS(serverID string) error {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}

	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return fmt.Errorf("SSH connection failed: %w", err)
	}

	script := bootstrap.GenerateResetScript()
	runner := bootstrap.NewRunner(client)

	if a.stopLog != nil {
		close(a.stopLog)
	}
	a.stopLog = make(chan struct{})

	go func() {
		defer client.Close()
		runtime.EventsEmit(a.ctx, "reset:status", "running")

		err := runner.ExecuteScript(script, func(line string) {
			runtime.EventsEmit(a.ctx, "reset:log", line)
		}, a.stopLog)

		if err != nil {
			runtime.EventsEmit(a.ctx, "reset:status", "failed")
			runtime.EventsEmit(a.ctx, "reset:error", err.Error())
		} else {
			runtime.EventsEmit(a.ctx, "reset:status", "success")
		}
	}()

	return nil
}

// ----------------- Database Management -----------------

type DatabaseInfo struct {
	Engine           string `json:"engine"`
	Version          string `json:"version,omitempty"`
	Port             int    `json:"port"`
	User             string `json:"user"`
	Password         string `json:"password"`
	Database         string `json:"database"`
	Namespace        string `json:"namespace,omitempty"`
	StorageType      string `json:"storageType"`
	DataPath         string `json:"dataPath"`
	Command          string `json:"command"`
	ConnectionString string `json:"connectionString"`
	SurrealistURI    string `json:"surrealistUri,omitempty"`
	Active           bool   `json:"active"`
}

// dbLiveVersion queries the database binary for its actual version.
// Falls back to "" when the binary is missing or unparsable.
func dbLiveVersion(client *sshclient.Client, dbType string) string {
	var probe string
	switch dbType {
	case "surrealdb":
		probe = "surreal version 2>/dev/null | head -n 1"
	case "postgres":
		probe = "psql --version 2>/dev/null | head -n 1"
	case "mysql":
		probe = "mariadb --version 2>/dev/null | head -n 1 || mysql --version 2>/dev/null | head -n 1"
	default:
		return ""
	}
	out, err := client.RunCommand(probe)
	if err != nil {
		return ""
	}
	return versionRegexp.FindString(out)
}

// dbServiceName maps a skiff dbType to its systemd unit.
func dbServiceName(dbType string) string {
	switch dbType {
	case "postgres":
		return "postgresql"
	case "mysql":
		return "mariadb"
	default:
		return dbType // surrealdb
	}
}

// readDatabaseInfo loads /opt/skiff/data/<dbType>/info.json from the VPS.
func readDatabaseInfo(client *sshclient.Client, dbType string) (*DatabaseInfo, error) {
	cmd := fmt.Sprintf("cat /opt/skiff/data/%s/info.json 2>/dev/null || echo '{}'", dbType)
	raw, err := client.RunCommand(cmd)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(raw) == "{}" || strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("database info for %s not found on VPS (was it provisioned?)", dbType)
	}

	var info DatabaseInfo
	if err := json.Unmarshal([]byte(raw), &info); err != nil {
		return nil, fmt.Errorf("malformed database info for %s: %w", dbType, err)
	}
	return &info, nil
}

// GetDatabaseInfo returns connection details, storage backend, launch command
// and live service state for a managed database.
func (a *App) GetDatabaseInfo(serverID, dbType string) (*DatabaseInfo, error) {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return nil, err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	info, err := readDatabaseInfo(client, dbType)
	if err != nil {
		return nil, err
	}

	status, _ := client.RunCommand(fmt.Sprintf("systemctl is-active %s 2>/dev/null || echo inactive", dbServiceName(dbType)))
	info.Active = strings.TrimSpace(status) == "active"

	// Prefer the live binary version over the provision-time record.
	if live := dbLiveVersion(client, dbType); live != "" {
		info.Version = live
	}

	switch dbType {
	case "surrealdb":
		info.SurrealistURI = fmt.Sprintf("ws://%s:%d/rpc", srv.Host, info.Port)
		info.ConnectionString = fmt.Sprintf("http://%s:%s@%s:%d/sql", info.User, info.Password, srv.Host, info.Port)
	case "postgres":
		info.ConnectionString = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=prefer",
			info.User, info.Password, srv.Host, info.Port, info.Database)
	case "mysql":
		info.ConnectionString = fmt.Sprintf("mysql://%s:%s@%s:%d/%s",
			info.User, info.Password, srv.Host, info.Port, info.Database)
	}

	return info, nil
}

// shellSingleQuote wraps a value in single quotes for remote shell use.
func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// BackupAndDownloadDatabase dumps the remote database, then streams the dump
// file over SSH into a local file chosen via the native save dialog.
// Returns the local path, or an error (including user cancellation).
func (a *App) BackupAndDownloadDatabase(serverID, dbType string) (string, error) {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return "", err
	}

	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return "", err
	}
	defer client.Close()

	timestamp := time.Now().Format("20060102_150405")
	var defaultFilename, dumpCmd, remoteFile string

	switch dbType {
	case "surrealdb":
		info, err := readDatabaseInfo(client, dbType)
		if err != nil {
			return "", err
		}
		defaultFilename = fmt.Sprintf("surreal_backup_%s.surql", timestamp)
		remoteFile = fmt.Sprintf("/opt/skiff/backups/surrealdb_backup_%s.surql", timestamp)
		dumpCmd = fmt.Sprintf("surreal export --conn http://127.0.0.1:%d --user %s --pass %s",
			info.Port,
			shellSingleQuote(info.User), shellSingleQuote(info.Password))
		// Scope the export only when the engine tracks a namespace/database
		// (clean-slate engines leave these empty; export then covers all).
		if info.Namespace != "" && info.Database != "" {
			dumpCmd += fmt.Sprintf(" --ns %s --db %s",
				shellSingleQuote(info.Namespace), shellSingleQuote(info.Database))
		}
		dumpCmd += " " + shellSingleQuote(remoteFile)
	case "postgres":
		defaultFilename = fmt.Sprintf("postgres_backup_%s.sql", timestamp)
		remoteFile = fmt.Sprintf("/opt/skiff/backups/postgres_backup_%s.sql", timestamp)
		dumpCmd = fmt.Sprintf("sudo -u postgres pg_dumpall > %s", shellSingleQuote(remoteFile))
	case "mysql":
		defaultFilename = fmt.Sprintf("mysql_backup_%s.sql", timestamp)
		remoteFile = fmt.Sprintf("/opt/skiff/backups/mysql_backup_%s.sql", timestamp)
		dumpCmd = fmt.Sprintf("sudo mysqldump --all-databases > %s", shellSingleQuote(remoteFile))
	default:
		return "", fmt.Errorf("unsupported database type: %s", dbType)
	}

	// 1. Local save destination (native dialog; empty = user cancelled)
	localPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Database Backup",
		DefaultFilename: defaultFilename,
	})
	if err != nil || localPath == "" {
		return "", fmt.Errorf("backup cancelled")
	}

	// 2. Run the remote dump
	if _, err := client.RunCommand(fmt.Sprintf("mkdir -p /opt/skiff/backups && %s", dumpCmd)); err != nil {
		return "", fmt.Errorf("remote database dump failed: %w", err)
	}

	// 3. Stream the dump file down over SSH
	session, err := client.GetRawSSHClient().NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	stdout, err := session.StdoutPipe()
	if err != nil {
		return "", err
	}

	if err := session.Start(fmt.Sprintf("cat %s", shellSingleQuote(remoteFile))); err != nil {
		return "", err
	}

	outFile, err := os.Create(localPath)
	if err != nil {
		return "", err
	}
	defer outFile.Close()

	if _, err := io.Copy(outFile, stdout); err != nil {
		return "", fmt.Errorf("download interrupted: %w", err)
	}

	if err := session.Wait(); err != nil {
		return "", fmt.Errorf("download failed: %w", err)
	}

	return localPath, nil
}
