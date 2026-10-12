package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"skiff/pkg/bootstrap"
	"skiff/pkg/deployer"
	"skiff/pkg/sshclient"
	"skiff/pkg/store"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ServiceStatus struct {
	Name    string `json:"name"`
	Active  bool   `json:"active"`
	Running bool   `json:"running"`
	Status  string `json:"status"` // e.g. "active", "inactive"
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

	checkServicesCmd := `sh -c '
for s in caddy surrealdb postgresql mariadb; do
  STATUS=$(systemctl is-active $s 2>/dev/null || echo "inactive")
  echo "$s:$STATUS"
done
echo "---"
ls -1 /opt/skiff/apps 2>/dev/null || true
'`
	out, _ := client.RunCommand(checkServicesCmd)

	services := make([]ServiceStatus, 0)
	deployedApps := make([]string, 0)

	parts := strings.Split(out, "---")
	if len(parts) >= 1 {
		for _, l := range strings.Split(strings.TrimSpace(parts[0]), "\n") {
			pair := strings.SplitN(strings.TrimSpace(l), ":", 2)
			if len(pair) == 2 && pair[0] != "" {
				isActive := pair[1] == "active"
				services = append(services, ServiceStatus{
					Name:    pair[0],
					Active:  isActive,
					Running: isActive,
					Status:  pair[1],
				})
			}
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

// ----------------- Database Management -----------------

type DatabaseInfo struct {
	Engine           string `json:"engine"`
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
		dumpCmd = fmt.Sprintf("surreal export --conn http://127.0.0.1:%d --user %s --pass %s --ns %s --db %s %s",
			info.Port,
			shellSingleQuote(info.User), shellSingleQuote(info.Password),
			shellSingleQuote(info.Namespace), shellSingleQuote(info.Database),
			shellSingleQuote(remoteFile))
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
