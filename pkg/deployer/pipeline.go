package deployer

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"skiff/pkg/builder"
	"skiff/pkg/sshclient"
	"skiff/pkg/store"
)

type Pipeline struct {
	builder   *builder.Runner
	store     *store.Manager
	emitEvent func(event string, data any)
}

func NewPipeline(mgr *store.Manager, emitter func(string, any)) *Pipeline {
	return &Pipeline{
		builder:   builder.NewRunner(),
		store:     mgr,
		emitEvent: emitter,
	}
}

func (p *Pipeline) log(msg string) {
	if p.emitEvent != nil {
		p.emitEvent("deploy:log", msg)
	}
}

func (p *Pipeline) step(stepName string, status string) {
	if p.emitEvent != nil {
		p.emitEvent("deploy:step", map[string]string{"step": stepName, "status": status})
	}
}

// RemoteDbCredentials holds the bootstrapped database login used to
// inject environment variables into remote setup steps.
type RemoteDbCredentials struct {
	User     string
	Password string
	Port     int
}

// discoverRemoteDbCredentials reads /opt/skiff/data/surrealdb/info.json when
// present. Missing file (e.g. base stack) yields empty credentials — setup
// scripts must tolerate that.
func discoverRemoteDbCredentials(client *sshclient.Client, p *Pipeline) RemoteDbCredentials {
	var creds RemoteDbCredentials
	raw, _ := client.RunCommand("cat /opt/skiff/data/surrealdb/info.json 2>/dev/null || echo '{}'")
	if strings.TrimSpace(raw) == "" || strings.TrimSpace(raw) == "{}" {
		return creds
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return creds
	}
	if u, ok := parsed["user"].(string); ok {
		creds.User = u
	}
	if pw, ok := parsed["password"].(string); ok {
		creds.Password = pw
	}
	if port, ok := parsed["port"].(float64); ok {
		creds.Port = int(port)
	}
	if creds.Port == 0 {
		creds.Port = 8000
	}
	if creds.User != "" {
		p.log(fmt.Sprintf("  [INFO] Discovered VPS database credentials for user '%s'", creds.User))
	}
	return creds
}

func (p *Pipeline) Execute(project store.ProjectConfig) error {
	p.log(fmt.Sprintf("=== Initiating Deployment for '%s' ===", project.Name))

	// 1. Resolve Server
	server, err := p.store.GetServer(project.ServerID)
	if err != nil {
		return err
	}

	// 2. Preflight SSH Check
	p.step("preflight", "running")
	p.log(fmt.Sprintf("Connecting to %s@%s:%d...", server.User, server.Host, server.Port))
	client, err := sshclient.NewClient(*server)
	if err != nil {
		p.step("preflight", "failed")
		return fmt.Errorf("ssh connection failed: %w", err)
	}
	defer client.Close()

	releaseID := time.Now().UTC().Format("20060102_150405")
	releaseDir := fmt.Sprintf("%s/releases/%s", project.AppDir, releaseID)
	sharedDir := fmt.Sprintf("%s/shared", project.AppDir)

	// Ensure remote skeleton directories
	setupCmd := fmt.Sprintf("mkdir -p %s %s", shellQuote(releaseDir), shellQuote(sharedDir))
	for _, s := range project.SharedFiles {
		if strings.Contains(s, "/") {
			setupCmd += fmt.Sprintf(" %s", shellQuote(fmt.Sprintf("%s/%s", sharedDir, s)))
		}
	}
	if _, err := client.RunCommand(setupCmd); err != nil {
		p.step("preflight", "failed")
		return fmt.Errorf("remote directory setup failed: %w", err)
	}

	// Discover bootstrapped database credentials for remote setup injection.
	dbCreds := discoverRemoteDbCredentials(client, p)
	p.step("preflight", "success")

	// 3. Run Local Build Steps
	p.step("build", "running")
	for idx, b := range project.BuildSteps {
		p.log(fmt.Sprintf("[%d/%d] Executing: %s", idx+1, len(project.BuildSteps), b.Name))
		err := p.builder.RunCommand(project.LocalPath, b.Command, func(line string) {
			p.log("  " + line)
		})
		if err != nil {
			p.step("build", "failed")
			return fmt.Errorf("local build failed: %w", err)
		}
	}
	p.step("build", "success")

	// 4. In-Memory Streaming Transfer (Tar-over-SSH)
	p.step("transfer", "running")
	p.log(fmt.Sprintf("Streaming build artifacts to %s...", releaseDir))
	err = client.StreamTarOverSSH(project.LocalPath, project.Artifacts, releaseDir, func(msg string) {
		p.log("  " + msg)
	})
	if err != nil {
		p.step("transfer", "failed")
		return fmt.Errorf("artifact transfer failed: %w", err)
	}
	p.step("transfer", "success")

	// 5. Remote Setup & Migrations (executed inside releaseDir with DB env vars)
	if len(project.RemoteSetupSteps) > 0 {
		p.step("setup", "running")
		p.log(fmt.Sprintf("Executing %d remote setup step(s)...", len(project.RemoteSetupSteps)))

		envPrefix := fmt.Sprintf(
			"export SKIFF_APP_DIR=%s SKIFF_RELEASE_DIR=%s SKIFF_SHARED_DIR=%s "+
				"SURREAL_USER=%s SURREAL_PASS=%s SURREAL_PORT=%d SURREAL_ENDPOINT=%s "+
				"SKIFF_DB_USER=%s SKIFF_DB_PASS=%s SKIFF_DB_PORT=%d; ",
			shellQuote(project.AppDir), shellQuote(releaseDir), shellQuote(sharedDir),
			shellQuote(dbCreds.User), shellQuote(dbCreds.Password), dbCreds.Port,
			shellQuote(fmt.Sprintf("http://127.0.0.1:%d", dbCreds.Port)),
			shellQuote(dbCreds.User), shellQuote(dbCreds.Password), dbCreds.Port,
		)

		for idx, s := range project.RemoteSetupSteps {
			p.log(fmt.Sprintf("[Remote %d/%d] %s", idx+1, len(project.RemoteSetupSteps), s.Name))
			remoteCmd := fmt.Sprintf("cd %s && chmod +x *.sh 2>/dev/null || true; %s%s",
				shellQuote(releaseDir), envPrefix, s.Command)

			out, err := client.RunCommand(remoteCmd)
			if strings.TrimSpace(out) != "" {
				for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
					p.log("  " + line)
				}
			}
			if err != nil {
				p.step("setup", "failed")
				return fmt.Errorf("remote setup step '%s' failed: %w", s.Name, err)
			}
		}
		p.step("setup", "success")
	}

	// 6. Atomic Link Activation & Shared Linking
	p.step("activate", "running")
	p.log("Updating atomic symlinks and restarting services...")

	var activateScript strings.Builder
	// Ensure executable bit on all root binaries
	activateScript.WriteString(fmt.Sprintf("chmod +x %s/* 2>/dev/null || true; ", shellQuote(releaseDir)))

	// Link shared directories/files into the new release
	for _, item := range project.SharedFiles {
		activateScript.WriteString(fmt.Sprintf("ln -sfn %s %s; ",
			shellQuote(fmt.Sprintf("%s/%s", sharedDir, item)),
			shellQuote(fmt.Sprintf("%s/%s", releaseDir, item))))
	}

	// Atomically point `current` to new release
	activateScript.WriteString(fmt.Sprintf("ln -sfn %s %s; ",
		shellQuote(releaseDir), shellQuote(fmt.Sprintf("%s/current", project.AppDir))))

	// Execute service restart
	if project.RestartCommand != "" {
		activateScript.WriteString(project.RestartCommand + "; ")
	}

	// Release pruning
	keep := project.KeepReleases
	if keep <= 0 {
		keep = 3
	}
	activateScript.WriteString(fmt.Sprintf("cd %s && ls -1dt * 2>/dev/null | tail -n +%d | xargs rm -rf 2>/dev/null || true",
		shellQuote(fmt.Sprintf("%s/releases", project.AppDir)), keep+1))

	if _, err := client.RunCommand(activateScript.String()); err != nil {
		p.step("activate", "failed")
		return fmt.Errorf("activation script failed: %w", err)
	}
	p.step("activate", "success")

	// 7. Verification Probe
	if project.HealthURL != "" {
		p.step("verify", "running")
		p.log(fmt.Sprintf("Probing health endpoint: %s", project.HealthURL))

		verified := false
		httpClient := &http.Client{Timeout: 5 * time.Second}
		for i := 1; i <= 6; i++ {
			time.Sleep(1 * time.Second)
			resp, err := httpClient.Get(project.HealthURL)
			if err == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 400 {
					p.log(fmt.Sprintf("Health check verified (HTTP %d)", resp.StatusCode))
					verified = true
					break
				}
			}
			p.log(fmt.Sprintf("Attempt %d/6: waiting for server response...", i))
		}
		if !verified {
			p.step("verify", "warning")
			p.log("Warning: health probe timed out; check service logs.")
		} else {
			p.step("verify", "success")
		}
	}

	p.log(fmt.Sprintf("==> Deployment %s successfully completed!", releaseID))
	return nil
}

func (p *Pipeline) Rollback(project store.ProjectConfig) error {
	server, err := p.store.GetServer(project.ServerID)
	if err != nil {
		return err
	}
	client, err := sshclient.NewClient(*server)
	if err != nil {
		return err
	}
	defer client.Close()

	// List releases sorted by date, find previous
	cmd := fmt.Sprintf("cd %s && ls -1dt * 2>/dev/null | sed -n '2p'", shellQuote(fmt.Sprintf("%s/releases", project.AppDir)))
	prevRelease, err := client.RunCommand(cmd)
	if err != nil || strings.TrimSpace(prevRelease) == "" {
		return fmt.Errorf("no previous release available for rollback")
	}

	target := strings.TrimSpace(prevRelease)
	p.log(fmt.Sprintf("Rolling back to release: %s", target))

	rollbackCmd := fmt.Sprintf("ln -sfn %s %s && %s",
		shellQuote(fmt.Sprintf("%s/releases/%s", project.AppDir, target)),
		shellQuote(fmt.Sprintf("%s/current", project.AppDir)),
		project.RestartCommand)
	_, err = client.RunCommand(rollbackCmd)
	return err
}

// shellQuote wraps a remote path in single quotes, escaping embedded quotes.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
