package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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
for s in caddy surrealdb; do
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
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}

	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return fmt.Errorf("SSH connection failed: %w", err)
	}

	runner := bootstrap.NewRunner(client)

	if a.stopLog != nil {
		close(a.stopLog)
	}
	a.stopLog = make(chan struct{})

	go func() {
		defer client.Close()
		runtime.EventsEmit(a.ctx, "bootstrap:status", "running")

		err := runner.Execute(func(line string) {
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
