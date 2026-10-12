import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Globe,
  HelpCircle,
  Info,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlock,
  X,
  XCircle,
} from "lucide-react";

export default function DomainManageModal({
  isOpen,
  onClose,
  server,
  appName = "",
  onSaved,
  addToast,
}) {
  const [domain, setDomain] = useState("");
  const [targetPort, setTargetPort] = useState(8080);
  const [tlsMode, setTlsMode] = useState("auto"); // "auto" | "http" | "none"
  const [hasRoute, setHasRoute] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dnsCheck, setDnsCheck] = useState(null);
  const [checkingDNS, setCheckingDNS] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDetach, setConfirmingDetach] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const [showProviderGuide, setShowProviderGuide] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState("cloudflare");

  // Load the live Caddy route for this app when opened
  useEffect(() => {
    if (isOpen && server && appName) {
      setLoading(true);
      setDnsCheck(null);
      setConfirmingDetach(false);
      window.go.main.App.GetAppDomainConfig(server.id, appName)
        .then((cfg) => {
          setDomain(cfg.domain || "");
          setTargetPort(cfg.targetPort || 8080);
          setTlsMode(cfg.tlsMode || "auto");
          setHasRoute(!!cfg.active);
          if (cfg.domain) verifyDNS(cfg.domain);
        })
        .catch(() => {
          setDomain("");
          setTargetPort(8080);
          setTlsMode("auto");
          setHasRoute(false);
        })
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, server?.id, appName]);

  if (!isOpen) return null;

  const verifyDNS = async (d) => {
    const target = (d ?? domain).trim();
    if (!target || !server?.host || !window.go?.main?.App) return;
    setCheckingDNS(true);
    try {
      const res = await window.go.main.App.CheckDomainDNS(target, server.host);
      setDnsCheck(res);
    } catch {
      setDnsCheck(null);
    } finally {
      setCheckingDNS(false);
    }
  };

  const handleCopy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      addToast("info", "Copied", `Copied ${key} to clipboard`);
      setTimeout(() => setCopiedKey(""), 2000);
    } catch {
      addToast("warning", "Copy Failed", "Clipboard unavailable in this context");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!window.go?.main?.App) return;
    setSaving(true);
    try {
      await window.go.main.App.ConfigureAppDomain(
        server.id,
        appName,
        domain.trim(),
        Number(targetPort),
        tlsMode
      );
      addToast(
        "success",
        "Domain Attached",
        tlsMode === "auto"
          ? `${domain.trim()} configured with automatic Let's Encrypt SSL.`
          : `${domain.trim()} configured in fast-prototyping (HTTP) mode.`
      );
      if (onSaved) onSaved({ appName, domain: domain.trim(), targetPort: Number(targetPort), tlsMode });
      onClose();
    } catch (err) {
      addToast("error", "Domain Configuration Failed", String(err), 6000);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      await window.go.main.App.RemoveAppDomain(server.id, appName);
      addToast("info", "Domain Removed", "Caddy route removed.");
      if (onSaved) onSaved({ appName, domain: "", targetPort: Number(targetPort), tlsMode: "auto" });
      onClose();
    } catch (err) {
      addToast("error", "Removal Failed", String(err));
    } finally {
      setConfirmingDetach(false);
    }
  };

  const cleanDomain = domain.trim().toLowerCase();
  const liveUrl =
    cleanDomain && (tlsMode === "http" ? `http://${cleanDomain}` : `https://${cleanDomain}`);

  // Local fallback split (backend dnsCheck is authoritative once verified)
  const domainParts = cleanDomain.split(".").filter(Boolean);
  const subdomainFallback =
    domainParts.length > 2
      ? { isSubdomain: true, host: domainParts.slice(0, -2).join("."), apex: domainParts.slice(-2).join(".") }
      : { isSubdomain: false, host: "@", apex: cleanDomain };
  const guideHost = dnsCheck?.recordHost ?? subdomainFallback.host;
  const guideApex = dnsCheck?.parentApex ?? subdomainFallback.apex;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Domain &amp; SSL Routing</h3>
              <p className="text-[10px] font-mono text-slate-400">
                App: {appName || "—"} &middot; VPS: {server?.host}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
            <span>Reading live Caddy route...</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto">
            {/* Domain Input & Port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                  Domain Name
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="e.g. notes.mydomain.com"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    onBlur={() => verifyDNS(domain)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => verifyDNS(domain)}
                    disabled={checkingDNS || !cleanDomain}
                    className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-xl text-xs flex items-center gap-1 transition shrink-0"
                    title="Verify DNS Propagation"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${checkingDNS ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline">Verify</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                  Internal Port
                </label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={targetPort}
                  onChange={(e) => setTargetPort(e.target.value)}
                  placeholder="8080"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Mode Selector */}
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1.5 font-semibold">
                TLS &amp; Certificate Strategy
              </label>
              <div className="grid grid-cols-2 gap-2">
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
                    <div className="text-xs font-bold text-white">Automatic SSL</div>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                      Full HTTPS via Let&apos;s Encrypt once DNS points here.
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
                    <div className="text-xs font-bold text-white">Fast Prototyping</div>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                      Instant HTTP access, no certificates or DNS wait.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* DNS Guidance — apex vs subdomain aware */}
            {cleanDomain && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                      <span>DNS Record Configuration</span>
                      {(dnsCheck?.isSubdomain ?? subdomainFallback.isSubdomain) && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                          Subdomain: {dnsCheck?.recordHost ?? subdomainFallback.host}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      Add this record inside your <strong className="text-white font-mono">{dnsCheck?.parentApex ?? subdomainFallback.apex}</strong> DNS zone:
                    </span>
                  </div>

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
                          <span>Points to VPS</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3 h-3 text-amber-400" />
                          <span>Not Pointing Yet</span>
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
                        <th className="p-2">Value (IPv4)</th>
                        <th className="p-2">TTL</th>
                        <th className="p-2 text-right pr-3">Copy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-200">
                      <tr>
                        <td className="p-2 pl-3 font-bold text-indigo-400">A</td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                              {dnsCheck?.recordHost ?? subdomainFallback.host}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(dnsCheck?.recordHost ?? subdomainFallback.host, "Host Name")}
                              className="p-1 hover:text-white text-slate-400"
                              title="Copy Host"
                            >
                              {copiedKey === "Host Name" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-emerald-400">{server?.host}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(server?.host, "IP Address")}
                              className="p-1 hover:text-white text-slate-400"
                              title="Copy IP"
                            >
                              {copiedKey === "IP Address" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </td>
                        <td className="p-2 text-slate-400 text-[11px]">Auto / 60s</td>
                        <td className="p-2 text-right pr-3 text-slate-500 text-[11px]">
                          Standard
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {dnsCheck && (
                  <div
                    className={`p-3 rounded-lg border text-xs leading-relaxed flex items-start gap-2.5 ${
                      dnsCheck.isPointing
                        ? "bg-emerald-950/20 border-emerald-900/60 text-emerald-200"
                        : "bg-amber-950/20 border-amber-900/60 text-amber-200"
                    }`}
                  >
                    {dnsCheck.isPointing ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 space-y-0.5 min-w-0">
                      <p className="font-semibold text-white">
                        {dnsCheck.isPointing
                          ? `Traffic for ${cleanDomain} correctly resolves to your VPS.`
                          : `${cleanDomain} does not resolve to ${server?.host} yet.`}
                      </p>
                      <p className="text-[11px] font-mono break-all">
                        Current: <strong>{dnsCheck.resolvedIPs?.length > 0 ? dnsCheck.resolvedIPs.join(", ") : "Unresolved (NXDOMAIN)"}</strong>
                        {" "}&middot; Required: <strong>{server?.host}</strong>
                      </p>
                    </div>
                  </div>
                )}

                {/* Registrar walkthrough */}
                <div className="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-900/30">
                  <button
                    type="button"
                    onClick={() => setShowProviderGuide(!showProviderGuide)}
                    className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:text-white flex items-center justify-between transition"
                  >
                    <span className="flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
                      <span>How to add this record in your registrar</span>
                    </span>
                    {showProviderGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {showProviderGuide && (
                    <div className="p-3.5 border-t border-slate-800 space-y-3 text-xs text-slate-300">
                      <div className="flex gap-2 border-b border-slate-800 pb-2 flex-wrap">
                        {[
                          { id: "cloudflare", name: "Cloudflare" },
                          { id: "namecheap", name: "Namecheap" },
                          { id: "godaddy", name: "GoDaddy" },
                          { id: "route53", name: "AWS Route 53" },
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelectedProvider(p.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                              selectedProvider === p.id
                                ? "bg-indigo-600 text-white font-bold"
                                : "text-slate-400 hover:text-slate-200 bg-slate-800/60"
                            }`}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>

                      {selectedProvider === "cloudflare" && (
                        <div className="space-y-1.5 leading-relaxed text-[11px]">
                          <p>1. Cloudflare Dashboard &rarr; zone <strong>{guideApex}</strong> &rarr; <strong>DNS &gt; Records</strong>.</p>
                          <p>2. Click <strong>Add record</strong>:</p>
                          <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono space-y-1">
                            <div>Type: <strong className="text-indigo-400">A</strong></div>
                            <div>Name: <strong className="text-white">{guideHost}</strong> (Cloudflare appends .{guideApex})</div>
                            <div>IPv4 address: <strong className="text-emerald-400">{server?.host}</strong></div>
                            <div>Proxy status: <span className="text-amber-300">DNS only (grey cloud)</span> <span className="font-sans text-slate-500">— lets Caddy complete ACME challenges directly</span></div>
                          </div>
                          <div className="p-2 rounded bg-amber-950/30 border border-amber-900/50 text-[10px] text-amber-200 flex items-start gap-1.5 mt-2">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                            <span>Prefer proxied (orange cloud)? Set Cloudflare SSL/TLS to <strong>Full (strict)</strong> so it talks HTTPS to Caddy.</span>
                          </div>
                        </div>
                      )}

                      {selectedProvider === "namecheap" && (
                        <div className="space-y-1.5 leading-relaxed text-[11px]">
                          <p>1. Namecheap Domain List &rarr; <strong>Manage</strong> next to <strong>{guideApex}</strong> &rarr; <strong>Advanced DNS</strong>.</p>
                          <p>2. Click <strong>Add New Record</strong>:</p>
                          <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono space-y-1">
                            <div>Type: <strong className="text-indigo-400">A Record</strong></div>
                            <div>Host: <strong className="text-white">{guideHost}</strong></div>
                            <div>Value: <strong className="text-emerald-400">{server?.host}</strong></div>
                            <div>TTL: <strong className="text-slate-300">Automatic / 1 min</strong></div>
                          </div>
                        </div>
                      )}

                      {selectedProvider === "godaddy" && (
                        <div className="space-y-1.5 leading-relaxed text-[11px]">
                          <p>1. GoDaddy Domain Portfolio &rarr; select <strong>{guideApex}</strong> &rarr; <strong>DNS</strong>.</p>
                          <p>2. Under DNS Records click <strong>Add New Record</strong>:</p>
                          <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono space-y-1">
                            <div>Type: <strong className="text-indigo-400">A</strong></div>
                            <div>Name: <strong className="text-white">{guideHost}</strong></div>
                            <div>Value: <strong className="text-emerald-400">{server?.host}</strong></div>
                            <div>TTL: <strong className="text-slate-300">1/2 Hour (or Default)</strong></div>
                          </div>
                        </div>
                      )}

                      {selectedProvider === "route53" && (
                        <div className="space-y-1.5 leading-relaxed text-[11px]">
                          <p>1. AWS Route 53 &rarr; <strong>Hosted zones</strong> &rarr; <strong>{guideApex}</strong>.</p>
                          <p>2. Click <strong>Create record</strong>:</p>
                          <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono space-y-1">
                            <div>Record name: <strong className="text-white">{guideHost}</strong></div>
                            <div>Record type: <strong className="text-indigo-400">A</strong></div>
                            <div>Value: <strong className="text-emerald-400">{server?.host}</strong></div>
                            <div>TTL (seconds): <strong className="text-slate-300">60</strong></div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 gap-2">
                  <span className="min-w-0">
                    {dnsCheck?.isPointing ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> Ready for Automatic SSL.
                      </span>
                    ) : (
                      <span>Add the record above, then click Verify.</span>
                    )}
                  </span>
                  {liveUrl && (
                    <a
                      href={liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 font-semibold inline-flex items-center gap-1 shrink-0"
                    >
                      <span>Open URL</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
              {hasRoute ? (
                confirmingDetach ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-rose-300 font-mono">Detach route?</span>
                    <button
                      type="button"
                      onClick={handleRemove}
                      className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition"
                    >
                      Yes, detach
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDetach(false)}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDetach(true)}
                    className="px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Detach Domain</span>
                  </button>
                )
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !cleanDomain || !appName}
                  className="px-5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs transition active:scale-95 shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
                >
                  {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{saving ? "Applying..." : "Attach Domain"}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
