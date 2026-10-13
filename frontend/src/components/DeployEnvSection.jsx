import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Database,
  Download,
  Eye,
  EyeOff,
  FileKey2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Table2,
  Trash2,
} from "lucide-react";

const SECRET_KEY_PATTERN = /pass|secret|token|private|credential|api[_-]?key/i;

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key || "");
}

function quoteValue(value) {
  if (/[\s#"']/.test(value) && !(value.startsWith('"') && value.endsWith('"'))) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

// Splits .env text into kv rows (editable) and opaque "other" rows
// (comments, blanks, malformed lines) that round-trip untouched.
function parseEnv(content) {
  return (content || "").split("\n").map((line, idx) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      return { id: idx, type: "other", text: line };
    }
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) {
      return { id: idx, type: "other", text: line };
    }
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1);
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return { id: idx, type: "other", text: line };
    }
    return { id: idx, type: "kv", key, value, masked: isSecretKey(key) };
  });
}

function serializeEnv(rows) {
  return rows.map((r) => (r.type === "kv" ? `${r.key}=${quoteValue(r.value)}` : r.text)).join("\n");
}

export default function DeployEnvSection({
  server,
  appDir = "",
  appName = "",
  localPath = "",
  addToast,
}) {
  const [content, setContent] = useState("");
  const [loadedContent, setLoadedContent] = useState("");
  const [exists, setExists] = useState(false);
  const [modifiedAt, setModifiedAt] = useState("");
  const [credentials, setCredentials] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [mode, setMode] = useState("raw");
  const [showSecrets, setShowSecrets] = useState(false);
  const [restartOnSave, setRestartOnSave] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const idCounterRef = useRef(100000);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadEnv = async () => {
    if (!window.go?.main?.App || !server || !appDir) return;
    setIsLoading(true);
    try {
      const info = await window.go.main.App.GetAppEnv(server.id, appDir, appName);
      if (!isMountedRef.current) return;
      setContent(info?.content || "");
      setLoadedContent(info?.content || "");
      setExists(!!info?.exists);
      setModifiedAt(info?.modifiedAt || "");
      setCredentials(info?.credentials || []);
    } catch (err) {
      if (isMountedRef.current) addToast("error", "Failed to Load .env", String(err));
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    setContent("");
    setLoadedContent("");
    setExists(false);
    setModifiedAt("");
    setCredentials([]);
    if (server && appDir) loadEnv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id, appDir]);

  const rows = useMemo(() => parseEnv(content), [content]);
  const kvCount = rows.filter((r) => r.type === "kv").length;
  const suspiciousLines = rows.filter(
    (r) => r.type === "other" && r.text.trim() !== "" && !r.text.trim().startsWith("#")
  );
  const isDirty = content !== loadedContent;
  const lineCount = (content || "").split("\n").length;

  const updateRows = (nextRows) => setContent(serializeEnv(nextRows));

  const handleRowChange = (id, field, value) => {
    updateRows(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleRowDelete = (id) => {
    updateRows(rows.filter((r) => r.id !== id));
  };

  const handleToggleRowMask = (id) => {
    updateRows(rows.map((r) => (r.id === id ? { ...r, masked: !r.masked } : r)));
  };

  const handleAddRow = () => {
    const key = newKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      addToast("warning", "Invalid Key", "Use letters, digits and underscores; must not start with a digit.");
      return;
    }
    if (rows.some((r) => r.type === "kv" && r.key === key)) {
      addToast("warning", "Duplicate Key", `${key} already exists — edit it inline instead.`);
      return;
    }
    idCounterRef.current += 1;
    updateRows([
      ...rows,
      { id: idCounterRef.current, type: "kv", key, value: newValue, masked: isSecretKey(key) },
    ]);
    setNewKey("");
    setNewValue("");
  };

  const handleInsertChip = (chip) => {
    const next = [...rows];
    const existing = next.find((r) => r.type === "kv" && r.key === chip.key);
    if (existing) {
      existing.value = chip.value;
      if (isSecretKey(chip.key)) existing.masked = true;
    } else {
      idCounterRef.current += 1;
      next.push({
        id: idCounterRef.current,
        type: "kv",
        key: chip.key,
        value: chip.value,
        masked: isSecretKey(chip.key),
      });
    }
    setContent(serializeEnv(next));
    addToast("info", "Inserted", `${chip.key} staged — press Save to apply on the VPS.`);
  };

  const handleImportLocal = async () => {
    if (!window.go?.main?.App || !localPath) return;
    setIsImporting(true);
    try {
      const text = await window.go.main.App.GetLocalProjectEnv(localPath);
      if (!isMountedRef.current) return;
      setContent(text || "");
      addToast(
        "info",
        "Local .env Imported",
        "Editor replaced with local file — press Save to apply on the VPS."
      );
    } catch (err) {
      if (isMountedRef.current) addToast("warning", "Local Import Failed", String(err));
    } finally {
      if (isMountedRef.current) setIsImporting(false);
    }
  };

  const handleSave = async () => {
    if (!window.go?.main?.App || !server || !appDir) return;
    setIsSaving(true);
    try {
      await window.go.main.App.SaveAppEnv(server.id, appDir, appName, content, restartOnSave);
      if (!isMountedRef.current) return;
      setLoadedContent(content);
      setExists(true);
      addToast(
        "success",
        ".env Saved",
        restartOnSave ? "Written with 0600 and service restarted." : "Written with 0600 and linked into current/."
      );
      loadEnv();
    } catch (err) {
      if (isMountedRef.current) addToast("error", "Save Failed", String(err), 6000);
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const maskValue = (value) => (value ? "••••••••" : "(empty)");

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
            <FileKey2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white flex items-center gap-2">
              <span>Environment (.env)</span>
              {exists ? (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                  On VPS
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-amber-950/80 text-amber-300 border border-amber-800/60">
                  Not created yet
                </span>
              )}
              {isDirty && (
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-700/60">
                  Unsaved changes
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              {appDir}/shared/.env
              {modifiedAt ? <span className="text-slate-500"> · modified {modifiedAt}</span> : null}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadEnv}
          disabled={isLoading}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          title="Reload from VPS"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-indigo-400" : ""}`} />
        </button>
      </div>

      {/* Discovered stack credentials */}
      {credentials.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase text-slate-400 font-semibold flex items-center gap-1.5">
            <Database className="w-3 h-3 text-indigo-400" />
            <span>Discovered stack credentials — click to insert</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {credentials.map((chip, i) => (
              <button
                key={`${chip.key}-${i}`}
                type="button"
                onClick={() => handleInsertChip(chip)}
                title={`${chip.key}=${isSecretKey(chip.key) ? "••••••••" : chip.value}`}
                className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500 text-[10px] font-mono text-slate-300 transition flex items-center gap-1.5"
              >
                <span className="text-slate-500">[{chip.source}]</span>
                <span className="text-indigo-300 font-semibold">{chip.key}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar: mode toggle, secrets visibility, local import */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-950 border border-slate-800">
          <button
            type="button"
            onClick={() => setMode("raw")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition ${
              mode === "raw" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Pencil className="w-3 h-3" />
            <span>Raw Editor</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("table")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition ${
              mode === "table" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Table2 className="w-3 h-3" />
            <span>Key-Value Table</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {localPath ? (
            <button
              type="button"
              onClick={handleImportLocal}
              disabled={isImporting}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1.5 transition"
              title={`Import from ${localPath}`}
            >
              <Download className={`w-3 h-3 ${isImporting ? "animate-bounce" : ""}`} />
              <span>{isImporting ? "Importing..." : "Import from Local Project"}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowSecrets((v) => !v)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1.5 transition"
          >
            {showSecrets ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{showSecrets ? "Hide secrets" : "Reveal secrets"}</span>
          </button>
        </div>
      </div>

      {/* Raw editor */}
      {mode === "raw" && (
        <div className="space-y-1.5">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            placeholder="# No .env on the VPS yet — type KEY=value lines, then Save."
            className="w-full h-64 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-[11px] text-slate-100 font-mono outline-none focus:border-indigo-500 resize-y leading-relaxed"
          />
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
            <span>
              {lineCount} lines · {kvCount} keys
            </span>
            {suspiciousLines.length > 0 ? (
              <span className="text-amber-300">
                {suspiciousLines.length} line{suspiciousLines.length === 1 ? "" : "s"} without
                KEY=value (kept as-is)
              </span>
            ) : (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check className="w-3 h-3" /> syntax looks valid
              </span>
            )}
          </div>
        </div>
      )}

      {/* Key-value table */}
      {mode === "table" && (
        <div className="space-y-2">
          <div className="overflow-hidden border border-slate-800 rounded-xl">
            <table className="w-full text-left text-[11px] font-mono">
              <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                <tr>
                  <th className="p-2 pl-3 w-1/3">Key</th>
                  <th className="p-2">Value</th>
                  <th className="p-2 text-right pr-3 w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                {rows
                  .filter((r) => r.type === "kv")
                  .map((r) => (
                    <tr key={r.id}>
                      <td className="p-1.5 pl-3">
                        <input
                          value={r.key}
                          onChange={(e) => handleRowChange(r.id, "key", e.target.value)}
                          spellCheck={false}
                          className="w-full bg-transparent border border-transparent hover:border-slate-700 focus:border-indigo-500 rounded-lg px-2 py-1 text-indigo-300 font-semibold outline-none"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          value={r.masked && !showSecrets ? maskValue(r.value) : r.value}
                          onChange={(e) => handleRowChange(r.id, "value", e.target.value)}
                          spellCheck={false}
                          readOnly={r.masked && !showSecrets}
                          type={r.masked && !showSecrets ? "password" : "text"}
                          className="w-full bg-transparent border border-transparent hover:border-slate-700 focus:border-indigo-500 rounded-lg px-2 py-1 text-slate-100 outline-none"
                        />
                      </td>
                      <td className="p-1.5 pr-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleToggleRowMask(r.id)}
                            title={r.masked ? "Unmask this row" : "Mask this row"}
                            className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition"
                          >
                            {r.masked && !showSecrets ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRowDelete(r.id)}
                            title="Delete row"
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {kvCount === 0 && (
              <div className="p-5 text-center text-slate-500 text-[11px] font-mono bg-slate-950/40">
                No KEY=value rows yet — add one below or switch to the Raw Editor.
              </div>
            )}
          </div>

          {/* Add row */}
          <div className="flex items-center gap-2">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="NEW_KEY"
              spellCheck={false}
              className="w-1/3 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-[11px] text-indigo-300 font-mono outline-none focus:border-indigo-500"
            />
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              spellCheck={false}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-[11px] text-slate-100 font-mono outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleAddRow}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              title="Add row"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Save bar */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-800/60 gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={restartOnSave}
            onChange={(e) => setRestartOnSave(e.target.checked)}
            className="accent-indigo-600 w-3.5 h-3.5"
          />
          <span>
            Restart app service (<span className="font-mono text-slate-300">{appName || "app"}</span>)
            on save
          </span>
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !isDirty}
          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs transition active:scale-95 shadow-md shadow-emerald-600/30 flex items-center gap-1.5"
        >
          {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          <span>{isSaving ? "Saving..." : exists ? "Save .env to VPS" : "Create .env on VPS"}</span>
        </button>
      </div>
    </div>
  );
}
