import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, RefreshCw, Terminal, Trash2, X } from "lucide-react";

export default function ResetVPSModal({
  isOpen,
  onClose,
  server,
  logs = [],
  status = "idle", // "idle" | "running" | "success" | "failed"
  onConfirmReset,
}) {
  const [typedConfirm, setTypedConfirm] = useState("");
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef(null);

  useEffect(() => {
    if (isOpen && status === "idle") {
      setTypedConfirm("");
    }
  }, [isOpen, status]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) return null;

  const targetHost = server?.host || "server";
  const isMatch = typedConfirm.trim() === targetHost;

  const handleCopyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable in some webview contexts
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-rose-900/50 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-rose-950/60 bg-rose-950/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Reset VPS to Clean Slate
              </h3>
              <p className="text-[11px] font-mono text-slate-400">
                Target: {server?.user}@{server?.host}:{server?.port}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={status === "running"}
            className="p-1 rounded-md text-slate-400 hover:text-white disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* VIEW A: WARNING & TYPE-TO-CONFIRM */}
        {status === "idle" && (
          <div className="p-6 space-y-4">
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/60 flex items-start gap-3 text-xs text-rose-200 leading-relaxed">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-white mb-1">Destructive Action Warning</p>
                <p>
                  This stops and removes all Skiff applications, database daemons, and Caddy units,
                  tears down swap, and wipes <code className="text-rose-300 font-mono">/opt/skiff</code> entirely.
                  OS packages stay installed so you can re-provision immediately after.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-mono text-slate-400 block">
                Type <strong className="text-white font-mono">{targetHost}</strong> below to confirm:
              </label>
              <input
                type="text"
                value={typedConfirm}
                onChange={(e) => setTypedConfirm(e.target.value)}
                placeholder={targetHost}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono outline-none focus:border-rose-500"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!isMatch}
                onClick={onConfirmReset}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 active:scale-95 shadow-lg shadow-rose-600/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Wipe &amp; Reset VPS</span>
              </button>
            </div>
          </div>
        )}

        {/* VIEW B: LIVE RESET CONSOLE STREAM */}
        {status !== "idle" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-black min-h-0">
            <div className="p-3 bg-slate-950 border-b border-slate-900 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-mono text-slate-300">Live Reset SSH Stream</span>
                {status === "running" && <RefreshCw className="w-3 h-3 animate-spin text-rose-400" />}
              </div>
              <button
                onClick={handleCopyLogs}
                className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 text-[11px] flex items-center gap-1 border border-slate-800"
              >
                <Copy className="w-3 h-3" />
                <span>{copied ? "Copied" : "Copy Output"}</span>
              </button>
            </div>

            <div ref={logContainerRef} className="flex-1 p-4 overflow-y-auto font-mono text-[11px] space-y-1 select-text">
              {logs.length === 0 && (
                <div className="text-slate-500 py-8 text-center animate-pulse">
                  Connecting to VPS via SSH &amp; initiating reset pipeline...
                </div>
              )}
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={`leading-relaxed whitespace-pre-wrap break-all ${
                    log.includes("[OK]")
                      ? "text-emerald-400"
                      : log.includes("==> [STEP:")
                      ? "text-rose-300 font-bold mt-2"
                      : log.includes("[ACTION]")
                      ? "text-amber-300"
                      : "text-slate-300"
                  }`}
                >
                  {log}
                </div>
              ))}
            </div>

            <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-400 font-mono">
                {status === "running" && "Wiping services, databases, and layout..."}
                {status === "success" && "Server is completely reset back to zero."}
                {status === "failed" && "Reset encountered an issue; review logs above."}
              </span>
              {status !== "running" && (
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
