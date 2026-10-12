#!/usr/bin/env bash
# ==============================================================================
# Skiff Deployment & Accessibility Test Suite
#
# Automated terminal diagnostics for low-end VPS deployments:
# - SSH authentication & host metrics
# - Application release directory & symlink sanity
# - Systemd unit status
# - Caddy reverse-proxy configuration validation
# - Direct IP access test (HTTP port 80 via Caddy)
# - Direct backend port firewall & listener test
# - Domain DNS propagation & SSL accessibility
# - Application health check endpoint probe
# ==============================================================================

set -o pipefail

# ANSI Color Codes
CLR_RESET="\033[0m"
CLR_RED="\033[1;31m"
CLR_GREEN="\033[1;32m"
CLR_YELLOW="\033[1;33m"
CLR_BLUE="\033[1;34m"
CLR_CYAN="\033[1;36m"
CLR_GRAY="\033[0;90m"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

log_info()  { echo -e " ${CLR_BLUE}[INFO]${CLR_RESET}  $1"; }
log_pass()  { echo -e " ${CLR_GREEN}[PASS]${CLR_RESET}  $1"; ((PASS_COUNT++)); }
log_fail()  { echo -e " ${CLR_RED}[FAIL]${CLR_RESET}  $1"; ((FAIL_COUNT++)); }
log_warn()  { echo -e " ${CLR_YELLOW}[WARN]${CLR_RESET}  $1"; ((WARN_COUNT++)); }
log_step()  { echo -e "\n${CLR_CYAN}==>${CLR_RESET} \033[1m$1\033[0m"; }

# ----------------- Defaults & Flag Parsing -----------------
SERVER_HOST=""
SERVER_PORT=22
SERVER_USER="root"
SSH_KEY=""
APP_NAME=""
APP_DIR=""
APP_PORT=8080
DOMAIN=""
HEALTH_URL=""
CONFIG_FILE=""

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -c, --config <path>     Path to skiff.json (auto-populates fields)"
    echo "  -s, --server <host>     VPS Host or IP address"
    echo "  -u, --user <user>       SSH username (default: root)"
    echo "  -p, --ssh-port <port>   SSH port (default: 22)"
    echo "  -k, --key <path>        SSH private key path"
    echo "  -a, --app <name>        App name / systemd service name"
    echo "  -d, --app-dir <dir>     App remote dir (default: /opt/skiff/apps/<app>)"
    echo "  -P, --app-port <port>   Backend port (default: 8080)"
    echo "  -D, --domain <domain>   Custom domain name (optional)"
    echo "  -H, --health <url>      Health check endpoint URL (optional)"
    echo "  -h, --help              Show this help message"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--config) CONFIG_FILE="$2"; shift 2 ;;
        -s|--server) SERVER_HOST="$2"; shift 2 ;;
        -u|--user) SERVER_USER="$2"; shift 2 ;;
        -p|--ssh-port) SERVER_PORT="$2"; shift 2 ;;
        -k|--key) SSH_KEY="$2"; shift 2 ;;
        -a|--app) APP_NAME="$2"; shift 2 ;;
        -d|--app-dir) APP_DIR="$2"; shift 2 ;;
        -P|--app-port) APP_PORT="$2"; shift 2 ;;
        -D|--domain) DOMAIN="$2"; shift 2 ;;
        -H|--health) HEALTH_URL="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown flag: $1"; usage ;;
    esac
done

# Auto-discover skiff.json if not specified
if [[ -z "$CONFIG_FILE" && -f "skiff.json" ]]; then
    CONFIG_FILE="skiff.json"
fi

if [[ -n "$CONFIG_FILE" && -f "$CONFIG_FILE" ]]; then
    log_info "Reading parameters from $CONFIG_FILE..."
    if command -v jq &>/dev/null; then
        [[ -z "$APP_NAME" ]] && APP_NAME=$(jq -r '.name // .id // empty' "$CONFIG_FILE")
        [[ -z "$APP_DIR" ]] && APP_DIR=$(jq -r '.appDir // empty' "$CONFIG_FILE")
        [[ -z "$DOMAIN" ]] && DOMAIN=$(jq -r '.domain // empty' "$CONFIG_FILE")
        CFG_PORT=$(jq -r '.targetPort // empty' "$CONFIG_FILE")
        [[ -n "$CFG_PORT" && "$CFG_PORT" != "null" ]] && APP_PORT="$CFG_PORT"
        [[ -z "$HEALTH_URL" ]] && HEALTH_URL=$(jq -r '.healthUrl // empty' "$CONFIG_FILE")
    fi
fi

# Fallback: Extract app name from appDir if missing
if [[ -z "$APP_NAME" && -n "$APP_DIR" ]]; then
    APP_NAME=$(basename "$APP_DIR")
fi
if [[ -z "$APP_DIR" && -n "$APP_NAME" ]]; then
    APP_DIR="/opt/skiff/apps/$APP_NAME"
fi
# The systemd unit / Caddy snippet slug is the appDir basename, never the
# display name (mirrors sanitizeAppName in app.go). A name with spaces such
# as "Esper Notes" is never a valid unit name.
if [[ -n "$APP_DIR" && ( -z "$APP_NAME" || "$APP_NAME" == *" "* ) ]]; then
    DERIVED_SLUG=$(basename "$APP_DIR" | tr ' ' '-')
    if [[ "$APP_NAME" != "$DERIVED_SLUG" ]]; then
        log_info "Using service slug '$DERIVED_SLUG' derived from appDir (display name '$APP_NAME' is not a valid unit name)."
        APP_NAME="$DERIVED_SLUG"
    fi
fi

# Try extracting server IP from ~/.skiff/config.json if still missing
if [[ -z "$SERVER_HOST" && -f "$HOME/.skiff/config.json" ]] && command -v jq &>/dev/null; then
    SERVER_HOST=$(jq -r '.servers[0].host // empty' "$HOME/.skiff/config.json")
    [[ -z "$SERVER_USER" ]] && SERVER_USER=$(jq -r '.servers[0].user // "root"' "$HOME/.skiff/config.json")
    [[ -z "$SSH_KEY" ]] && SSH_KEY=$(jq -r '.servers[0].keyPath // empty' "$HOME/.skiff/config.json")
fi

if [[ -z "$SERVER_HOST" ]]; then
    echo -e "${CLR_RED}Error: Server host/IP required (-s <ip>).${CLR_RESET}"
    usage
fi

SSH_OPTS=(-p "$SERVER_PORT" -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no)
if [[ -n "$SSH_KEY" && -f "$SSH_KEY" ]]; then
    SSH_OPTS+=(-i "$SSH_KEY")
fi

run_ssh() {
    ssh "${SSH_OPTS[@]}" "$SERVER_USER@$SERVER_HOST" "$@"
}

echo -e "\n${CLR_BLUE}================================================================${CLR_RESET}"
echo -e " ${CLR_CYAN}SKIFF AUTOMATED DEPLOYMENT & ACCESSIBILITY AUDIT${CLR_RESET}"
echo -e "${CLR_BLUE}================================================================${CLR_RESET}"
echo -e " Target VPS   : ${CLR_CYAN}$SERVER_USER@$SERVER_HOST:$SERVER_PORT${CLR_RESET}"
echo -e " Target App   : ${CLR_CYAN}$APP_NAME${CLR_RESET} (${APP_DIR:-N/A})"
echo -e " Backend Port : ${CLR_CYAN}$APP_PORT${CLR_RESET}"
echo -e " Custom Domain: ${CLR_CYAN}${DOMAIN:-None}${CLR_RESET}"
echo -e "${CLR_BLUE}----------------------------------------------------------------${CLR_RESET}"

# ----------------- Test 1: SSH Connectivity -----------------
log_step "1. Testing SSH Connectivity & Authentication"
SSH_TEST_OUT=$(run_ssh "uname -srm; uptime" 2>&1)
if [[ $? -eq 0 ]]; then
    SYS_INFO=$(echo "$SSH_TEST_OUT" | head -n 1)
    SYS_UPTIME=$(echo "$SSH_TEST_OUT" | tail -n 1)
    log_pass "SSH connected successfully ($SYS_INFO)"
    log_info "Host Uptime: $SYS_UPTIME"
else
    log_fail "SSH connection failed: $SSH_TEST_OUT"
    echo -e "\n${CLR_RED}Aborting further remote tests because SSH connection failed.${CLR_RESET}"
    exit 2
fi

# ----------------- Test 2: Release Directory & Symlink -----------------
log_step "2. Verifying Release Directory & Atomic Symlink"
REMOTE_CHECK=$(run_ssh "sh -c '
    APP_DIR=\"$APP_DIR\"
    if [ ! -d \"\$APP_DIR\" ]; then echo \"NOT_FOUND\"; exit 0; fi
    CURRENT_TARGET=\$(readlink \"\$APP_DIR/current\" 2>/dev/null || echo \"NO_LINK\")
    REL_COUNT=\$(ls -1 \"\$APP_DIR/releases\" 2>/dev/null | wc -l || echo \"0\")
    echo \"OK:\$CURRENT_TARGET:\$REL_COUNT\"
'")

if [[ "$REMOTE_CHECK" == "NOT_FOUND" ]]; then
    log_fail "Application directory $APP_DIR does not exist on VPS."
elif [[ "$REMOTE_CHECK" == OK:* ]]; then
    IFS=":" read -r _ CURRENT_LINK COUNT <<< "$REMOTE_CHECK"
    if [[ "$CURRENT_LINK" == "NO_LINK" || -z "$CURRENT_LINK" ]]; then
        log_fail "Directory exists but '$APP_DIR/current' symlink is missing."
    else
        ACTIVE_REL=$(basename "$CURRENT_LINK")
        log_pass "Active symlink points to release '$ACTIVE_REL'"
        log_info "Releases present in $APP_DIR/releases: $COUNT"
    fi
else
    log_warn "Unexpected check output: $REMOTE_CHECK"
fi

# ----------------- Test 3: Systemd Service Status -----------------
log_step "3. Inspecting Systemd Service Status"
SVC_NAME="${APP_NAME}"
# NOTE: remote snippets run under `sh -c` (dash on Ubuntu), so they must use
# POSIX redirects (>/dev/null 2>&1). The bashism `&>` backgrounds the command
# under dash and breaks `if` conditions.
SVC_STATUS=$(run_ssh "sh -c '
    if systemctl cat \"$SVC_NAME.service\" >/dev/null 2>&1; then
        systemctl is-active \"$SVC_NAME\" 2>/dev/null || true
    else
        echo \"UNIT_MISSING\"
    fi
'")

if [[ "$SVC_STATUS" == "active" ]]; then
    log_pass "Service '$SVC_NAME.service' is running (active)"
elif [[ "$SVC_STATUS" == "UNIT_MISSING" ]]; then
    log_warn "No systemd unit '$SVC_NAME.service' found. (App may be binary or Docker-managed)"
else
    log_fail "Service '$SVC_NAME.service' state is '$SVC_STATUS' (expected active)"
fi

# ----------------- Test 4: Caddy Reverse Proxy & Syntax -----------------
log_step "4. Validating Caddy Status & Configuration"
CADDY_OUT=$(run_ssh "sh -c '
    if ! command -v caddy >/dev/null 2>&1; then echo \"CADDY_NOT_INSTALLED\"; exit 0; fi
    IS_ACTIVE=\$(systemctl is-active caddy 2>/dev/null || echo \"stopped\")
    VAL_MSG=\$(caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -n 1)
    echo \"\$IS_ACTIVE|\$VAL_MSG\"
'")

if [[ "$CADDY_OUT" == "CADDY_NOT_INSTALLED" ]]; then
    log_fail "Caddy binary is not installed on VPS."
else
    CADDY_ACTIVE="${CADDY_OUT%%|*}"
    CADDY_VAL="${CADDY_OUT#*|}"
    if [[ "$CADDY_ACTIVE" == "active" ]]; then
        log_pass "Caddy service is active"
    else
        log_fail "Caddy service is '$CADDY_ACTIVE'"
    fi

    if [[ "$CADDY_VAL" == *"Valid configuration"* || "$CADDY_VAL" == *"valid"* ]]; then
        log_pass "Caddyfile configuration validated successfully"
    else
        log_warn "Caddy validation message: $CADDY_VAL"
    fi
fi

# ----------------- Test 5: Caddy snippet for this app -----------------
log_step "5. Checking Caddy snippet for app '$APP_NAME'"
if [[ -n "$APP_NAME" ]]; then
    SNIPPET_OUT=$(run_ssh "cat /opt/skiff/caddy/conf.d/$APP_NAME.caddy 2>/dev/null || echo 'SNIPPET_MISSING'")
    if [[ "$SNIPPET_OUT" == "SNIPPET_MISSING" ]]; then
        log_warn "No Caddy snippet found at /opt/skiff/caddy/conf.d/$APP_NAME.caddy"
        log_info "The app may not have a Caddy route configured yet. Deploy or run ConfigureAppDomain first."
    else
        log_pass "Caddy snippet exists for '$APP_NAME':"
        echo "$SNIPPET_OUT" | while IFS= read -r line; do
            log_info "  $line"
        done
        # Check for direct IP block
        if echo "$SNIPPET_OUT" | grep -q "http://$SERVER_HOST"; then
            log_pass "Direct IP block (http://$SERVER_HOST) is present in Caddy snippet"
        else
            log_warn "Direct IP block (http://$SERVER_HOST) NOT found in Caddy snippet — Direct IP access via port 80 may not work"
        fi
    fi
fi

# ----------------- Test 6: Direct IP Access (Port 80 via Caddy) -----------------
log_step "6. Testing Direct IP Access (http://$SERVER_HOST on Port 80)"
DIRECT_IP_URL="http://$SERVER_HOST"
IP_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 -m 8 "$DIRECT_IP_URL" || echo "ERR")

if [[ "$IP_HTTP_CODE" =~ ^(200|201|204|301|302|304|307|308)$ ]]; then
    log_pass "Direct IP URL responded with HTTP $IP_HTTP_CODE ($DIRECT_IP_URL)"
elif [[ "$IP_HTTP_CODE" == "404" ]]; then
    log_warn "Direct IP returned HTTP 404 (Caddy is up, but no default host block matched http://$SERVER_HOST)"
elif [[ "$IP_HTTP_CODE" == "502" ]]; then
    log_fail "Direct IP returned HTTP 502 Bad Gateway (Caddy is up, but backend port 127.0.0.1:$APP_PORT refused connection)"
elif [[ "$IP_HTTP_CODE" == "ERR" ]]; then
    log_fail "Direct IP connection failed: Connection timed out or refused on port 80."
    log_warn "Possible causes: port 80 not open in UFW, Caddy not running, or no http://<ip> block in Caddyfile"
else
    log_info "Direct IP returned HTTP $IP_HTTP_CODE"
fi

# ----------------- Test 6b: Port 443 listener (Chrome HTTPS-first) -----------------
log_step "6b. Checking HTTPS Port 443 Listener (Chrome upgrades bare IPs to https://)"
if timeout 5 bash -c "echo > /dev/tcp/$SERVER_HOST/443" 2>/dev/null; then
    log_pass "Port 443 accepts TCP connections on $SERVER_HOST"
else
    log_warn "Port 443 refused/timed out on $SERVER_HOST."
    log_info "Browsers default to https:// for bare IPs — with no TLS listener they show 'This site can't be reached'."
    log_info "This is EXPECTED for direct-IP access: share the explicit http:// URL (port 80 via Caddy)."
fi

# ----------------- Test 7: UFW Firewall Port Check -----------------
log_step "7. Checking UFW Firewall Rules (port 80 and $APP_PORT)"
UFW_STATUS=$(run_ssh "sh -c '
    if command -v ufw >/dev/null 2>&1; then
        ufw status 2>/dev/null | head -20
    else
        echo \"UFW_NOT_FOUND\"
    fi
'")
if [[ "$UFW_STATUS" == "UFW_NOT_FOUND" ]]; then
    log_warn "UFW not found on server. Firewall rules may be managed elsewhere."
elif echo "$UFW_STATUS" | grep -q "Status: inactive"; then
    log_info "UFW is installed but INACTIVE — no firewall filtering (all ports reachable)."
elif echo "$UFW_STATUS" | grep -q "Status: active"; then
    log_info "UFW is ACTIVE. Relevant rules:"
    echo "$UFW_STATUS" | grep "ALLOW" | head -10 | while IFS= read -r line; do
        log_info "  $line"
    done
    if echo "$UFW_STATUS" | grep -qE "^80|Nginx Full|Caddy|80/tcp"; then
        log_pass "Port 80 appears to be allowed in UFW"
    else
        log_warn "Port 80 not explicitly found in UFW rules — may be blocking direct IP access"
    fi
    if echo "$UFW_STATUS" | grep -qE "$APP_PORT"; then
        log_pass "App port $APP_PORT appears to be allowed in UFW"
    else
        log_warn "App port $APP_PORT not found in UFW rules — direct port access may be blocked (OK if reverse-proxied)"
    fi
fi

# ----------------- Test 8: Direct Backend Port Probe -----------------
log_step "8. Testing Direct Port Reachability (http://$SERVER_HOST:$APP_PORT)"
if [[ "$APP_PORT" != "80" && "$APP_PORT" != "443" ]]; then
    PORT_RAW=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 -m 5 "http://$SERVER_HOST:$APP_PORT" 2>/dev/null; echo "EXIT:$?")
    PORT_HTTP_CODE="${PORT_RAW%EXIT:*}"  # e.g. "200" on success, "000" on refused/timeout
    if [[ "$PORT_HTTP_CODE" =~ ^[1-5][0-9][0-9]$ && "$PORT_HTTP_CODE" != "000" ]]; then
        log_pass "Port $APP_PORT reachable externally (HTTP $PORT_HTTP_CODE)"
    else
        log_warn "Port $APP_PORT is not reachable externally (refused/timeout — normal if backend binds 127.0.0.1 only; use http://$SERVER_HOST on port 80 instead)"
    fi
fi

# ----------------- Test 9: Custom Domain DNS & SSL Reachability -----------------
if [[ -n "$DOMAIN" ]]; then
    log_step "9. Testing Custom Domain & SSL ($DOMAIN)"
    RESOLVED_IP=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' || dig +short "$DOMAIN" 2>/dev/null | tail -n 1 || echo "")
    if [[ -n "$RESOLVED_IP" ]]; then
        if [[ "$RESOLVED_IP" == "$SERVER_HOST" ]]; then
            log_pass "Domain $DOMAIN points to VPS IP ($RESOLVED_IP)"
        else
            log_warn "Domain $DOMAIN points to $RESOLVED_IP (Expected $SERVER_HOST). DNS propagation pending."
        fi
    else
        log_warn "Could not resolve DNS for $DOMAIN."
    fi

    DOMAIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 -m 8 "https://$DOMAIN" 2>/dev/null || echo "HTTPS_ERR")
    if [[ "$DOMAIN_CODE" =~ ^(200|201|204|301|302|304|307|308)$ ]]; then
        log_pass "HTTPS reachability verified (HTTP $DOMAIN_CODE https://$DOMAIN)"
    elif [[ "$DOMAIN_CODE" == "521" ]]; then
        log_fail "https://$DOMAIN returned 521 (Cloudflare: web server is down — origin $SERVER_HOST unreachable, app not deployed or Caddy not routing)"
    elif [[ "$DOMAIN_CODE" == "522" ]]; then
        log_fail "https://$DOMAIN returned 522 (Cloudflare: connection timed out to origin $SERVER_HOST — check firewall ports 80/443)"
    elif [[ "$DOMAIN_CODE" == "HTTPS_ERR" ]]; then
        log_warn "HTTPS probe failed for https://$DOMAIN (SSL certificate might be issuing or DNS not propagated yet)"
    else
        log_info "https://$DOMAIN returned HTTP $DOMAIN_CODE"
    fi
fi

# ----------------- Test 10: Health Probe -----------------
# Loopback health URLs (127.0.0.1/localhost) refer to the VPS itself, so they
# MUST be probed ON the remote host over SSH — curling them locally tests the
# wrong machine entirely.
if [[ -n "$HEALTH_URL" ]]; then
    log_step "10. Testing Health Endpoint Probe ($HEALTH_URL)"
    if [[ "$HEALTH_URL" == *"127.0.0.1"* || "$HEALTH_URL" == *"localhost"* ]]; then
        log_info "Health URL is loopback — executing probe ON the VPS over SSH."
        ESCAPED_URL=$(printf '%s' "$HEALTH_URL" | sed "s/'/'\\\\''/g")
        HEALTH_RAW=$(run_ssh "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 -m 8 '$ESCAPED_URL' 2>/dev/null; echo \"EXIT:\$?\"")
        HEALTH_CODE="${HEALTH_RAW%EXIT:*}"  # e.g. "200" on success, "000" on refused/timeout
        if [[ "$HEALTH_CODE" =~ ^2[0-9][0-9]$ ]]; then
            log_pass "Health endpoint verified on VPS (HTTP $HEALTH_CODE)"
        elif [[ "$HEALTH_CODE" == "000" ]]; then
            log_fail "Health probe unreachable on VPS: $HEALTH_URL (connection refused — is the app listening?)"
        else
            log_fail "Health probe on VPS returned HTTP $HEALTH_CODE for $HEALTH_URL"
        fi
    else
        HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 -m 8 "$HEALTH_URL" 2>/dev/null || echo "TIMEOUT")
        if [[ "$HEALTH_CODE" =~ ^2[0-9][0-9]$ ]]; then
            log_pass "Health endpoint verified (HTTP $HEALTH_CODE)"
        else
            log_fail "Health probe returned HTTP $HEALTH_CODE for $HEALTH_URL"
        fi
    fi
fi

# ----------------- Scorecard Summary -----------------
echo -e "\n${CLR_BLUE}================================================================${CLR_RESET}"
echo -e " ${CLR_CYAN}TEST AUDIT SUMMARY${CLR_RESET}"
echo -e "${CLR_BLUE}================================================================${CLR_RESET}"
echo -e "  Passed   : ${CLR_GREEN}${PASS_COUNT}${CLR_RESET}"
echo -e "  Warnings : ${CLR_YELLOW}${WARN_COUNT}${CLR_RESET}"
echo -e "  Failed   : ${CLR_RED}${FAIL_COUNT}${CLR_RESET}"

if [[ $FAIL_COUNT -eq 0 ]]; then
    echo -e "\n ${CLR_GREEN}ALL CRITICAL CHECKS PASSED! Deployment is live and accessible.${CLR_RESET}\n"
    exit 0
else
    echo -e "\n ${CLR_RED}SOME TESTS FAILED! Check the failure logs above.${CLR_RESET}\n"
    exit 1
fi
