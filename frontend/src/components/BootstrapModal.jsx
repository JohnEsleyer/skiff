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
import CustomSelect from "./CustomSelect.jsx";

const STACK_PRESETS = [
  {
    id: "esper",
    title: "Esper Stack (SurrealDB + Caddy + Swap)",
    desc: "SurrealDB with selectable storage engine, Caddy reverse proxy, and 1.5GB swapfile.",
    engine: "SurrealDB",
  },
  {
    id: "postgres",
    title: "Modern Web (PostgreSQL 16 + Caddy + Swap)",
    desc: "PostgreSQL 16 tuned for low-memory VPS environments with Caddy.",
    engine: "PostgreSQL 16",
  },
  {
    id: "mysql",
    title: "Classic LEMP (MariaDB/MySQL + Caddy + Swap)",
    desc: "MariaDB with low-memory InnoDB configuration and Caddy.",
    engine: "MariaDB",
  },
  {
    id: "base",
    title: "Base Web Stack (Caddy + Swap Only)",
    desc: "No database daemon. Best for SQLite, flat-file, or external cloud databases.",
    engine: "None (SQLite/External)",
  },
];

export default function BootstrapModal({
  isOpen,
  onClose,
  server,
  logs = [],
  status = "idle", // "idle" | "running" | "success" | "failed"
  onStartBootstrap,
  onCancel,
}) {
  const [selectedPreset, setSelectedPreset] = useState("esper");
  const [dbUser, setDbUser] = useState("root");
  const [dbPassword, setDbPassword] = useState("");
  const [dbName, setDbName] = useState("production");
  const [surrealStorage, setSurrealStorage] = useState("surrealkv");
  const [surrealNs, setSurrealNs] = useState("esper");
  const [copied, setCopied] = useState(false);

  const logContainerRef = useRef(null);

  // Reset the form each time the modal opens for a fresh provisioning run
  useEffect(() => {
    if (isOpen && status === "idle") {
      setSelectedPreset("esper");
      setDbPassword("");
    }
  }, [isOpen, status]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) return null;

  const handleStart = () => {
    onStartBootstrap({
      stackType: selectedPreset,
      dbUser: selectedPreset === "esper" ? dbUser || "root" : dbUser || "skiff_user",
      dbPassword: dbPassword || (selectedPreset === "esper" ? "root" : "skiff_secure_pass"),
      dbName: dbName || "production",
      surrealStorage,
      surrealNs: surrealNs || "esper",
      enableSwap: true,
      installCaddy: true,
    });
  };

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
                <h3 className="text-sm font-bold text-white tracking-tight">Provision VPS Stack</h3>
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
          <button
            onClick={onClose}
            disabled={status === "running"}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* VIEW A: PRE-FLIGHT STACK SELECTION */}
        {status === "idle" && (
          <div className="p-6 space-y-5 overflow-y-auto flex-1">
            <div>
              <span className="text-[10px] font-mono uppercase text-slate-400 block mb-2 font-semibold">
                Select Purpose &amp; Database Stack
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {STACK_PRESETS.map((p) => {
                  const isSelected = selectedPreset === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPreset(p.id)}
                      className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                        isSelected
                          ? "bg-indigo-950/60 border-indigo-500 text-white ring-1 ring-indigo-500/40"
                          : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <h4 className="text-xs font-bold text-white">{p.title}</h4>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{p.desc}</p>
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-500">
                        Database: {p.engine}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Preset-specific credentials */}
            {selectedPreset !== "base" && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <span className="text-[10px] font-mono uppercase text-slate-400 font-semibold block">
                  Database Credentials Setup
                </span>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 block mb-1">User</label>
                    <input
                      value={dbUser}
                      onChange={(e) => setDbUser(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 block mb-1">Password</label>
                    <input
                      type="password"
                      placeholder={selectedPreset === "esper" ? "root (default)" : "skiff_secure_pass (default)"}
                      value={dbPassword}
                      onChange={(e) => setDbPassword(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 block mb-1">
                      {selectedPreset === "esper" ? "Database" : "Database Name"}
                    </label>
                    <input
                      value={dbName}
                      onChange={(e) => setDbName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {selectedPreset === "esper" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">SurrealDB Storage Backend</label>
                      <CustomSelect
                        value={surrealStorage}
                        onChange={setSurrealStorage}
                        options={[
                          { value: "surrealkv", label: "SurrealKV (Embedded Engine)" },
                          { value: "file", label: "File (Classic Key-Value)" },
                          { value: "rocksdb", label: "RocksDB (High-Concurrency)" },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Namespace</label>
                      <input
                        value={surrealNs}
                        onChange={(e) => setSurrealNs(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={handleStart}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition active:scale-95"
              >
                Start Provisioning
              </button>
            </div>
          </div>
        )}

        {/* VIEW B: REAL-TIME CONSOLE STREAM */}
        {status !== "idle" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-black min-h-0">
            <div className="p-3 bg-slate-950 border-b border-slate-900 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-mono text-slate-300">Live Unbuffered SSH Stream</span>
                {status === "running" && <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />}
              </div>
              <button
                onClick={handleCopyLogs}
                className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 text-[11px] flex items-center gap-1 border border-slate-800 transition"
              >
                <Copy className="w-3 h-3" />
                <span>{copied ? "Copied" : "Copy Output"}</span>
              </button>
            </div>

            <div ref={logContainerRef} className="flex-1 p-4 overflow-y-auto font-mono text-[11px] space-y-1 select-text">
              {logs.length === 0 && (
                <div className="text-slate-500 py-8 text-center animate-pulse">
                  Connecting to VPS via SSH &amp; initiating script pipeline...
                </div>
              )}
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={`leading-relaxed whitespace-pre-wrap break-all ${
                    log.includes("[OK]")
                      ? "text-emerald-400"
                      : log.includes("[ACTION]")
                      ? "text-amber-300"
                      : log.includes("==> [STEP:")
                      ? "text-indigo-300 font-bold mt-2"
                      : log.toLowerCase().includes("error") || log.toLowerCase().includes("failed")
                      ? "text-rose-400 font-semibold"
                      : "text-slate-300"
                  }`}
                >
                  {log}
                </div>
              ))}
            </div>

            <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-400 font-mono">
                {status === "running" && "Executing without overwriting existing data..."}
                {status === "success" && "Host verified & ready for atomic deployments."}
                {status === "failed" && "Review error logs above to troubleshoot."}
              </span>
              {status === "running" ? (
                <button
                  onClick={onCancel}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition"
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
