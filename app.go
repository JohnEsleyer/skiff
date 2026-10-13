package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"skiff/pkg/bootstrap"
	"skiff/pkg/deployer"
	"skiff/pkg/sshclient"
	"skiff/pkg/store"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var versionRegexp = regexp.MustCompile(`[0-9]+\.[0-9]+(\.[0-9]+)?`)
var releaseIDRegexp = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

type ServiceStatus struct {
	Name    string `json:"name"`
	Active  bool   `json:"active"`
	Running bool   `json:"running"`
	Status  string `json:"status"`
	Version string `json:"version,omitempty"`
}

type DeployedAppDetail struct {
	Name           string `json:"name"`
	Path           string `json:"path"`
	CurrentRelease string `json:"currentRelease,omitempty"`
	ReleasesCount  int    `json:"releasesCount"`
	ServiceStatus  string `json:"serviceStatus"`
	Domain         string `json:"domain,omitempty"`
}

type ServerOverview struct {
	Telemetry    *sshclient.Telemetry `json:"telemetry"`
	Services     []ServiceStatus      `json:"services"`
	DeployedApps []string             `json:"deployedApps"`
	AppDetails   []DeployedAppDetail  `json:"appDetails"`
}

type ProjectDeploymentStatus struct {
	IsDeployed     bool   `json:"isDeployed"`
	CurrentRelease string `json:"currentRelease"`
	ReleasesCount  int    `json:"releasesCount"`
	ServiceActive  bool   `json:"serviceActive"`
	ServiceStatus  string `json:"serviceStatus"`
}

type ReleaseInfo struct {
	ID        string `json:"id"`
	IsCurrent bool   `json:"isCurrent"`
	Size      string `json:"size"`
	CreatedAt string `json:"createdAt"`
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

func (a *App) SelectFolderDialog() (string, error) {
	selectedDir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Project Directory",
	})
	if err != nil {
		return "", err
	}
	return selectedDir, nil
}

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

	cfg.LocalPath = folderPath
	return &cfg, nil
}

// ----------------- VPS Management & Telemetry -----------------

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
CANDIDATES="caddy surrealdb postgresql mariadb mysql"
for s in $CANDIDATES; do
  if systemctl cat "$s.service" >/dev/null 2>&1 || [ -d "/opt/skiff/data/$s" ]; then
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
      if systemctl cat "$APP_NAME.service" >/dev/null 2>&1; then
        STATUS=$(systemctl is-active "$APP_NAME" 2>/dev/null || echo "stopped")
        echo "appservice:$APP_NAME:$STATUS:"
      fi
      CURR=$(readlink "$app/current" 2>/dev/null | xargs basename 2>/dev/null || echo "")
      COUNT=$(ls -1 "$app/releases" 2>/dev/null | wc -l || echo "0")
      SVC_STATUS="not-installed"
      if systemctl cat "$APP_NAME.service" >/dev/null 2>&1; then
        SVC_STATUS=$(systemctl is-active "$APP_NAME" 2>/dev/null || echo "stopped")
      fi
      # Extract non-IP custom domain cleanly (F7 fix)
      SNIP_FILE="/opt/skiff/caddy/conf.d/$APP_NAME.caddy"
      DOMAIN=""
      if [ -f "$SNIP_FILE" ]; then
        DOMAIN=$(grep -hoE "[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" "$SNIP_FILE" 2>/dev/null | grep -vE "^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$" | head -n 1 || echo "")
      fi
      echo "appdetail:$APP_NAME:$CURR:$COUNT:$SVC_STATUS:$DOMAIN"
    fi
  done
fi
echo "---"
ls -1 /opt/skiff/apps 2>/dev/null || true
'`
	out, _ := client.RunCommand(checkServicesCmd)

	services := make([]ServiceStatus, 0)
	deployedApps := make([]string, 0)
	appDetails := make([]DeployedAppDetail, 0)

	parts := strings.Split(out, "---")
	if len(parts) >= 1 {
		for _, l := range strings.Split(strings.TrimSpace(parts[0]), "\n") {
			line := strings.TrimSpace(l)
			if line == "" {
				continue
			}

			if strings.HasPrefix(line, "appdetail:") {
				f := strings.SplitN(strings.TrimPrefix(line, "appdetail:"), ":", 5)
				if len(f) >= 4 {
					appName := f[0]
					curr := f[1]
					count := 0
					fmt.Sscanf(f[2], "%d", &count)
					svcSt := f[3]
					dom := ""
					if len(f) >= 5 {
						dom = f[4]
					}
					appDetails = append(appDetails, DeployedAppDetail{
						Name:           appName,
						Path:           fmt.Sprintf("/opt/skiff/apps/%s", appName),
						CurrentRelease: curr,
						ReleasesCount:  count,
						ServiceStatus:  svcSt,
						Domain:         dom,
					})
				}
				continue
			}

			fields := strings.SplitN(line, ":", 4)
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
		AppDetails:   appDetails,
	}, nil
}

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
	default:
		return fmt.Errorf("invalid service action: %s", action)
	}

	cmd := fmt.Sprintf("sudo systemctl %s %s", action, serviceName)
	_, err = client.RunCommand(cmd)
	return err
}

func (a *App) GetProjectDeploymentStatus(serverID, appDir, appName string) (*ProjectDeploymentStatus, error) {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return nil, err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	slug := sanitizeAppName(appName)
	if appDir != "" {
		clean := filepath.Clean(appDir)
		base := filepath.Base(clean)
		if base != "" && base != "." && base != "/" {
			slug = sanitizeAppName(base)
		}
	}

	probeScript := fmt.Sprintf(`sh -c '
APP_DIR="%s"
APP_NAME="%s"
if [ -d "$APP_DIR/current" ] || [ -d "$APP_DIR/releases" ]; then
  CURR=$(readlink "$APP_DIR/current" 2>/dev/null | xargs basename 2>/dev/null || echo "")
  COUNT=$(ls -1 "$APP_DIR/releases" 2>/dev/null | wc -l || echo "0")
  SVC_ST="inactive"
  if systemctl cat "$APP_NAME.service" >/dev/null 2>&1; then
    SVC_ST=$(systemctl is-active "$APP_NAME" 2>/dev/null || echo "stopped")
  fi
  echo "DEPLOYED:$CURR:$COUNT:$SVC_ST"
else
  echo "NOT_DEPLOYED"
fi
'`, appDir, slug)

	out, err := client.RunCommand(probeScript)
	if err != nil {
		return &ProjectDeploymentStatus{IsDeployed: false}, nil
	}

	trimmed := strings.TrimSpace(out)
	if strings.HasPrefix(trimmed, "DEPLOYED:") {
		parts := strings.Split(trimmed, ":")
		rel := ""
		count := 0
		svcSt := "inactive"
		if len(parts) >= 2 {
			rel = parts[1]
		}
		if len(parts) >= 3 {
			fmt.Sscanf(parts[2], "%d", &count)
		}
		if len(parts) >= 4 {
			svcSt = parts[3]
		}
		return &ProjectDeploymentStatus{
			IsDeployed:     true,
			CurrentRelease: rel,
			ReleasesCount:  count,
			ServiceActive:  svcSt == "active",
			ServiceStatus:  svcSt,
		}, nil
	}

	return &ProjectDeploymentStatus{IsDeployed: false}, nil
}

// ----------------- Column Releases Management & Deletion -----------------

func (a *App) GetAppReleases(serverID, appDir string) ([]ReleaseInfo, error) {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return nil, err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	cmd := fmt.Sprintf(`sh -c '
APP_DIR="%s"
if [ ! -d "$APP_DIR/releases" ]; then
  exit 0
fi
CURR=$(readlink "$APP_DIR/current" 2>/dev/null | xargs basename 2>/dev/null || echo "")
for r in $(ls -1dt "$APP_DIR/releases"/* 2>/dev/null); do
  if [ -d "$r" ]; then
    REL=$(basename "$r")
    IS_C="0"
    if [ "$REL" = "$CURR" ]; then IS_C="1"; fi
    SZ=$(du -sh "$r" 2>/dev/null | awk "{print \$1}" || echo "N/A")
    DT=$(stat -c "%%y" "$r" 2>/dev/null | cut -d"." -f1 || date -r "$r" "+%%Y-%%m-%%d %%H:%%M:%%S" 2>/dev/null || echo "")
    echo "rel:$REL:$IS_C:$SZ:$DT"
  fi
done
'`, appDir)

	out, err := client.RunCommand(cmd)
	if err != nil {
		return nil, err
	}

	releases := make([]ReleaseInfo, 0)
	for _, l := range strings.Split(strings.TrimSpace(out), "\n") {
		line := strings.TrimSpace(l)
		if strings.HasPrefix(line, "rel:") {
			parts := strings.SplitN(strings.TrimPrefix(line, "rel:"), ":", 4)
			if len(parts) >= 4 {
				releases = append(releases, ReleaseInfo{
					ID:        parts[0],
					IsCurrent: parts[1] == "1",
					Size:      parts[2],
					CreatedAt: parts[3],
				})
			}
		}
	}
	return releases, nil
}

func (a *App) DeleteAppRelease(serverID, appDir, releaseID string) error {
	if !releaseIDRegexp.MatchString(releaseID) {
		return fmt.Errorf("invalid release identifier")
	}

	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return err
	}
	defer client.Close()

	cmd := fmt.Sprintf(`sh -c '
APP_DIR="%s"
REL="%s"
CURR=$(readlink "$APP_DIR/current" 2>/dev/null | xargs basename 2>/dev/null || echo "")
if [ "$REL" = "$CURR" ]; then
  echo "CANNOT_DELETE_ACTIVE"
  exit 1
fi
rm -rf "$APP_DIR/releases/$REL"
echo "DELETED"
'`, appDir, releaseID)

	out, err := client.RunCommand(cmd)
	if err != nil || strings.Contains(out, "CANNOT_DELETE_ACTIVE") {
		return fmt.Errorf("cannot delete the currently active release. Switch releases first")
	}
	return nil
}

func (a *App) ActivateAppRelease(serverID, appDir, releaseID, restartCommand string) error {
	if !releaseIDRegexp.MatchString(releaseID) {
		return fmt.Errorf("invalid release identifier")
	}

	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return err
	}
	defer client.Close()

	cmd := fmt.Sprintf(`sh -c '
APP_DIR="%s"
REL="%s"
if [ ! -d "$APP_DIR/releases/$REL" ]; then
  echo "NOT_FOUND"
  exit 1
fi
ln -sfn "$APP_DIR/releases/$REL" "$APP_DIR/current"
%s
echo "ACTIVATED"
'`, appDir, releaseID, restartCommand)

	_, err = client.RunCommand(cmd)
	return err
}

// DeleteProjectDeployment stops the app service, removes Caddy routing, wipes remote files, and deletes the recipe.
func (a *App) DeleteProjectDeployment(serverID, projectID, appDir, appName string) error {
	srv, err := a.store.GetServer(serverID)
	if err == nil {
		client, cerr := sshclient.NewClient(*srv)
		if cerr == nil {
			defer client.Close()
			cleanApp := sanitizeAppName(appName)
			if appDir != "" {
				base := filepath.Base(filepath.Clean(appDir))
				if base != "" && base != "." && base != "/" {
					cleanApp = sanitizeAppName(base)
				}
			}

			cleanupCmd := fmt.Sprintf(`sh -c '
APP_DIR="%s"
APP_NAME="%s"
systemctl stop "$APP_NAME" >/dev/null 2>&1 || true
systemctl disable "$APP_NAME" >/dev/null 2>&1 || true
rm -f "/etc/systemd/system/$APP_NAME.service"
rm -f "/opt/skiff/caddy/conf.d/$APP_NAME.caddy"
systemctl reload caddy >/dev/null 2>&1 || caddy reload >/dev/null 2>&1 || true
if [ -n "$APP_DIR" ] && [ "$APP_DIR" != "/" ] && [ "$APP_DIR" != "/opt" ] && [ "$APP_DIR" != "/opt/skiff" ]; then
  rm -rf "$APP_DIR"
fi
systemctl daemon-reload
'`, appDir, cleanApp)
			_, _ = client.RunCommand(cleanupCmd)
		}
	}

	return a.store.DeleteProject(projectID)
}

// ----------------- Domain & Caddy Routing -----------------

type DNSCheckResult struct {
	Domain       string   `json:"domain"`
	ServerIP     string   `json:"serverIp"`
	ResolvedIPs  []string `json:"resolvedIps"`
	IsPointing   bool     `json:"isPointing"`
	IsCloudflare bool     `json:"isCloudflare"`
	RecordType   string   `json:"recordType"`
	RecordHost   string   `json:"recordHost"`
}

type DomainRouteConfig struct {
	AppName    string `json:"appName"`
	Domain     string `json:"domain"`
	TargetPort int    `json:"targetPort"`
	TLSMode    string `json:"tlsMode"`
	Active     bool   `json:"active"`
}

var domainLabelRegexp = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$`)

func sanitizeDomain(raw string) (string, error) {
	d := strings.TrimSpace(strings.ToLower(raw))
	d = strings.TrimPrefix(d, "http://")
	d = strings.TrimPrefix(d, "https://")
	d = strings.TrimRight(d, "/")
	if d == "" || len(d) > 253 {
		return "", fmt.Errorf("empty domain name")
	}
	if strings.ContainsAny(d, " \t\n\r;|&$`'\"\\") {
		return "", fmt.Errorf("invalid domain name: %q", raw)
	}
	for _, label := range strings.Split(d, ".") {
		if label == "" || !domainLabelRegexp.MatchString(label) {
			return "", fmt.Errorf("invalid domain name: %q", raw)
		}
	}
	return d, nil
}

func sanitizeAppName(raw string) string {
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

func isCloudflareIP(ipStr string) bool {
	// Standard Cloudflare anycast ranges (104.16 - 104.31, 172.64 - 172.71, etc.)
	return strings.HasPrefix(ipStr, "104.21.") ||
		strings.HasPrefix(ipStr, "172.67.") ||
		strings.HasPrefix(ipStr, "104.16.") ||
		strings.HasPrefix(ipStr, "104.17.") ||
		strings.HasPrefix(ipStr, "104.18.") ||
		strings.HasPrefix(ipStr, "104.19.") ||
		strings.HasPrefix(ipStr, "104.20.") ||
		strings.HasPrefix(ipStr, "104.22.") ||
		strings.HasPrefix(ipStr, "172.64.") ||
		strings.HasPrefix(ipStr, "172.65.") ||
		strings.HasPrefix(ipStr, "172.66.")
}

func (a *App) CheckDomainDNS(domain, serverIP string) (*DNSCheckResult, error) {
	d, err := sanitizeDomain(domain)
	if err != nil {
		return nil, err
	}

	ips, err := net.LookupIP(d)
	resolved := make([]string, 0)
	isPointing := false
	isCF := false

	if err == nil {
		for _, ip := range ips {
			ipStr := ip.String()
			resolved = append(resolved, ipStr)
			if ipStr == serverIP {
				isPointing = true
			}
			if isCloudflareIP(ipStr) {
				isCF = true
			}
		}
	}

	recordHost := "@"
	if parts := strings.Split(d, "."); len(parts) > 2 {
		recordHost = parts[0]
	}

	return &DNSCheckResult{
		Domain:       d,
		ServerIP:     serverIP,
		ResolvedIPs:  resolved,
		IsPointing:   isPointing,
		IsCloudflare: isCF,
		RecordType:   "A",
		RecordHost:   recordHost,
	}, nil
}

func caddySnippetFor(serverIP, domain string, targetPort int, tlsMode string, includeDirectIP bool) string {
	cleanIP := strings.TrimSpace(serverIP)
	cleanDomain := strings.TrimSpace(domain)

	if cleanDomain == "" || tlsMode == "none" {
		if includeDirectIP && cleanIP != "" {
			return fmt.Sprintf("http://%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", cleanIP, targetPort)
		}
		return fmt.Sprintf(":%d {\n\treverse_proxy 127.0.0.1:%d\n}\n", targetPort, targetPort)
	}

	if tlsMode == "http" {
		if includeDirectIP && cleanIP != "" && cleanIP != cleanDomain {
			return fmt.Sprintf("http://%s, http://%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", cleanDomain, cleanIP, targetPort)
		}
		return fmt.Sprintf("http://%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", cleanDomain, targetPort)
	}

	if includeDirectIP && cleanIP != "" && cleanIP != cleanDomain {
		return fmt.Sprintf("%s {\n\treverse_proxy 127.0.0.1:%d\n}\n\nhttp://%s {\n\treverse_proxy 127.0.0.1:%d\n}\n",
			cleanDomain, targetPort, cleanIP, targetPort)
	}
	return fmt.Sprintf("%s {\n\treverse_proxy 127.0.0.1:%d\n}\n", cleanDomain, targetPort)
}

func writeCaddySnippet(client *sshclient.Client, cleanAppName, snippet string) error {
	encoded := base64.StdEncoding.EncodeToString([]byte(snippet))
	setup := `mkdir -p /opt/skiff/caddy/conf.d /etc/caddy; ` +
		`if ! grep -q '/opt/skiff/caddy/conf.d' /etc/caddy/Caddyfile 2>/dev/null; then ` +
		`echo 'import /opt/skiff/caddy/conf.d/*.caddy' >> /etc/caddy/Caddyfile; fi`
	if _, err := client.RunCommand(setup); err != nil {
		return fmt.Errorf("failed to prepare master Caddyfile: %w", err)
	}

	writeCmd := fmt.Sprintf("echo '%s' | base64 -d > '/opt/skiff/caddy/conf.d/%s.caddy'",
		encoded, cleanAppName)
	if _, err := client.RunCommand(writeCmd); err != nil {
		return fmt.Errorf("failed to write Caddy snippet: %w", err)
	}

	if out, err := client.RunCommand("caddy validate --config /etc/caddy/Caddyfile 2>&1"); err != nil {
		return fmt.Errorf("caddy config invalid, not reloading: %s", strings.TrimSpace(out))
	}
	if _, err := client.RunCommand("systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy"); err != nil {
		return fmt.Errorf("caddy reload failed: %w", err)
	}
	return nil
}

func (a *App) ConfigureAppDomain(serverID, appName, domain string, targetPort int, tlsMode string) error {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return err
	}
	defer client.Close()

	if targetPort <= 0 {
		targetPort = 8080
	}
	if tlsMode != "http" && tlsMode != "none" {
		tlsMode = "auto"
	}

	cleanApp := sanitizeAppName(appName)
	// Open port in UFW
	_, _ = client.RunCommand(fmt.Sprintf("ufw allow %d/tcp comment 'Skiff App Port' >/dev/null 2>&1 || true", targetPort))

	d := ""
	if domain != "" {
		if d, err = sanitizeDomain(domain); err != nil {
			return err
		}
	}

	// Check if another snippet already owns http://<server_ip> (F4 fix)
	checkIPConflictCmd := fmt.Sprintf(
		`grep -l "http://%s" /opt/skiff/caddy/conf.d/*.caddy 2>/dev/null | grep -v "/%s.caddy" || true`,
		srv.Host, cleanApp)
	existingOwner, _ := client.RunCommand(checkIPConflictCmd)
	includeDirectIP := strings.TrimSpace(existingOwner) == ""

	return writeCaddySnippet(client, cleanApp, caddySnippetFor(srv.Host, d, targetPort, tlsMode, includeDirectIP))
}

func (a *App) GetAppDomainConfig(serverID, appName string) (*DomainRouteConfig, error) {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return nil, err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	clean := sanitizeAppName(appName)
	out, err := client.RunCommand(fmt.Sprintf("cat '/opt/skiff/caddy/conf.d/%s.caddy' 2>/dev/null || echo ''", clean))
	if err != nil || strings.TrimSpace(out) == "" {
		return &DomainRouteConfig{AppName: appName, TLSMode: "auto", TargetPort: 8080, Active: false}, nil
	}

	lines := strings.Split(strings.TrimSpace(out), "\n")
	header := strings.TrimSuffix(strings.TrimSpace(lines[0]), " {")

	tlsMode := "auto"
	domain := header
	if strings.HasPrefix(header, "http://") {
		tlsMode = "http"
		domain = strings.TrimPrefix(header, "http://")
	} else if strings.HasPrefix(header, ":") {
		tlsMode = "none"
		domain = ""
	}

	port := 8080
	for _, l := range lines {
		if strings.Contains(l, "reverse_proxy") {
			fields := strings.Split(strings.TrimSpace(l), ":")
			if len(fields) >= 2 {
				fmt.Sscanf(strings.TrimSpace(fields[len(fields)-1]), "%d", &port)
			}
		}
	}

	return &DomainRouteConfig{
		AppName:    appName,
		Domain:     domain,
		TargetPort: port,
		TLSMode:    tlsMode,
		Active:     true,
	}, nil
}

func (a *App) RemoveAppDomain(serverID, appName string) error {
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return err
	}
	defer client.Close()

	cmd := fmt.Sprintf("rm -f '/opt/skiff/caddy/conf.d/%s.caddy' && (systemctl reload caddy >/dev/null 2>&1 || true)",
		sanitizeAppName(appName))
	_, err = client.RunCommand(cmd)
	return err
}

// ----------------- Environment (.env) Management -----------------

type EnvCredentialChip struct {
	Source string `json:"source"`
	Label  string `json:"label"`
	Key    string `json:"key"`
	Value  string `json:"value"`
}

type AppEnvInfo struct {
	Exists      bool                `json:"exists"`
	Content     string              `json:"content"`
	ModifiedAt  string              `json:"modifiedAt,omitempty"`
	Credentials []EnvCredentialChip `json:"credentials"`
}

// validateAppEnvDir confines env read/write to a single app directory directly
// under /opt/skiff/apps and rejects traversal attempts.
func validateAppEnvDir(appDir string) (string, error) {
	clean := filepath.Clean(strings.TrimSpace(appDir))
	if !strings.HasPrefix(clean, "/opt/skiff/apps/") {
		return "", fmt.Errorf("refusing to touch .env outside /opt/skiff/apps")
	}
	rest := strings.TrimPrefix(clean, "/opt/skiff/apps/")
	if rest == "" || !releaseIDRegexp.MatchString(rest) {
		return "", fmt.Errorf("invalid app directory: %q", appDir)
	}
	return clean, nil
}

func appServiceSlug(appDir, appName string) string {
	if appDir != "" {
		clean := filepath.Clean(appDir)
		if base := filepath.Base(clean); base != "" && base != "." && base != "/" {
			return sanitizeAppName(base)
		}
	}
	return sanitizeAppName(appName)
}

// discoverEnvCredentials reads provisioned data-engine info files and builds
// one-click insertion chips (endpoints, users, passwords, ports).
func discoverEnvCredentials(client *sshclient.Client) []EnvCredentialChip {
	chips := make([]EnvCredentialChip, 0)
	engines := []struct {
		source string
		paths  []string
	}{
		{"surrealdb", []string{"surrealdb"}},
		{"postgres", []string{"postgres", "postgresql"}},
		{"mysql", []string{"mysql", "mariadb"}},
	}
	for _, eng := range engines {
		for _, p := range eng.paths {
			raw, err := client.RunCommand(fmt.Sprintf("cat /opt/skiff/data/%s/info.json 2>/dev/null || echo ''", p))
			if err != nil || strings.TrimSpace(raw) == "" {
				continue
			}
			var parsed map[string]any
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				continue
			}
			str := func(k string) string {
				if v, ok := parsed[k].(string); ok {
					return v
				}
				return ""
			}
			port := 0
			if f, ok := parsed["port"].(float64); ok {
				port = int(f)
			}
			user, pass := str("user"), str("password")
			ns, db := str("namespace"), str("database")
			switch eng.source {
			case "surrealdb":
				if port == 0 {
					port = 8000
				}
				chips = append(chips,
					EnvCredentialChip{Source: "surrealdb", Label: "SurrealDB endpoint", Key: "SURREAL_ENDPOINT", Value: fmt.Sprintf("http://127.0.0.1:%d", port)},
					EnvCredentialChip{Source: "surrealdb", Label: "SurrealDB user", Key: "SURREAL_USER", Value: user},
					EnvCredentialChip{Source: "surrealdb", Label: "SurrealDB password", Key: "SURREAL_PASS", Value: pass},
				)
				if ns != "" {
					chips = append(chips, EnvCredentialChip{Source: "surrealdb", Label: "SurrealDB namespace", Key: "SURREAL_NS", Value: ns})
				}
				if db != "" {
					chips = append(chips, EnvCredentialChip{Source: "surrealdb", Label: "SurrealDB database", Key: "SURREAL_DB", Value: db})
				}
			case "postgres":
				if port == 0 {
					port = 5432
				}
				if db == "" {
					db = "postgres"
				}
				chips = append(chips,
					EnvCredentialChip{Source: "postgres", Label: "Postgres URL", Key: "DATABASE_URL", Value: fmt.Sprintf("postgresql://%s:%s@127.0.0.1:%d/%s?sslmode=disable", user, pass, port, db)},
					EnvCredentialChip{Source: "postgres", Label: "Postgres user", Key: "PGUSER", Value: user},
					EnvCredentialChip{Source: "postgres", Label: "Postgres password", Key: "PGPASSWORD", Value: pass},
					EnvCredentialChip{Source: "postgres", Label: "Postgres port", Key: "PGPORT", Value: fmt.Sprintf("%d", port)},
				)
			case "mysql":
				if port == 0 {
					port = 3306
				}
				if db == "" {
					db = "mysql"
				}
				chips = append(chips,
					EnvCredentialChip{Source: "mysql", Label: "MySQL URL", Key: "DATABASE_URL", Value: fmt.Sprintf("mysql://%s:%s@127.0.0.1:%d/%s", user, pass, port, db)},
					EnvCredentialChip{Source: "mysql", Label: "MySQL user", Key: "MYSQL_USER", Value: user},
					EnvCredentialChip{Source: "mysql", Label: "MySQL password", Key: "MYSQL_PASSWORD", Value: pass},
					EnvCredentialChip{Source: "mysql", Label: "MySQL port", Key: "MYSQL_PORT", Value: fmt.Sprintf("%d", port)},
				)
			}
			break
		}
	}
	return chips
}

// GetAppEnv reads /opt/skiff/apps/<app>/shared/.env over SSH using
// binary-safe base64 transport and returns it with discovered stack credentials.
func (a *App) GetAppEnv(serverID, appDir, appName string) (*AppEnvInfo, error) {
	cleanDir, err := validateAppEnvDir(appDir)
	if err != nil {
		return nil, err
	}
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return nil, err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	info := &AppEnvInfo{Credentials: make([]EnvCredentialChip, 0)}
	_ = appName

	out, err := client.RunCommand(fmt.Sprintf(
		"if [ -f %s ]; then stat -c '%%y' %s; base64 -w0 %s 2>/dev/null || base64 %s | tr -d '\\n'; echo; else echo 'SKIFF_NOENV'; fi",
		shellSingleQuote(cleanDir+"/shared/.env"),
		shellSingleQuote(cleanDir+"/shared/.env"),
		shellSingleQuote(cleanDir+"/shared/.env"),
		shellSingleQuote(cleanDir+"/shared/.env")))
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "SKIFF_NOENV" {
		info.Credentials = discoverEnvCredentials(client)
		return info, nil
	}
	if len(lines) >= 1 {
		info.ModifiedAt = strings.TrimSpace(lines[0])
	}
	if len(lines) >= 2 {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(lines[1]))
		if err != nil {
			return nil, fmt.Errorf("failed to decode remote .env: %w", err)
		}
		info.Exists = true
		info.Content = string(decoded)
	}
	info.Credentials = discoverEnvCredentials(client)
	return info, nil
}

// SaveAppEnv writes shared/.env with strict 0600 permissions, re-links it into
// the active release, and optionally restarts the app systemd unit.
func (a *App) SaveAppEnv(serverID, appDir, appName, content string, restartService bool) error {
	cleanDir, err := validateAppEnvDir(appDir)
	if err != nil {
		return err
	}
	if len(content) > 512*1024 {
		return fmt.Errorf("refusing to write .env larger than 512 KB")
	}
	if strings.ContainsRune(content, 0) {
		return fmt.Errorf("refusing to write .env containing NUL bytes")
	}
	srv, err := a.store.GetServer(serverID)
	if err != nil {
		return err
	}
	client, err := sshclient.NewClient(*srv)
	if err != nil {
		return err
	}
	defer client.Close()

	encoded := base64.StdEncoding.EncodeToString([]byte(content))
	writeCmd := fmt.Sprintf("mkdir -p %s && echo '%s' | base64 -d > %s && chmod 600 %s && "+
		"if [ -e %s ]; then ln -sfn %s %s; fi && echo SAVED",
		shellSingleQuote(cleanDir+"/shared"),
		encoded,
		shellSingleQuote(cleanDir+"/shared/.env"),
		shellSingleQuote(cleanDir+"/shared/.env"),
		shellSingleQuote(cleanDir+"/current"),
		shellSingleQuote(cleanDir+"/shared/.env"),
		shellSingleQuote(cleanDir+"/current/.env"))
	out, err := client.RunCommand(writeCmd)
	if err != nil || !strings.Contains(out, "SAVED") {
		return fmt.Errorf("failed to write remote .env: %w", err)
	}

	if restartService {
		slug := appServiceSlug(cleanDir, appName)
		if _, err := client.RunCommand(fmt.Sprintf("sudo systemctl restart %s", slug)); err != nil {
			return fmt.Errorf(".env saved but service restart failed: %w", err)
		}
	}
	return nil
}

// GetLocalProjectEnv scans the local project directory for .env,
// .env.production, or .env.example (first hit wins) for one-click imports.
func (a *App) GetLocalProjectEnv(localPath string) (string, error) {
	clean := filepath.Clean(strings.TrimSpace(localPath))
	if clean == "" || clean == "." {
		return "", fmt.Errorf("empty project path")
	}
	st, err := os.Stat(clean)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("project directory not found")
	}
	for _, name := range []string{".env", ".env.production", ".env.example"} {
		data, err := os.ReadFile(filepath.Join(clean, name))
		if err != nil {
			continue
		}
		if len(data) > 256*1024 {
			return "", fmt.Errorf("%s exceeds 256 KB", name)
		}
		return string(data), nil
	}
	return "", fmt.Errorf("no .env, .env.production, or .env.example found in project")
}

// ----------------- Live Database Version Lookup -----------------
//
// Version lists are sourced live from upstream release endpoints so Skiff
// never needs a code change when a new major ships. Unauthenticated GitHub
// API calls are rate-limited (60/hr), so results are cached for an hour and
// every engine has a baked-in fallback for offline use.

type DatabaseVersionOption struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Recommended bool   `json:"recommended"`
}

// Overridable in tests.
var githubAPIBase = "https://api.github.com"
var pgdgPackagesURL = "https://apt.postgresql.org/pub/repos/apt/dists/noble-pgdg/main/binary-amd64/Packages"

var versionCacheTTL = time.Hour

var versionCache = struct {
	sync.Mutex
	entries map[string]versionCacheEntry
}{entries: make(map[string]versionCacheEntry)}

type versionCacheEntry struct {
	fetched time.Time
	options []DatabaseVersionOption
}

var stableSemverRegexp = regexp.MustCompile(`^v?[0-9]+\.[0-9]+\.[0-9]+$`)

// semverParts splits "v3.3.0" into [3 3 0] for descending comparison.
func semverParts(v string) []int {
	out := make([]int, 0, 3)
	for _, p := range strings.Split(strings.TrimPrefix(v, "v"), ".") {
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil
		}
		out = append(out, n)
	}
	return out
}

func semverDesc(a, b string) bool {
	pa, pb := semverParts(a), semverParts(b)
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return len(pa) > len(pb)
}

func sortSemverDesc(in []string) {
	for i := 1; i < len(in); i++ {
		for j := i; j > 0 && semverDesc(in[j], in[j-1]); j-- {
			in[j], in[j-1] = in[j-1], in[j]
		}
	}
}

func fetchJSON(url string, out any) error {
	client := &http.Client{Timeout: 12 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "skiff-deployer")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upstream returned HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(out)
}

func fetchText(url string) (string, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "skiff-deployer")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("upstream returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func liveSurrealDBVersions() ([]DatabaseVersionOption, error) {
	var releases []struct {
		TagName    string `json:"tag_name"`
		Prerelease bool   `json:"prerelease"`
		Draft      bool   `json:"draft"`
	}
	if err := fetchJSON(githubAPIBase+"/repos/surrealdb/surrealdb/releases?per_page=60", &releases); err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	stable := make([]string, 0)
	for _, r := range releases {
		if r.Prerelease || r.Draft || !stableSemverRegexp.MatchString(r.TagName) || seen[r.TagName] {
			continue
		}
		seen[r.TagName] = true
		stable = append(stable, r.TagName)
	}
	if len(stable) == 0 {
		return nil, fmt.Errorf("no stable SurrealDB releases found upstream")
	}
	sortSemverDesc(stable)
	if len(stable) > 12 {
		stable = stable[:12]
	}
	opts := make([]DatabaseVersionOption, 0, len(stable))
	for i, v := range stable {
		label := v
		if i == 0 {
			label += " (Latest Stable)"
		}
		opts = append(opts, DatabaseVersionOption{Value: v, Label: label, Recommended: i == 0})
	}
	return opts, nil
}

func livePostgresVersions() ([]DatabaseVersionOption, error) {
	body, err := fetchText(pgdgPackagesURL)
	if err != nil {
		return nil, err
	}
	seen := make(map[int]bool)
	majors := make([]int, 0)
	for _, line := range strings.Split(body, "\n") {
		// Exact match only: extension packages (postgresql-16-postgis-3,
		// postgresql-client-16, ...) must not count as a major release.
		m := pgdgPackageRegexp.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		n, _ := strconv.Atoi(m[1])
		if n > 0 && !seen[n] {
			seen[n] = true
			majors = append(majors, n)
		}
	}
	if len(majors) == 0 {
		return nil, fmt.Errorf("no installable PostgreSQL majors found in PGDG index")
	}
	for i := 1; i < len(majors); i++ {
		for j := i; j > 0 && majors[j] > majors[j-1]; j-- {
			majors[j], majors[j-1] = majors[j-1], majors[j]
		}
	}
	if len(majors) > 5 {
		majors = majors[:5]
	}
	opts := make([]DatabaseVersionOption, 0, len(majors))
	for i, n := range majors {
		v := strconv.Itoa(n)
		label := "PostgreSQL " + v
		if i == 0 {
			label += " (Recommended)"
		}
		opts = append(opts, DatabaseVersionOption{Value: v, Label: label, Recommended: i == 0})
	}
	return opts, nil
}

var mariadbTagRegexp = regexp.MustCompile(`^mariadb-([0-9]+\.[0-9]+)\.[0-9]+$`)
var pgdgPackageRegexp = regexp.MustCompile(`^Package: postgresql-([0-9]+)$`)

func liveMariaDBVersions() ([]DatabaseVersionOption, error) {
	var releases []struct {
		TagName    string `json:"tag_name"`
		Prerelease bool   `json:"prerelease"`
		Draft      bool   `json:"draft"`
	}
	if err := fetchJSON(githubAPIBase+"/repos/MariaDB/server/releases?per_page=40", &releases); err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	lines := make([]string, 0)
	for _, r := range releases {
		if r.Prerelease || r.Draft {
			continue
		}
		m := mariadbTagRegexp.FindStringSubmatch(r.TagName)
		if m == nil || seen[m[1]] {
			continue
		}
		seen[m[1]] = true
		lines = append(lines, m[1])
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("no stable MariaDB release lines found upstream")
	}
	sortSemverDesc(lines)
	if len(lines) > 8 {
		lines = lines[:8]
	}
	// Prefer an 11.x LTS line for the recommendation; rolling majors churn.
	recIdx := 0
	for i, l := range lines {
		if strings.HasPrefix(l, "11.") {
			recIdx = i
			break
		}
	}
	opts := make([]DatabaseVersionOption, 0, len(lines))
	for i, l := range lines {
		label := "MariaDB " + l
		if i == recIdx {
			label += " (LTS)"
		}
		opts = append(opts, DatabaseVersionOption{Value: l, Label: label, Recommended: i == recIdx})
	}
	return opts, nil
}

func fallbackVersionOptions(engine string) []DatabaseVersionOption {
	switch engine {
	case "postgres":
		return []DatabaseVersionOption{
			{Value: "18", Label: "PostgreSQL 18 (Recommended)", Recommended: true},
			{Value: "17", Label: "PostgreSQL 17"},
			{Value: "16", Label: "PostgreSQL 16"},
			{Value: "15", Label: "PostgreSQL 15"},
			{Value: "14", Label: "PostgreSQL 14"},
		}
	case "mysql", "mariadb":
		return []DatabaseVersionOption{
			{Value: "11.8", Label: "MariaDB 11.8 (LTS)", Recommended: true},
			{Value: "11.4", Label: "MariaDB 11.4 (LTS)"},
			{Value: "10.11", Label: "MariaDB 10.11 (LTS)"},
		}
	default: // surrealdb
		return []DatabaseVersionOption{
			{Value: "v3.3.0", Label: "v3.3.0 (Latest Stable)", Recommended: true},
			{Value: "v3.2.5", Label: "v3.2.5"},
			{Value: "v3.1.6", Label: "v3.1.6"},
			{Value: "v2.7.0", Label: "v2.7.0"},
			{Value: "v2.2.1", Label: "v2.2.1"},
		}
	}
}

// GetDatabaseVersions returns installable version options for a stack engine,
// sourced live from upstream release endpoints with an hour-long cache and a
// baked-in fallback when offline or rate-limited.
func (a *App) GetDatabaseVersions(engine string) ([]DatabaseVersionOption, error) {
	eng := strings.ToLower(strings.TrimSpace(engine))
	if eng == "mariadb" {
		eng = "mysql"
	}

	versionCache.Lock()
	if e, ok := versionCache.entries[eng]; ok && time.Since(e.fetched) < versionCacheTTL {
		opts := e.options
		versionCache.Unlock()
		return opts, nil
	}
	versionCache.Unlock()

	var opts []DatabaseVersionOption
	var err error
	switch eng {
	case "postgres":
		opts, err = livePostgresVersions()
	case "mysql":
		opts, err = liveMariaDBVersions()
	default:
		opts, err = liveSurrealDBVersions()
	}
	if err != nil || len(opts) == 0 {
		opts = fallbackVersionOptions(eng)
		return opts, nil
	}

	versionCache.Lock()
	versionCache.entries[eng] = versionCacheEntry{fetched: time.Now(), options: opts}
	versionCache.Unlock()
	return opts, nil
}

// OpenURL opens a URL in the OS default browser. Plain <a target="_blank">
// anchors do not escape the Wails webview, so all "open" buttons route here.
func (a *App) OpenURL(targetURL string) error {
	if a.ctx == nil {
		return fmt.Errorf("app context not ready")
	}
	u := strings.TrimSpace(targetURL)
	if u == "" {
		return fmt.Errorf("empty url")
	}
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		return fmt.Errorf("refusing to open non-http(s) url")
	}
	runtime.BrowserOpenURL(a.ctx, u)
	return nil
}

type EndpointProbe struct {
	Name       string `json:"name"`
	URL        string `json:"url"`
	OK         bool   `json:"ok"`
	StatusCode int    `json:"statusCode"`
	LatencyMs  int64  `json:"latencyMs"`
	Error      string `json:"error,omitempty"`
}

// ProbeEndpoint checks one URL and reports status + latency. Loopback hosts
// (127.0.0.1/localhost) are probed ON the VPS over SSH, since they refer to
// the remote host; public URLs are probed from the desktop.
func (a *App) ProbeEndpoint(serverID, name, targetURL string) (*EndpointProbe, error) {
	probe := &EndpointProbe{Name: name, URL: targetURL}

	u, err := url.Parse(targetURL)
	if err != nil || u.Host == "" {
		probe.Error = "malformed url"
		return probe, nil
	}

	start := time.Now()
	host := u.Hostname()
	if host == "127.0.0.1" || host == "localhost" || host == "::1" {
		srv, err := a.store.GetServer(serverID)
		if err != nil {
			probe.Error = err.Error()
			return probe, nil
		}
		client, err := sshclient.NewClient(*srv)
		if err != nil {
			probe.Error = "ssh: " + err.Error()
			return probe, nil
		}
		defer client.Close()

		out, _ := client.RunCommand(fmt.Sprintf(
			"curl -s -o /dev/null -w '%%{http_code} %%{time_total}' -m 8 %s 2>/dev/null; echo \"EXIT:$?\"",
			shellSingleQuote(targetURL)))
		raw := strings.TrimSpace(out)
		body := raw
		exitOK := strings.HasSuffix(raw, "EXIT:0")
		if idx := strings.LastIndex(raw, "EXIT:"); idx >= 0 {
			body = strings.TrimSpace(raw[:idx])
		}
		fields := strings.Fields(body)
		if len(fields) >= 1 {
			fmt.Sscanf(fields[0], "%d", &probe.StatusCode)
		}
		if len(fields) >= 2 {
			var secs float64
			fmt.Sscanf(fields[1], "%f", &secs)
			probe.LatencyMs = int64(secs * 1000)
		}
		probe.LatencyMs = time.Since(start).Milliseconds()
		if !exitOK || probe.StatusCode == 0 {
			probe.Error = "connection refused or timed out on VPS"
			return probe, nil
		}
		probe.OK = probe.StatusCode >= 200 && probe.StatusCode < 400
		if !probe.OK {
			probe.Error = fmt.Sprintf("HTTP %d", probe.StatusCode)
		}
		return probe, nil
	}

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(targetURL)
	probe.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		probe.Error = err.Error()
		return probe, nil
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	probe.StatusCode = resp.StatusCode
	probe.OK = resp.StatusCode >= 200 && resp.StatusCode < 400
	if !probe.OK {
		probe.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return probe, nil
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

func (a *App) DeleteProject(projectID string) error {
	return a.store.DeleteProject(projectID)
}

func (a *App) DeployProject(projectID string) error {
	projects := a.store.GetProjects()
	for _, p := range projects {
		if p.ID == projectID {
			go func(proj store.ProjectConfig) {
				if err := a.pipeline.Execute(proj); err != nil {
					runtime.EventsEmit(a.ctx, "deploy:error", err.Error())
				} else {
					runtime.EventsEmit(a.ctx, "deploy:success", proj.ID)
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

// ResetVPS wipes remote services and layout, and deletes all associated local project recipes.
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
			// Wipe local project recipes bound to this server
			_ = a.store.DeleteProjectsByServer(serverID)
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

func dbServiceName(dbType string) string {
	switch dbType {
	case "postgres":
		return "postgresql"
	case "mysql":
		return "mariadb"
	default:
		return dbType
	}
}

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

func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

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

	localPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Database Backup",
		DefaultFilename: defaultFilename,
	})
	if err != nil || localPath == "" {
		return "", fmt.Errorf("backup cancelled")
	}

	if _, err := client.RunCommand(fmt.Sprintf("mkdir -p /opt/skiff/backups && %s", dumpCmd)); err != nil {
		return "", fmt.Errorf("remote database dump failed: %w", err)
	}

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
