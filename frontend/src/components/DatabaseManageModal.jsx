import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  HardDrive,
  RefreshCw,
  X,
} from "lucide-react";

export default function DatabaseManageModal({ isOpen, onClose, server, dbType, addToast }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");

  useEffect(() => {
    if (isOpen && server && dbType) {
      setInfo(null);
      loadInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, server, dbType]);

  const loadInfo = async () => {
    setLoading(true);
    try {
      const res = await window.go.main.App.GetDatabaseInfo(server.id, dbType);
      setInfo(res);
    } catch (err) {
      addToast("error", "Database Read Error", String(err));
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const copyToClipboard = async (text, keyName) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyName);
      addToast("info", "Copied", `Copied ${keyName} to clipboard`);
      setTimeout(() => setCopiedKey(""), 2000);
    } catch {
      addToast("warning", "Copy Failed", "Clipboard unavailable in this context");
    }
  };

  const handleDownloadBackup = async () => {
    setIsDownloading(true);
    try {
      const savedPath = await window.go.main.App.BackupAndDownloadDatabase(server.id, dbType);
      if (savedPath) {
        addToast("success", "Backup Downloaded", `Saved to: ${savedPath}`, 6000);
      }
    } catch (err) {
      if (!String(err).toLowerCase().includes("cancel")) {
        addToast("error", "Backup Failed", String(err), 6000);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight capitalize">
                  {info?.engine || dbType} Overview
                </h3>
                {info && (
                  <span
                    className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded-full font-bold border ${
                      info.active
                        ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/60"
                        : "bg-rose-950/60 text-rose-400 border-rose-800/60"
                    }`}
                  >
                    {info.active ? "Running" : "Inactive"}
                  </span>
                )}
              </div>
              <p className="text-[10px] font-mono text-slate-400">
                {server?.name} &middot; Port {info?.port ?? "—"}
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
            <span>Reading database state from VPS...</span>
          </div>
        ) : info ? (
          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* Storage Type & Runtime Command Card */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <HardDrive className="w-3.5 h-3.5 text-indigo-400" /> Storage Engine Backend
                </span>
                <span className="font-mono text-indigo-300 font-bold bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/60 text-[11px]">
                  {info.storageType || "Unknown"}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block mb-1">
                  ExecStart Launch Command
                </span>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80 font-mono text-[10px] text-slate-300 break-all select-text">
                  {info.command}
                </div>
              </div>

              <div className="text-[10px] font-mono text-slate-500">
                Data path: <span className="text-slate-300">{info.dataPath}</span>
              </div>
            </div>

            {/* Connection Credentials Card */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="text-[10px] font-mono uppercase text-slate-400 block font-semibold">
                Connection Credentials
              </span>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[9px] block">Username</span>
                  <span className="text-white font-bold">{info.user}</span>
                </div>
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-slate-500 text-[9px] block">Password</span>
                    <span className="text-white font-bold truncate block">{info.password}</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(info.password, "Password")}
                    className="p-1 text-slate-400 hover:text-white shrink-0"
                  >
                    {copiedKey === "Password" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                {info.namespace && (
                  <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 text-[9px] block">Namespace</span>
                    <span className="text-white font-bold">{info.namespace}</span>
                  </div>
                )}
                {info.database && (
                  <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 text-[9px] block">Database</span>
                    <span className="text-white font-bold">{info.database}</span>
                  </div>
                )}
              </div>

              {/* Surrealist Quick Connect */}
              {info.surrealistUri && (
                <div className="pt-2 border-t border-slate-900 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-indigo-400 flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> Connect via Surrealist Desktop App
                    </span>
                    <button
                      onClick={() => copyToClipboard(info.surrealistUri, "Surrealist Endpoint")}
                      className="text-[10px] font-mono text-slate-400 hover:text-white underline"
                    >
                      {copiedKey === "Surrealist Endpoint" ? "Copied!" : "Copy Endpoint"}
                    </button>
                  </div>
                  <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 select-text break-all">
                    {info.surrealistUri}
                  </div>
                </div>
              )}

              {info.connectionString && (
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-slate-400">Connection URI</span>
                    <button
                      onClick={() => copyToClipboard(info.connectionString, "Connection URI")}
                      className="text-[10px] font-mono text-slate-400 hover:text-white underline"
                    >
                      {copiedKey === "Connection URI" ? "Copied!" : "Copy URI"}
                    </button>
                  </div>
                  <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-400 select-text break-all">
                    {info.connectionString}
                  </div>
                </div>
              )}
            </div>

            {/* Live Data Backup & Local Download */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-white block">Download Database Dump</span>
                <span className="text-[11px] text-slate-400">
                  Runs remote export and downloads the file to your computer
                </span>
              </div>
              <button
                onClick={handleDownloadBackup}
                disabled={isDownloading}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition active:scale-95 shrink-0"
              >
                {isDownloading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{isDownloading ? "Dumping..." : "Save Dump..."}</span>
              </button>
            </div>
          </div>
        ) : null}

        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/90 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
