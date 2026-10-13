import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  RefreshCw,
  Terminal,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import CustomSelect from "./CustomSelect.jsx";

const STACK_PRESETS = [
  {
    id: "surrealdb",
    title: "SurrealDB Engine (Multi-Tenant + Caddy + Swap)",
    desc: "Clean-slate SurrealDB with selectable storage backend, Caddy reverse proxy, and 1.5GB swap.",
    engine: "SurrealDB",
    // Static fallback — replaced by live upstream versions (GitHub releases)
    // whenever reachable. Keep roughly current for offline use.
    versions: [
      { value: "v3.3.0", label: "v3.3.0 (Latest Stable)" },
      { value: "v3.2.5", label: "v3.2.5" },
      { value: "v3.1.6", label: "v3.1.6" },
      { value: "v2.7.0", label: "v2.7.0" },
      { value: "v2.2.1", label: "v2.2.1" },
    ],
    defaultVersion: "v3.3.0",
  },
  {
    id: "postgres",
    title: "PostgreSQL (Caddy + Swap)",
    desc: "PostgreSQL tuned for low-memory VPS environments with Caddy.",
    engine: "PostgreSQL",
    versions: [
      { value: "18", label: "PostgreSQL 18 (Recommended)" },
      { value: "17", label: "PostgreSQL 17" },
      { value: "16", label: "PostgreSQL 16" },
      { value: "15", label: "PostgreSQL 15" },
      { value: "14", label: "PostgreSQL 14" },
    ],
    defaultVersion: "18",
  },
  {
    id: "mysql",
    title: "Classic LEMP (MariaDB + Caddy + Swap)",
    desc: "MariaDB with low-memory InnoDB configuration and Caddy.",
    engine: "MariaDB",
    versions: [
      { value: "11.8", label: "MariaDB 11.8 (LTS)" },
      { value: "11.4", label: "MariaDB 11.4 (LTS)" },
      { value: "10.11", label: "MariaDB 10.11 (LTS)" },
    ],
    defaultVersion: "11.8",
  },
  {
    id: "base",
    title: "Base Stack (Caddy + Swap Only)",
    desc: "No database daemon. Best for SQLite or external managed cloud databases.",
    engine: "None (SQLite/External)",
    versions: [],
    defaultVersion: "",
  },
];

function generateStrongPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
  const cryptoObj = window.crypto || window.msCrypto;
  if (!cryptoObj?.getRandomValues) {
    return `skiff-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
  const values = new Uint32Array(20);
  cryptoObj.getRandomValues(values);
  let pass = "";
  for (let i = 0; i < 20; i++) {
    pass += chars[values[i] % chars.length];
  }
  return pass;
}

export default function BootstrapModal({
  isOpen,
  onClose,
  server,
  logs = [],
  status = "idle", // "idle" | "running" | "success" | "failed"
  onStartBootstrap,
  onCancel,
}) {
  const [selectedPreset, setSelectedPreset] = useState("surrealdb");
  const [selectedVersion, setSelectedVersion] = useState("v3.3.0");
  const [dbUser, setDbUser] = useState("admin");
  const [dbPassword, setDbPassword] = useState("");
  const [dbName, setDbName] = useState("");
  const [surrealStorage, setSurrealStorage] = useState("surrealkv");
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState(false);
  // Live upstream versions per preset id, fetched when the modal opens.
  const [liveVersions, setLiveVersions] = useState({});
  const [versionsLoading, setVersionsLoading] = useState(false);

  const logContainerRef = useRef(null);

  // Fresh credentials for every provisioning run — never reuse or default
  // to well-known passwords.
  useEffect(() => {
    if (isOpen && status === "idle") {
      setSelectedPreset("surrealdb");
      setSelectedVersion("v3.3.0");
      setDbUser("admin");
      setDbPassword(generateStrongPassword());
      setDbName("");
      setFormError("");
    }
  }, [isOpen, status]);

  // Resolve live version lists from upstream release endpoints once per open.
  // The Go backend caches for an hour and falls back to baked-in lists when
  // offline, so this never blocks provisioning.
  useEffect(() => {
    if (!isOpen || status !== "idle" || !window.go?.main?.App) return;
    let cancelled = false;
    setVersionsLoading(true);
    (async () => {
      const next = {};
      for (const preset of STACK_PRESETS) {
        if (preset.id === "base") continue;
        try {
          const opts = await window.go.main.App.GetDatabaseVersions(preset.id);
          if (cancelled || !Array.isArray(opts) || opts.length === 0) continue;
          next[preset.id] = opts.map((o) => ({ value: o.value, label: o.label }));
          if (preset.id === selectedPreset) {
            const rec = opts.find((o) => o.recommended) || opts[0];
            if (rec) setSelectedVersion(rec.value);
          }
        } catch {
          // Keep the static fallback list for this engine.
        }
      }
      if (!cancelled) {
        setLiveVersions(next);
        setVersionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, status]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) return null;

  const activePreset = STACK_PRESETS.find((p) => p.id === selectedPreset);
  const versionOptions = liveVersions[selectedPreset] || activePreset?.versions || [];
  const usingLiveVersions = !!liveVersions[selectedPreset];

  const handlePresetSelect = (id) => {
    setSelectedPreset(id);
    const live = liveVersions[id];
    if (live && live.length > 0) {
      setSelectedVersion(live[0].value);
      return;
    }
    const preset = STACK_PRESETS.find((p) => p.id === id);
    setSelectedVersion(preset?.defaultVersion || "");
  };

  const handleStart = () => {
    if (!dbUser.trim()) {
      setFormError("Root user is required.");
      return;
    }
    if (!dbPassword.trim()) {
      setFormError("Generate or type a root password before provisioning.");
      return;
    }
    setFormError("");
    onStartBootstrap({
      stackType: selectedPreset,
      version: selectedVersion || activePreset?.defaultVersion || "",
      dbUser: dbUser.trim(),
      dbPassword: dbPassword.trim(),
      dbName: dbName.trim(),
      surrealStorage,
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
                Select Database Stack Preset
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {STACK_PRESETS.map((p) => {
                  const isSelected = selectedPreset === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => handlePresetSelect(p.id)}
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
                        Engine: {p.engine}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom root credentials */}
            {selectedPreset !== "base" && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-semibold block">
                    Root Administrative Credentials
                  </span>
                  <button
                    type="button"
                    onClick={() => setDbPassword(generateStrongPassword())}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-mono inline-flex items-center gap-1"
                  >
                    <KeyRound className="w-3 h-3" /> Generate Password
                  </button>
                </div>

                <div className={`grid gap-3 ${selectedPreset === "surrealdb" ? "grid-cols-3" : "grid-cols-2"}`}>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 block mb-1">
                      Service Version{" "}
                      {versionsLoading ? (
                        <span className="text-indigo-300">(checking upstream…)</span>
                      ) : usingLiveVersions ? (
                        <span className="text-emerald-400">(live upstream)</span>
                      ) : (
                        selectedPreset !== "base" && (
                          <span className="text-amber-400">(offline list)</span>
                        )
                      )}
                    </label>
                    <CustomSelect
                      value={selectedVersion}
                      onChange={setSelectedVersion}
                      options={versionOptions}
                      placeholder="Select version..."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 block mb-1">Root User</label>
                    <input
                      value={dbUser}
                      onChange={(e) => setDbUser(e.target.value)}
                      placeholder="admin"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 block mb-1">Root Password</label>
                    <input
                      type="text"
                      required
                      value={dbPassword}
                      onChange={(e) => setDbPassword(e.target.value)}
                      placeholder="Required — generate or type one"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                    />
                  </div>
                  {selectedPreset !== "surrealdb" && (
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Initial Database</label>
                      <input
                        value={dbName}
                        onChange={(e) => setDbName(e.target.value)}
                        placeholder="skiff_db (default)"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                </div>

                {selectedPreset === "surrealdb" && (
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 block mb-1">Storage Engine</label>
                    <CustomSelect
                      value={surrealStorage}
                      onChange={setSurrealStorage}
                      options={[
                        { value: "surrealkv", label: "SurrealKV (Embedded Key-Value Engine)" },
                        { value: "file", label: "File (Classic File-based)" },
                        { value: "rocksdb", label: "RocksDB (LSM-Tree Concurrency)" },
                      ]}
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      SurrealDB starts as a clean slate. Apps define their own namespaces and databases via deployment recipes.
                    </p>
                  </div>
                )}

                {formError && (
                  <div className="text-[11px] font-mono text-rose-400 bg-rose-950/30 border border-rose-800/50 rounded-lg px-3 py-2">
                    {formError}
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
