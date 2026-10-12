import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlock,
  XCircle,
} from "lucide-react";

export default function DeployDomainSection({
  server,
  project,
  appName = "",
  onProjectUpdated,
  addToast,
  onDnsCheck,
  onOpenUrl,
}) {
  const [domain, setDomain] = useState("");
  const [targetPort, setTargetPort] = useState(8080);
  const [tlsMode, setTlsMode] = useState("auto");
  const [hasLiveRoute, setHasLiveRoute] = useState(false);

  const [dnsCheck, setDnsCheck] = useState(null);
  const [isCheckingDNS, setIsCheckingDNS] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetaching, setIsDetaching] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");

  const pollTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Sync state whenever the selected project changes
  useEffect(() => {
    if (project) {
      setDomain(project.domain || "");
      setTargetPort(project.targetPort || 8080);
      setTlsMode(project.tlsMode || "auto");
      setDnsCheck(null);

      if (server && appName && window.go?.main?.App) {
        window.go.main.App.GetAppDomainConfig(server.id, appName)
          .then((cfg) => {
            if (!isMountedRef.current) return;
            if (cfg?.active) {
              setHasLiveRoute(true);
              if (cfg.domain) setDomain(cfg.domain);
              if (cfg.targetPort) setTargetPort(cfg.targetPort);
              if (cfg.tlsMode) setTlsMode(cfg.tlsMode);
            } else {
              setHasLiveRoute(false);
            }
          })
          .catch(() => {
            if (isMountedRef.current) setHasLiveRoute(false);
          });
      }
    }
  }, [project?.id, server?.id, appName]);

  // Continuous background DNS verification runner
  useEffect(() => {
    const clean = domain.trim();
    if (!clean || !server?.host || !window.go?.main?.App) {
      setDnsCheck(null);
      if (onDnsCheck) onDnsCheck(null);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    const runProbe = async () => {
      if (!isMountedRef.current) return;
      setIsCheckingDNS(true);
      try {
        const res = await window.go.main.App.CheckDomainDNS(clean, server.host);
        if (isMountedRef.current) {
          setDnsCheck(res);
          if (onDnsCheck) onDnsCheck(res);
        }
      } catch {
        if (isMountedRef.current) {
          setDnsCheck(null);
          if (onDnsCheck) onDnsCheck(null);
        }
      } finally {
        if (isMountedRef.current) setIsCheckingDNS(false);
      }
    };

    runProbe();

    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(runProbe, 12000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [domain, server?.host]);

  const handleCopy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      addToast("info", "Copied", `Copied ${key} to clipboard`);
      setTimeout(() => setCopiedKey(""), 2000);
    } catch {
      addToast("warning", "Copy Failed", "Clipboard unavailable");
    }
  };

  const handleApply = async (e) => {
    e.preventDefault();
    if (!window.go?.main?.App || !server) return;
    setIsSaving(true);
    const cleanDom = domain.trim();
    const portNum = Number(targetPort) || 8080;

    try {
      await window.go.main.App.ConfigureAppDomain(
        server.id,
        appName,
        cleanDom,
        portNum,
        tlsMode
      );

      const updated = {
        ...project,
        domain: cleanDom,
        targetPort: portNum,
        tlsMode,
      };
      await window.go.main.App.SaveProject(updated);

      setHasLiveRoute(true);
      addToast("success", "Domain Applied", `${cleanDom || "Route"} synced to Caddy and recipe saved.`);
      if (onProjectUpdated) onProjectUpdated(updated);
    } catch (err) {
      addToast("error", "Domain Configuration Failed", String(err), 6000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDetach = async () => {
    if (!window.go?.main?.App || !server) return;
    setIsDetaching(true);
    try {
      await window.go.main.App.RemoveAppDomain(server.id, appName);
      const updated = {
        ...project,
        domain: "",
        targetPort: Number(targetPort) || 8080,
      };
      await window.go.main.App.SaveProject(updated);

      setDomain("");
      setHasLiveRoute(false);
      setDnsCheck(null);
      addToast("info", "Domain Detached", "Caddy route removed for this app.");
      if (onProjectUpdated) onProjectUpdated(updated);
    } catch (err) {
      addToast("error", "Detach Failed", String(err));
    } finally {
      setIsDetaching(false);
    }
  };

  const cleanDomain = domain.trim();
  const liveUrl =
    cleanDomain && (tlsMode === "http" ? `http://${cleanDomain}` : `https://${cleanDomain}`);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
            <Globe className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <span>Domain &amp; SSL Routing</span>
              {hasLiveRoute && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                  Caddy Active
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-400">
              One-click Let&apos;s Encrypt TLS certificates or plain HTTP proxying via Caddy.
            </p>
          </div>
        </div>

        {/* Live background check indicator */}
        {cleanDomain && (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${
                isCheckingDNS
                  ? "bg-indigo-950/60 text-indigo-300 border-indigo-700/60 animate-pulse"
                  : dnsCheck?.isPointing
                  ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/60"
                  : "bg-amber-950/60 text-amber-300 border-amber-800/60"
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${isCheckingDNS ? "animate-spin text-indigo-400" : "text-slate-400"}`} />
              <span>{isCheckingDNS ? "Verifying DNS..." : dnsCheck?.isPointing ? "DNS Pointing" : "DNS Pending"}</span>
            </span>
          </div>
        )}
      </div>

      <form onSubmit={handleApply} className="space-y-4">
        {/* Domain input & internal port */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400 font-semibold block">
              Domain Name
            </label>
            <input
              type="text"
              placeholder="e.g. notes.mydomain.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-mono uppercase text-slate-400 font-semibold block">
              Internal App Port
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              placeholder="8080"
              value={targetPort}
              onChange={(e) => setTargetPort(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* TLS strategy */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase text-slate-400 font-semibold block">
            TLS &amp; Certificate Strategy
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div
              onClick={() => setTlsMode("auto")}
              className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-2.5 ${
                tlsMode === "auto"
                  ? "bg-indigo-950/60 border-indigo-500 text-white ring-1 ring-indigo-500/40"
                  : "bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              <Lock className={`w-4 h-4 shrink-0 mt-0.5 ${tlsMode === "auto" ? "text-emerald-400" : "text-slate-500"}`} />
              <div className="min-w-0">
                <div className="text-xs font-bold text-white">Automatic Let&apos;s Encrypt SSL</div>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  Auto-provisions HTTPS certificate as soon as DNS resolves to this VPS.
                </p>
              </div>
            </div>

            <div
              onClick={() => setTlsMode("http")}
              className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-2.5 ${
                tlsMode === "http"
                  ? "bg-amber-950/40 border-amber-500 text-white ring-1 ring-amber-500/40"
                  : "bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              <Unlock className={`w-4 h-4 shrink-0 mt-0.5 ${tlsMode === "http" ? "text-amber-400" : "text-slate-500"}`} />
              <div className="min-w-0">
                <div className="text-xs font-bold text-white">Fast Prototyping (HTTP Only)</div>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  Instant port 80 routing without certificate issuance or DNS wait.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Live DNS propagation box */}
        {cleanDomain && (
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase text-slate-400 font-semibold block">
                Required DNS Record (at your DNS registrar)
              </span>
              {dnsCheck && (
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold flex items-center gap-1 border shrink-0 ${
                    dnsCheck.isPointing
                      ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/60"
                      : "bg-amber-950/60 text-amber-400 border-amber-800/60"
                  }`}
                >
                  {dnsCheck.isPointing ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Points to {server?.host}</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 text-amber-400" />
                      <span>DNS Propagating...</span>
                    </>
                  )}
                </span>
              )}
            </div>

            <div className="overflow-hidden border border-slate-800 rounded-lg bg-slate-900/60 text-xs font-mono">
              <table className="w-full text-left">
                <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                  <tr>
                    <th className="p-2 pl-3">Type</th>
                    <th className="p-2">Name / Host</th>
                    <th className="p-2">Value / Target IP</th>
                    <th className="p-2 text-right pr-3">Copy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  <tr>
                    <td className="p-2 pl-3 font-bold text-indigo-400">A</td>
                    <td className="p-2">{dnsCheck?.recordHost || "@"}</td>
                    <td className="p-2 text-white font-bold">{server?.host}</td>
                    <td className="p-2 text-right pr-3">
                      <button
                        type="button"
                        onClick={() => handleCopy(server?.host, "IP")}
                        className="p-1 hover:text-white text-slate-400"
                      >
                        {copiedKey === "IP" ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                {dnsCheck?.isPointing ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Direct match verified.
                  </span>
                ) : dnsCheck?.isCloudflare ? (
                  <span className="text-amber-300 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Proxied via Cloudflare (Orange Cloud active). Origin pull will reach VPS port 80.
                  </span>
                ) : (
                  <span>Checking automatically every 12 seconds in the background.</span>
                )}
              </span>

              {liveUrl && (
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenUrl) onOpenUrl(liveUrl);
                    else window.open(liveUrl, "_blank", "noopener");
                  }}
                  className="text-indigo-400 hover:text-indigo-300 font-semibold inline-flex items-center gap-1"
                >
                  <span>Open Live App</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
          {hasLiveRoute ? (
            <button
              type="button"
              disabled={isDetaching}
              onClick={handleDetach}
              className="px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isDetaching ? "Detaching..." : "Detach Domain"}</span>
            </button>
          ) : (
            <span />
          )}

          <button
            type="submit"
            disabled={isSaving || !cleanDomain}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs transition active:scale-95 shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
          >
            {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>{isSaving ? "Applying..." : "Apply Domain to Caddy"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
