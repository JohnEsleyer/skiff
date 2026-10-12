package main

import (
	"context"
	"fmt"

	"skiff/pkg/bootstrap"
	"skiff/pkg/deployer"
	"skiff/pkg/sshclient"
	"skiff/pkg/store"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

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
		return err
	}
	defer client.Close()

	return bootstrap.RunBootstrap(client, func(log string) {
		runtime.EventsEmit(a.ctx, "deploy:log", log)
	})
}
