import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  RefreshCw,
  Terminal,
  Wrench,
  X,
  XCircle,
} from "lucide-react";

const STAGES = [
  { id: "detect", label: "Architecture Check" },
  { id: "swap", label: "Virtual Memory (Swap)" },
  { id: "deps", label: "System Utilities" },
  { id: "caddy", label: "Caddy Reverse Proxy" },
  { id: "surrealdb", label: "SurrealDB Engine" },
  { id: "dirs", label: "Directory Skeleton" },
  { id: "systemd", label: "Service Daemons" },
  { id: "done", label: "Completed" },
];

export default function BootstrapModal({
  isOpen,
  onClose,
  server,
  logs = [],
  status = "idle", // "idle" | "running" | "success" | "failed"
  onCancel,
}) {
  const [currentStep, setCurrentStep] = useState("detect");
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef(null);

  // Parse step tags from live logs
  useEffect(() => {
    if (logs.length > 0) {
      const lastLine = logs[logs.length - 1];
      const match = lastLine.match(/\[STEP:([a-z0-9_-]+)\]/);
      if (match && match[1]) {
        setCurrentStep(match[1]);
      }
    }
  }, [logs]);

  // Reset step tracker each time the modal opens
  useEffect(() => {
    if (isOpen) setCurrentStep("detect");
  }, [isOpen]);

  // Keep terminal scrolled to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) return null;

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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">VPS Provisioning Console</h3>
                {status === "running" && (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded-full border border-indigo-700/60 animate-pulse">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Provisioning Live
                  </span>
                )}
                {status === "success" && (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-700/60">
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" /> Provisioned
                  </span>
                )}
                {status === "failed" && (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-rose-300 bg-rose-950/80 px-2 py-0.5 rounded-full border border-rose-700/60">
                    <XCircle className="w-2.5 h-2.5 text-rose-400" /> Error
                  </span>
                )}
              </div>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                Target: {server?.user}@{server?.host}:{server?.port}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLogs}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-xs flex items-center gap-1 border border-slate-800 transition"
              title="Copy Console Output"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? "Copied" : "Copy Output"}</span>
            </button>
            <button
              onClick={onClose}
              disabled={status === "running"}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Checkpoint Timeline Bar */}
        <div className="px-5 py-3 bg-slate-950/80 border-b border-slate-800/80 flex items-center gap-1 overflow-x-auto text-[11px] shrink-0">
          {STAGES.map((st) => {
            const isCurrent = currentStep === st.id;
            const isPast =
              STAGES.findIndex((s) => s.id === currentStep) >
              STAGES.findIndex((s) => s.id === st.id);

            return (
              <div
                key={st.id}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-mono whitespace-nowrap transition-colors ${
                  isCurrent
                    ? "bg-indigo-950/60 border-indigo-500 text-indigo-300 font-bold"
                    : isPast || status === "success"
                    ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-400 font-medium"
                    : "bg-slate-900/40 border-slate-800 text-slate-600"
                }`}
              >
                {isCurrent && status === "running" ? (
                  <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                ) : isPast || status === "success" ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                )}
                <span>{st.label}</span>
              </div>
            );
          })}
        </div>

        {/* Live Terminal Output Window */}
        <div
          ref={logContainerRef}
          className="flex-1 bg-black p-4 font-mono text-[11px] overflow-y-auto space-y-1 select-text"
        >
          <div className="text-slate-600 border-b border-slate-900 pb-2 mb-2 flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3 h-3 text-indigo-400" /> Sudo Stdin Shell Session
            </span>
            <span>Unbuffered TTY Feed</span>
          </div>

          {logs.length === 0 && (
            <div className="text-slate-500 py-8 text-center animate-pulse">
              Connecting to VPS via SSH &amp; initiating script pipeline...
            </div>
          )}

          {logs.map((log, index) => {
            const isOk = log.includes("[OK]");
            const isAction = log.includes("[ACTION]");
            const isStep = log.includes("==> [STEP:");
            const isError = log.toLowerCase().includes("error") || log.toLowerCase().includes("failed");

            return (
              <div
                key={index}
                className={`leading-relaxed whitespace-pre-wrap break-all ${
                  isStep
                    ? "text-indigo-300 font-bold mt-2"
                    : isOk
                    ? "text-emerald-400 font-medium"
                    : isAction
                    ? "text-amber-300"
                    : isError
                    ? "text-rose-400 font-semibold"
                    : "text-slate-300"
                }`}
              >
                {log}
              </div>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400 font-mono">
            {status === "running" && "Executing commands without overwriting existing data..."}
            {status === "success" && "Host verified & ready for atomic deployments."}
            {status === "failed" && "Review error logs above to troubleshoot."}
          </span>

          <div className="flex items-center gap-2">
            {status === "running" ? (
              <button
                type="button"
                onClick={onCancel}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 font-semibold transition"
              >
                Abort Provisioning
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
