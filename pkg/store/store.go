package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type ServerConfig struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	AuthType   string `json:"authType"` // "key" or "password"
	KeyPath    string `json:"keyPath,omitempty"`
	KeyContent string `json:"keyContent,omitempty"`
	Password   string `json:"password,omitempty"`
	// BandwidthLimitGB is the provider's monthly transfer allowance in GB.
	// Zero means the plan is unmetered (bandwidth is reported but not tracked).
	BandwidthLimitGB int `json:"bandwidthLimitGb,omitempty"`
}

type ArtifactRule struct {
	Local  string `json:"local"`  // relative to project root
	Remote string `json:"remote"` // relative to release root
}

type BuildStep struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

type EnvVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type ProjectConfig struct {
	ID               string         `json:"id"`
	Name             string         `json:"name"`
	LocalPath        string         `json:"localPath"`
	ServerID         string         `json:"serverId"`
	AppDir           string         `json:"appDir"` // e.g. /opt/skiff/apps/esper
	Domain           string         `json:"domain,omitempty"`
	TargetPort       int            `json:"targetPort,omitempty"`
	TLSMode          string         `json:"tlsMode,omitempty"`
	BuildSteps       []BuildStep    `json:"buildSteps"`
	Artifacts        []ArtifactRule `json:"artifacts"`
	SharedFiles      []string       `json:"sharedFiles"`
	RemoteSetupSteps []BuildStep    `json:"remoteSetupSteps,omitempty"`
	RestartCommand   string         `json:"restartCommand"`
	HealthURL        string         `json:"healthUrl"`
	KeepReleases     int            `json:"keepReleases"`
	EnvVars          []EnvVar       `json:"envVars,omitempty"`
	Env              string         `json:"env,omitempty"`
}

type AppData struct {
	Servers  []ServerConfig  `json:"servers"`
	Projects []ProjectConfig `json:"projects"`
}

type Manager struct {
	filePath string
	mu       sync.Mutex
	data     AppData
}

func NewManager() (*Manager, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".skiff")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	filePath := filepath.Join(dir, "config.json")

	mgr := &Manager{filePath: filePath}
	_ = mgr.load()
	return mgr, nil
}

func (m *Manager) load() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	bytes, err := os.ReadFile(m.filePath)
	if err != nil {
		m.data = AppData{Servers: []ServerConfig{}, Projects: []ProjectConfig{}}
		return nil
	}
	return json.Unmarshal(bytes, &m.data)
}

func (m *Manager) save() error {
	bytes, err := json.MarshalIndent(m.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.filePath, bytes, 0600)
}

func (m *Manager) GetServers() []ServerConfig {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.data.Servers
}

func (m *Manager) SaveServer(srv ServerConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for i, s := range m.data.Servers {
		if s.ID == srv.ID {
			m.data.Servers[i] = srv
			found = true
			break
		}
	}
	if !found {
		m.data.Servers = append(m.data.Servers, srv)
	}
	return m.save()
}

func (m *Manager) DeleteServer(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	filtered := make([]ServerConfig, 0)
	for _, s := range m.data.Servers {
		if s.ID != id {
			filtered = append(filtered, s)
		}
	}
	m.data.Servers = filtered
	return m.save()
}

func (m *Manager) GetProjects() []ProjectConfig {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.data.Projects
}

func (m *Manager) SaveProject(proj ProjectConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for i, p := range m.data.Projects {
		if p.ID == proj.ID {
			m.data.Projects[i] = proj
			found = true
			break
		}
	}
	if !found {
		m.data.Projects = append(m.data.Projects, proj)
	}
	return m.save()
}

func (m *Manager) DeleteProject(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	filtered := make([]ProjectConfig, 0)
	for _, p := range m.data.Projects {
		if p.ID != id {
			filtered = append(filtered, p)
		}
	}
	m.data.Projects = filtered
	return m.save()
}

func (m *Manager) DeleteProjectsByServer(serverID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	filtered := make([]ProjectConfig, 0)
	for _, p := range m.data.Projects {
		if p.ServerID != serverID {
			filtered = append(filtered, p)
		}
	}
	m.data.Projects = filtered
	return m.save()
}

func (m *Manager) GetServer(id string) (*ServerConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.data.Servers {
		if s.ID == id {
			cpy := s
			return &cpy, nil
		}
	}
	return nil, fmt.Errorf("server %s not found", id)
}
