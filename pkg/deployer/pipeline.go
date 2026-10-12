package deployer

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
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

type RemoteDbCredentials struct {
	User     string
	Password string
	Port     int
}

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

func isLoopbackURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return strings.Contains(rawURL, "127.0.0.1") || strings.Contains(rawURL, "localhost")
	}
	h := u.Hostname()
	return h == "127.0.0.1" || h == "localhost" || h == "::1"
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

	// 5. Remote Setup & Migrations
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
	activateScript.WriteString(fmt.Sprintf("chmod +x %s/* 2>/dev/null || true; ", shellQuote(releaseDir)))

	for _, item := range project.SharedFiles {
		activateScript.WriteString(fmt.Sprintf("ln -sfn %s %s; ",
			shellQuote(fmt.Sprintf("%s/%s", sharedDir, item)),
			shellQuote(fmt.Sprintf("%s/%s", releaseDir, item))))
	}

	activateScript.WriteString(fmt.Sprintf("ln -sfn %s %s; ",
		shellQuote(releaseDir), shellQuote(fmt.Sprintf("%s/current", project.AppDir))))

	if project.RestartCommand != "" {
		activateScript.WriteString(project.RestartCommand + "; ")
	}

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

	// Synchronize Caddy routing and open firewall port
	if err := syncCaddyRoute(client, p, project, server.Host); err != nil {
		p.log(fmt.Sprintf("  [WARNING] Caddy route sync: %s", err))
	}
	p.step("activate", "success")

	// 7. Verification Probe (F5 Fix: Loopback probes run over SSH on the VPS)
	if project.HealthURL != "" {
		p.step("verify", "running")
		verified := false

		if isLoopbackURL(project.HealthURL) {
			p.log(fmt.Sprintf("Probing loopback endpoint on VPS via SSH: %s", project.HealthURL))
			for i := 1; i <= 6; i++ {
				time.Sleep(1 * time.Second)
				curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' -m 3 %s 2>/dev/null || echo 'ERR'",
					shellQuote(project.HealthURL))
				out, err := client.RunCommand(curlCmd)
				code := strings.TrimSpace(out)
				if err == nil && len(code) == 3 && strings.HasPrefix(code, "2") {
					p.log(fmt.Sprintf("Health check verified over SSH (HTTP %s)", code))
					verified = true
					break
				}
				p.log(fmt.Sprintf("Attempt %d/6: waiting for local backend (code: %s)...", i, code))
			}
		} else {
			p.log(fmt.Sprintf("Probing public health endpoint from desktop: %s", project.HealthURL))
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
		}

		if !verified {
			p.step("verify", "warning")
			p.log("Warning: health probe timed out; check service logs.")
		} else {
			p.step("verify", "success")
		}
	}

	p.log(fmt.Sprintf("==> Deployment %s successfully completed!", releaseID))
	if p.emitEvent != nil {
		p.emitEvent("deploy:done", map[string]any{
			"projectId": project.ID,
			"releaseId": releaseID,
		})
	}
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

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func sanitizeSnippetName(raw string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('-')
		}
	}
	if b.Len() == 0 {
		return "app"
	}
	return b.String()
}

func projectSlug(project store.ProjectConfig) string {
	if project.AppDir != "" {
		clean := filepath.Clean(project.AppDir)
		base := filepath.Base(clean)
		if base != "" && base != "." && base != "/" {
			return sanitizeSnippetName(base)
		}
	}
	return sanitizeSnippetName(project.Name)
}

func syncCaddyRoute(client *sshclient.Client, p *Pipeline, project store.ProjectConfig, serverHost string) error {
	port := project.TargetPort
	if port <= 0 {
		port = 8080
	}
	tlsMode := project.TLSMode
	if tlsMode != "http" && tlsMode != "none" {
		tlsMode = "auto"
	}
	domain := strings.TrimSpace(project.Domain)
	slug := projectSlug(project)

	// Open target port in UFW if present
	_, _ = client.RunCommand(fmt.Sprintf("ufw allow %d/tcp comment 'Skiff App Port' >/dev/null 2>&1 || true", port))

	// Check if another snippet already owns http://<serverHost> to prevent ambiguous site definition
	checkIPConflictCmd := fmt.Sprintf(
		`grep -l "http://%s" /opt/skiff/caddy/conf.d/*.caddy 2>/dev/null | grep -v "/%s.caddy" || true`,
		serverHost, slug)
	existingOwner, _ := client.RunCommand(checkIPConflictCmd)
	existingOwner = strings.TrimSpace(existingOwner)

	includeDirectIP := existingOwner == ""

	var snippet string
	if domain == "" || tlsMode == "none" {
		if includeDirectIP && serverHost != "" {
			snippet = fmt.Sprintf("http://%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", serverHost, port)
		} else {
			snippet = fmt.Sprintf(":%d {\n\treverse_proxy 127.0.0.1:%d\n}\n", port, port)
		}
	} else if tlsMode == "http" {
		if includeDirectIP && serverHost != "" && serverHost != domain {
			snippet = fmt.Sprintf("http://%s, http://%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", domain, serverHost, port)
		} else {
			snippet = fmt.Sprintf("http://%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", domain, port)
		}
	} else {
		// Auto TLS for domain, plain HTTP port 80 for server IP
		if includeDirectIP && serverHost != "" && serverHost != domain {
			snippet = fmt.Sprintf("%s {\n\treverse_proxy 127.0.0.1:%d\n}\n\nhttp://%s {\n\treverse_proxy 127.0.0.1:%d\n}\n",
				domain, port, serverHost, port)
		} else {
			snippet = fmt.Sprintf("%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", domain, port)
		}
	}

	if !includeDirectIP && serverHost != "" {
		p.log(fmt.Sprintf("  [INFO] http://%s is already routed by another snippet. Skipping IP block for '%s'.", serverHost, slug))
	}

	p.log(fmt.Sprintf("  Syncing Caddy route for '%s' (port %d)...", slug, port))

	encoded := base64.StdEncoding.EncodeToString([]byte(snippet))
	setup := `mkdir -p /opt/skiff/caddy/conf.d /etc/caddy; ` +
		`if ! grep -q '/opt/skiff/caddy/conf.d' /etc/caddy/Caddyfile 2>/dev/null; then ` +
		`echo 'import /opt/skiff/caddy/conf.d/*.caddy' >> /etc/caddy/Caddyfile; fi`
	if _, err := client.RunCommand(setup); err != nil {
		return err
	}
	writeCmd := fmt.Sprintf("echo '%s' | base64 -d > '/opt/skiff/caddy/conf.d/%s.caddy'", encoded, slug)
	if _, err := client.RunCommand(writeCmd); err != nil {
		return err
	}

	// Validate config, with fallback if validate fails
	if out, err := client.RunCommand("caddy validate --config /etc/caddy/Caddyfile 2>&1"); err != nil {
		fallbackSnippet := fmt.Sprintf("%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", domain, port)
		if domain == "" {
			fallbackSnippet = fmt.Sprintf(":%d {\n\treverse_proxy 127.0.0.1:%d\n}\n", port, port)
		}
		fallbackEncoded := base64.StdEncoding.EncodeToString([]byte(fallbackSnippet))
		_, _ = client.RunCommand(fmt.Sprintf("echo '%s' | base64 -d > '/opt/skiff/caddy/conf.d/%s.caddy'", fallbackEncoded, slug))
		if outRetry, errRetry := client.RunCommand("caddy validate --config /etc/caddy/Caddyfile 2>&1"); errRetry != nil {
			return fmt.Errorf("caddy config invalid: %s", strings.TrimSpace(out))
		} else {
			_ = outRetry
		}
	}

	if _, err := client.RunCommand("systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy"); err != nil {
		return err
	}
	p.log("  Caddy route synced and reloaded.")
	return nil
}
