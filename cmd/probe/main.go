package main

import (
	"crypto/tls"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"skiff/pkg/sshclient"
	"skiff/pkg/store"
)

// ANSI color helpers
const (
	colorReset  = "\033[0m"
	colorRed    = "\033[1;31m"
	colorGreen  = "\033[1;32m"
	colorYellow = "\033[1;33m"
	colorBlue   = "\033[1;34m"
	colorCyan   = "\033[1;36m"
)

var (
	passCount int
	failCount int
	warnCount int
)

func pass(msg string) { fmt.Printf(" %s[PASS]%s  %s\n", colorGreen, colorReset, msg); passCount++ }
func fail(msg string) { fmt.Printf(" %s[FAIL]%s  %s\n", colorRed, colorReset, msg); failCount++ }
func warn(msg string) { fmt.Printf(" %s[WARN]%s  %s\n", colorYellow, colorReset, msg); warnCount++ }
func info(msg string) { fmt.Printf(" %s[INFO]%s  %s\n", colorBlue, colorReset, msg) }
func step(msg string) { fmt.Printf("\n%s==>%s \033[1m%s\033[0m\n", colorCyan, colorReset, msg) }

// sanitizeSlug mirrors sanitizeAppName in app.go: the systemd unit and
// Caddy snippet file are keyed by the appDir basename, never the display name.
func sanitizeSlug(appDir string) string {
	clean := strings.Trim(strings.TrimSpace(appDir), "/")
	base := clean
	if idx := strings.LastIndex(clean, "/"); idx >= 0 {
		base = clean[idx+1:]
	}
	var b strings.Builder
	for _, r := range base {
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

func main() {
	serverHost := flag.String("server", "", "VPS server IP or hostname")
	serverUser := flag.String("user", "root", "SSH user")
	serverPort := flag.Int("port", 22, "SSH port")
	keyPath := flag.String("key", "", "Path to private key")
	password := flag.String("password", "", "SSH password")
	appDir := flag.String("app-dir", "", "Remote app directory (e.g. /opt/skiff/apps/myapp)")
	appName := flag.String("app", "", "App service name")
	appPort := flag.Int("app-port", 8080, "Backend port")
	domain := flag.String("domain", "", "Custom domain")
	healthURL := flag.String("health", "", "Health check URL")
	flag.Parse()

	// Auto-load from ~/.skiff/config.json if args missing
	mgr, err := store.NewManager()
	if err == nil && *serverHost == "" {
		servers := mgr.GetServers()
		if len(servers) > 0 {
			s := servers[0]
			*serverHost = s.Host
			*serverUser = s.User
			*serverPort = s.Port
			*keyPath = s.KeyPath
			*password = s.Password
		}
		projects := mgr.GetProjects()
		if len(projects) > 0 {
			p := projects[0]
			if *appName == "" && p.Name != "" {
				*appName = p.Name
			}
			if *appDir == "" && p.AppDir != "" {
				*appDir = p.AppDir
			}
			if p.TargetPort > 0 {
				*appPort = p.TargetPort
			}
			if *domain == "" && p.Domain != "" {
				*domain = p.Domain
			}
			if *healthURL == "" && p.HealthURL != "" {
				*healthURL = p.HealthURL
			}
		}
	}

	if *serverHost == "" {
		fmt.Println("[ERROR] Server host is required. Use -server <ip> or configure ~/.skiff/config.json")
		os.Exit(1)
	}

	// Derive appDir from appName if not set
	if *appDir == "" && *appName != "" {
		*appDir = "/opt/skiff/apps/" + *appName
	}

	// The systemd unit / Caddy snippet slug is derived from the appDir
	// basename (mirrors sanitizeAppName in app.go). A display Name such as
	// "Esper Notes" is never a valid unit name, so prefer the slug.
	if *appDir != "" {
		slug := sanitizeSlug(*appDir)
		if *appName == "" || *appName != slug {
			if *appName == "" || strings.ContainsAny(*appName, " \t") {
				info(fmt.Sprintf("Using service slug '%s' derived from appDir (display name '%s' is not a valid unit name).", slug, *appName))
				*appName = slug
			}
		}
	}

	fmt.Printf("\n%s================================================================%s\n", colorBlue, colorReset)
	fmt.Printf(" %sSKIFF AUTOMATED DEPLOYMENT DIAGNOSTICS%s\n", colorCyan, colorReset)
	fmt.Printf("%s================================================================%s\n", colorBlue, colorReset)
	fmt.Printf(" Server : %s@%s:%d\n", *serverUser, *serverHost, *serverPort)
	fmt.Printf(" App    : %s (%s, port %d)\n", *appName, *appDir, *appPort)
	if *domain != "" {
		fmt.Printf(" Domain : %s\n", *domain)
	}
	fmt.Printf("%s----------------------------------------------------------------%s\n", colorBlue, colorReset)

	// Phase 1: SSH Connection
	step("1. SSH Connection & Authentication")
	srvCfg := store.ServerConfig{
		Host:     *serverHost,
		Port:     *serverPort,
		User:     *serverUser,
		AuthType: "key",
		KeyPath:  *keyPath,
		Password: *password,
	}
	if *password != "" && *keyPath == "" {
		srvCfg.AuthType = "password"
	}

	client, err := sshclient.NewClient(srvCfg)
	if err != nil {
		fail(fmt.Sprintf("SSH Connection Failed: %v", err))
		os.Exit(1)
	}
	defer client.Close()

	sysInfo, _ := client.RunCommand("uname -srm")
	pass(fmt.Sprintf("SSH connection established. (%s)", strings.TrimSpace(sysInfo)))

	// Phase 2: Remote Release Symlink & Directory
	step("2. Release Directory & Atomic Symlink")
	if *appDir != "" {
		checkDirCmd := fmt.Sprintf(`sh -c '
APP_DIR="%s"
if [ ! -d "$APP_DIR" ]; then echo "NOT_FOUND"; exit 0; fi
CURR=$(readlink "$APP_DIR/current" 2>/dev/null || echo "NO_LINK")
COUNT=$(ls -1 "$APP_DIR/releases" 2>/dev/null | wc -l | tr -d " " || echo "0")
echo "OK:$CURR:$COUNT"
'`, *appDir)

		out, err := client.RunCommand(checkDirCmd)
		trimmed := strings.TrimSpace(out)
		if err != nil || trimmed == "NOT_FOUND" {
			fail(fmt.Sprintf("Remote directory %s not found on VPS.", *appDir))
		} else if strings.HasPrefix(trimmed, "OK:") {
			parts := strings.SplitN(strings.TrimPrefix(trimmed, "OK:"), ":", 2)
			if len(parts) >= 1 && parts[0] != "NO_LINK" && parts[0] != "" {
				count := ""
				if len(parts) >= 2 {
					count = parts[1]
				}
				pass(fmt.Sprintf("Active symlink current/ -> %s (%s release(s) stored)", parts[0], strings.TrimSpace(count)))
			} else {
				fail("Directory exists but current/ symlink is broken or missing.")
			}
		}
	} else {
		warn("No app-dir configured, skipping release directory check.")
	}

	// Phase 3: Systemd Service Status
	step("3. Systemd Service Status")
	if *appName != "" {
		svcCmd := fmt.Sprintf(`sh -c '
if systemctl cat "%s.service" >/dev/null 2>&1; then
  systemctl is-active "%s" 2>/dev/null || true
else
  echo "UNIT_MISSING"
fi'`, *appName, *appName)
		svcStatus, _ := client.RunCommand(svcCmd)
		svcStatus = strings.TrimSpace(svcStatus)
		switch svcStatus {
		case "active":
			pass(fmt.Sprintf("Systemd service '%s.service' is ACTIVE.", *appName))
		case "UNIT_MISSING":
			warn(fmt.Sprintf("No systemd unit '%s.service' found. App may use a different process manager.", *appName))
		default:
			fail(fmt.Sprintf("Service '%s.service' state is: %s (expected 'active')", *appName, svcStatus))
		}
	} else {
		warn("No app name configured, skipping service status check.")
	}

	// Phase 4: Caddy Snippet Check
	step("4. Caddy Snippet & Direct IP Block")
	if *appName != "" {
		snippetCmd := fmt.Sprintf("cat /opt/skiff/caddy/conf.d/%s.caddy 2>/dev/null || echo 'SNIPPET_MISSING'", *appName)
		snippetOut, _ := client.RunCommand(snippetCmd)
		snippetOut = strings.TrimSpace(snippetOut)
		if snippetOut == "SNIPPET_MISSING" {
			warn(fmt.Sprintf("No Caddy snippet at /opt/skiff/caddy/conf.d/%s.caddy — deploy first.", *appName))
		} else {
			pass(fmt.Sprintf("Caddy snippet found for '%s'.", *appName))
			if strings.Contains(snippetOut, "http://"+*serverHost) {
				pass(fmt.Sprintf("Direct IP block (http://%s) present in Caddy snippet.", *serverHost))
			} else {
				warn(fmt.Sprintf("Direct IP block (http://%s) NOT found in snippet — port 80 direct access may not work.", *serverHost))
				info("Expected line: `http://" + *serverHost + " { ... }`")
			}
		}
	} else {
		warn("No app name configured, skipping Caddy snippet check.")
	}

	// Phase 5: Caddy Service Active
	step("5. Caddy Service & Config Validation")
	caddyCmd := `sh -c '
if ! command -v caddy >/dev/null 2>&1; then echo "CADDY_NOT_INSTALLED"; exit 0; fi
IS_ACTIVE=$(systemctl is-active caddy 2>/dev/null || echo "stopped")
VAL=$(caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -n 1)
echo "$IS_ACTIVE|$VAL"
'`
	caddyOut, _ := client.RunCommand(caddyCmd)
	caddyOut = strings.TrimSpace(caddyOut)
	if caddyOut == "CADDY_NOT_INSTALLED" {
		fail("Caddy binary is not installed on VPS.")
	} else {
		parts := strings.SplitN(caddyOut, "|", 2)
		caddyActive := ""
		caddyVal := ""
		if len(parts) >= 1 {
			caddyActive = strings.TrimSpace(parts[0])
		}
		if len(parts) >= 2 {
			caddyVal = strings.TrimSpace(parts[1])
		}
		if caddyActive == "active" {
			pass("Caddy service is active.")
		} else {
			fail(fmt.Sprintf("Caddy service is '%s' (expected active).", caddyActive))
		}
		if strings.Contains(caddyVal, "valid") || strings.Contains(caddyVal, "Valid") {
			pass("Caddyfile configuration validated successfully.")
		} else {
			warn(fmt.Sprintf("Caddy validation: %s", caddyVal))
		}
	}

	// Phase 6: Direct IP Access (Port 80 via Caddy)
	step(fmt.Sprintf("6. Direct IP Access (http://%s — Port 80 via Caddy)", *serverHost))
	directIPURL := fmt.Sprintf("http://%s", *serverHost)
	httpClient := &http.Client{Timeout: 8 * time.Second}
	resp, err := httpClient.Get(directIPURL)
	if err == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		code := resp.StatusCode
		if code >= 200 && code < 400 {
			pass(fmt.Sprintf("Direct IP URL reachable: %s (HTTP %d)", directIPURL, code))
		} else if code == 502 {
			fail(fmt.Sprintf("HTTP 502 Bad Gateway — Caddy reached but backend port 127.0.0.1:%d refused (is app running?)", *appPort))
		} else {
			warn(fmt.Sprintf("Direct IP URL responded with HTTP %d (%s)", code, directIPURL))
		}
	} else {
		errStr := err.Error()
		if strings.Contains(errStr, "connection refused") {
			fail(fmt.Sprintf("Port 80 connection refused on %s — Caddy may not be listening or firewall blocks port 80.", *serverHost))
		} else if strings.Contains(errStr, "timeout") || strings.Contains(errStr, "deadline") {
			fail(fmt.Sprintf("Port 80 connection timed out — firewall likely blocking port 80 on %s.", *serverHost))
		} else {
			fail(fmt.Sprintf("Direct IP URL unreachable: %v", err))
		}
		info("Fix: run `ufw allow 80/tcp` and `ufw allow 443/tcp` on your VPS.")
	}

	// Phase 6b: Port 443 listener check. Browsers (Chrome) upgrade bare-IP
	// navigation to HTTPS first; a refused 443 shows "This site can't be reached"
	// even when port 80 is healthy. Caddy never serves TLS for a bare IP, so
	// users must open the explicit http:// URL.
	step(fmt.Sprintf("6b. HTTPS Port 443 Listener (https://%s)", *serverHost))
	tlsDialer := &net.Dialer{Timeout: 5 * time.Second}
	tlsConn, tlsErr := tls.DialWithDialer(tlsDialer, "tcp", fmt.Sprintf("%s:443", *serverHost), &tls.Config{InsecureSkipVerify: true})
	if tlsErr == nil {
		_ = tlsConn.Close()
		pass(fmt.Sprintf("Port 443 accepts TLS connections on %s.", *serverHost))
	} else {
		warn(fmt.Sprintf("Port 443 refused/timed out on %s (%v).", *serverHost, tlsErr))
		info("Browsers default to https:// for bare IPs — with no TLS listener they show 'This site can't be reached'.")
		info("This is EXPECTED for direct-IP access: share the explicit http:// URL (port 80 via Caddy).")
	}

	// Phase 7: UFW Firewall Check
	step("7. UFW Firewall Port Audit")
	ufwCmd := `sh -c '
if command -v ufw >/dev/null 2>&1; then
  ufw status 2>/dev/null | head -20
else
  echo "UFW_NOT_FOUND"
fi'`
	ufwOut, _ := client.RunCommand(ufwCmd)
	ufwOut = strings.TrimSpace(ufwOut)
	if ufwOut == "UFW_NOT_FOUND" {
		warn("UFW not found. Firewall rules may be managed via iptables or cloud provider firewall.")
	} else if strings.Contains(ufwOut, "Status: inactive") {
		info("UFW is installed but INACTIVE — no firewall filtering (all ports reachable).")
	} else if strings.Contains(ufwOut, "Status: active") {
		info("UFW is ACTIVE. Relevant rules:")
		for _, l := range strings.Split(ufwOut, "\n") {
			if strings.Contains(l, "ALLOW") {
				info("  " + strings.TrimSpace(l))
			}
		}
		if strings.Contains(ufwOut, "80") && strings.Contains(ufwOut, "ALLOW") {
			pass("Port 80 is explicitly allowed in UFW.")
		} else {
			warn("Port 80 not found in UFW ALLOW rules — direct IP access may be blocked.")
		}
		if strings.Contains(ufwOut, fmt.Sprintf("%d", *appPort)) && strings.Contains(ufwOut, "ALLOW") {
			pass(fmt.Sprintf("App port %d is allowed in UFW.", *appPort))
		} else {
			info(fmt.Sprintf("App port %d not in UFW rules (OK if app is only accessible via reverse proxy).", *appPort))
		}
	} else {
		warn(fmt.Sprintf("Unexpected ufw output: %s", ufwOut))
	}

	// Phase 8: Custom Domain DNS and HTTPS
	if *domain != "" {
		step(fmt.Sprintf("8. Custom Domain DNS & HTTPS (%s)", *domain))
		ips, err := net.LookupIP(*domain)
		if err == nil && len(ips) > 0 {
			pointing := false
			resolved := make([]string, 0)
			for _, ip := range ips {
				resolved = append(resolved, ip.String())
				if ip.String() == *serverHost {
					pointing = true
				}
			}
			if pointing {
				pass(fmt.Sprintf("Domain %s resolves to VPS IP (%s)", *domain, *serverHost))
			} else {
				warn(fmt.Sprintf("Domain %s resolves to %v (expected %s). DNS propagation may be pending.", *domain, resolved, *serverHost))
			}
		} else {
			warn(fmt.Sprintf("Could not resolve domain %s: %v", *domain, err))
		}

		tr := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
		}
		tlsClient := &http.Client{Transport: tr, Timeout: 8 * time.Second}
		domainURL := fmt.Sprintf("https://%s", *domain)
		dResp, err := tlsClient.Get(domainURL)
		if err == nil {
			_, _ = io.Copy(io.Discard, dResp.Body)
			_ = dResp.Body.Close()
			code := dResp.StatusCode
			switch {
			case code >= 200 && code < 400:
				pass(fmt.Sprintf("HTTPS verified for %s (HTTP %d)", domainURL, code))
			case code == 521:
				fail(fmt.Sprintf("HTTPS %s returned 521 (Cloudflare: web server is down — origin %s unreachable, app not deployed or Caddy not routing).", domainURL, *serverHost))
			case code == 522:
				fail(fmt.Sprintf("HTTPS %s returned 522 (Cloudflare: connection timed out to origin %s — check firewall port 80/443).", domainURL, *serverHost))
			case code >= 500:
				fail(fmt.Sprintf("HTTPS %s returned HTTP %d (origin/CDN error).", domainURL, code))
			default:
				warn(fmt.Sprintf("HTTPS %s returned HTTP %d.", domainURL, code))
			}
		} else {
			warn(fmt.Sprintf("HTTPS request failed for %s: %v", domainURL, err))
		}
	}

	// Phase 9: Health Endpoint Probe.
	// Loopback URLs (127.0.0.1/localhost) refer to the VPS itself, so the
	// probe MUST run on the remote host over SSH — probing them from this
	// machine would test the wrong host entirely.
	if *healthURL != "" {
		step(fmt.Sprintf("9. Health Endpoint Probe (%s)", *healthURL))
		healthHost := ""
		if u, perr := url.Parse(*healthURL); perr == nil {
			healthHost = u.Hostname()
		}
		if healthHost == "127.0.0.1" || healthHost == "localhost" || healthHost == "::1" {
			info("Health URL is loopback — executing probe ON the VPS over SSH.")
			// POSIX-safe quoting for the remote shell.
			quoted := "'" + strings.ReplaceAll(*healthURL, "'", "'\\''") + "'"
			hOut, _ := client.RunCommand(fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 5 -m 8 %s 2>/dev/null; echo \"EXIT:$?\"", quoted))
			// Output looks like "200EXIT:0" on success or "000EXIT:7" on refused.
			hOut = strings.TrimSpace(hOut)
			hCode := strings.TrimSuffix(hOut, "EXIT:0")
			hCode = strings.TrimSuffix(hCode, "EXIT:7")
			hCode = strings.TrimSpace(hCode)
			switch {
			case strings.HasSuffix(hOut, "EXIT:0") && len(hCode) == 3 && hCode[0] == '2':
				pass(fmt.Sprintf("Health check verified on VPS: %s (HTTP %s)", *healthURL, hCode))
			case hCode == "000" || strings.Contains(hOut, "EXIT:7"):
				fail(fmt.Sprintf("Health check unreachable on VPS: %s (connection refused — is the app listening on the backend port?)", *healthURL))
			default:
				fail(fmt.Sprintf("Health check on VPS returned HTTP %s for %s", hCode, *healthURL))
			}
		} else {
			hResp, err := httpClient.Get(*healthURL)
			if err == nil {
				_, _ = io.Copy(io.Discard, hResp.Body)
				_ = hResp.Body.Close()
				if hResp.StatusCode >= 200 && hResp.StatusCode < 400 {
					pass(fmt.Sprintf("Health check verified: %s (HTTP %d)", *healthURL, hResp.StatusCode))
				} else {
					fail(fmt.Sprintf("Health check failed with HTTP %d for %s", hResp.StatusCode, *healthURL))
				}
			} else {
				fail(fmt.Sprintf("Health check timed out: %v", err))
			}
		}
	}

	// Summary
	fmt.Printf("\n%s================================================================%s\n", colorBlue, colorReset)
	fmt.Printf(" %sDIAGNOSTIC SUMMARY%s\n", colorCyan, colorReset)
	fmt.Printf("%s================================================================%s\n", colorBlue, colorReset)
	fmt.Printf("  Passed   : %s%d%s\n", colorGreen, passCount, colorReset)
	fmt.Printf("  Warnings : %s%d%s\n", colorYellow, warnCount, colorReset)
	fmt.Printf("  Failed   : %s%d%s\n", colorRed, failCount, colorReset)

	if failCount == 0 {
		fmt.Printf("\n %sALL CRITICAL CHECKS PASSED! Deployment is live and accessible.%s\n\n", colorGreen, colorReset)
		os.Exit(0)
	} else {
		fmt.Printf("\n %sSOME TESTS FAILED! Check the failure logs above.%s\n\n", colorRed, colorReset)
		os.Exit(1)
	}
}
