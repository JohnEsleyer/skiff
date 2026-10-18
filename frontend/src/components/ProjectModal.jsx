import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FileKey2,
  Folder,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import CustomSelect from "./CustomSelect.jsx";

const SECRET_KEY_PATTERN = /pass|secret|token|private|credential|api[_-]?key/i;

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key || "");
}

function parseEnvTextToVars(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const vars = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let val = body.slice(eq + 1).trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      vars.push({ key, value: val });
    }
  }
  return vars;
}

function formatVarsToEnvText(vars) {
  if (!vars || vars.length === 0) return "";
  return vars
    .map((v) => {
      const val = v.value || "";
      if (/[\s#"']/.test(val) && !(val.startsWith('"') && val.endsWith('"'))) {
        return `${v.key}="${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      return `${v.key}=${val}`;
    })
    .join("\n");
}

const blankForm = (serverId) => ({
  id: `proj-${Date.now()}`,
  name: "New Project",
  localPath: "",
  serverId: serverId || "",
  appDir: "/opt/skiff/apps/my-app",
  domain: "",
  targetPort: 8080,
  tlsMode: "auto",
  buildSteps: [{ name: "Vite Client", command: "npm run build" }],
  artifacts: [{ local: "dist", remote: "public" }],
  remoteSetupSteps: [],
  sharedFiles: [".env", "uploads"],
  restartCommand: "sudo systemctl restart my-app && sudo systemctl reload caddy",
  healthUrl: "",
  keepReleases: 3,
  envVars: [],
  env: "",
});

const normalize = (p) => {
  const envVars = p.envVars?.length
    ? p.envVars
    : p.env
    ? parseEnvTextToVars(p.env)
    : [];
  return {
    ...p,
    domain: p.domain || "",
    targetPort: p.targetPort || 8080,
    tlsMode: p.tlsMode || "auto",
    buildSteps: p.buildSteps?.length ? p.buildSteps : [{ name: "Build App", command: "npm run build" }],
    artifacts: p.artifacts?.length ? p.artifacts : [{ local: "dist", remote: "public" }],
    remoteSetupSteps: p.remoteSetupSteps || [],
    sharedFiles: p.sharedFiles ?? [".env", "uploads"],
    keepReleases: p.keepReleases ?? 3,
    envVars,
    env: p.env || formatVarsToEnvText(envVars),
  };
};

export default function ProjectModal({
  isOpen,
  onClose,
  onSave,
  project,
  servers = [],
  selectedServerId = "",
}) {
  const [formData, setFormData] = useState(() => blankForm(selectedServerId || servers[0]?.id));
  const [hasDetectedConfig, setHasDetectedConfig] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  // Environment variables editor state
  const [detectedFiles, setDetectedFiles] = useState([]);
  const [isDetectingEnv, setIsDetectingEnv] = useState(false);
  const [activeDetectedFile, setActiveDetectedFile] = useState(null);
  const [envEditorMode, setEnvEditorMode] = useState("table");
  const [showAllSecrets, setShowAllSecrets] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [envRawText, setEnvRawText] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (project) {
      const norm = normalize(project);
      setFormData(norm);
      setEnvRawText(norm.env || formatVarsToEnvText(norm.envVars));
      setHasDetectedConfig(false);
      if (norm.localPath) {
        scanEnvFiles(norm.localPath, false);
      }
    } else {
      const bf = blankForm(selectedServerId || servers[0]?.id || "");
      setFormData(bf);
      setEnvRawText("");
      setHasDetectedConfig(false);
      setDetectedFiles([]);
      setActiveDetectedFile(null);
    }
  }, [project, servers, selectedServerId, isOpen]);

  const scanEnvFiles = async (folderPath, shouldAutoApply = true) => {
    if (!folderPath || !window.go?.main?.App?.DetectProjectEnvFiles) return;
    setIsDetectingEnv(true);
    try {
      const files = await window.go.main.App.DetectProjectEnvFiles(folderPath);
      setDetectedFiles(files || []);
      if (files && files.length > 0) {
        const primary = files[0];
        setActiveDetectedFile(primary.name);
        if (shouldAutoApply && (!formData.envVars || formData.envVars.length === 0)) {
          applyDetectedEnvFile(primary);
        }
      } else {
        setActiveDetectedFile(null);
      }
    } catch {
      setDetectedFiles([]);
      setActiveDetectedFile(null);
    } finally {
      setIsDetectingEnv(false);
    }
  };

  const applyDetectedEnvFile = (fileObj) => {
    if (!fileObj) return;
    const parsed = fileObj.vars && fileObj.vars.length > 0
      ? fileObj.vars
      : parseEnvTextToVars(fileObj.content);
    setFormData((prev) => ({
      ...prev,
      envVars: parsed,
      env: fileObj.content || formatVarsToEnvText(parsed),
    }));
    setEnvRawText(fileObj.content || formatVarsToEnvText(parsed));
    setActiveDetectedFile(fileObj.name);
  };

  if (!isOpen) return null;

  // Native OS folder picker + automatic skiff.json discovery
  const handleBrowseFolder = async () => {
    if (!window.go?.main?.App) return;
    setIsBrowsing(true);
    try {
      const chosenPath = await window.go.main.App.SelectFolderDialog();
      if (!chosenPath) return;

      let next = { ...formData, localPath: chosenPath };
      let detected = false;

      try {
        const cfg = await window.go.main.App.ReadSkiffConfigFromPath(chosenPath);
        if (cfg) {
          next = {
            ...normalize(cfg),
            id: formData.id || cfg.id || `proj-${Date.now()}`,
            localPath: chosenPath,
            serverId: cfg.serverId || formData.serverId || selectedServerId || servers[0]?.id || "",
          };
          detected = true;
        }
      } catch {
        detected = false;
      }

      setFormData(next);
      setHasDetectedConfig(detected);
      setEnvRawText(next.env || formatVarsToEnvText(next.envVars));

      scanEnvFiles(chosenPath, next.envVars.length === 0);
    } catch (err) {
      console.error("Directory dialog error:", err);
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleAddEnvVar = () => {
    const key = newEnvKey.trim();
    if (!key) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      alert("Variable key must start with a letter/underscore and contain only alphanumeric characters or underscores.");
      return;
    }
    const currentVars = formData.envVars || [];
    const exists = currentVars.some((v) => v.key === key);
    let nextVars;
    if (exists) {
      nextVars = currentVars.map((v) => (v.key === key ? { key, value: newEnvValue } : v));
    } else {
      nextVars = [...currentVars, { key, value: newEnvValue }];
    }
    const raw = formatVarsToEnvText(nextVars);
    setFormData((prev) => ({ ...prev, envVars: nextVars, env: raw }));
    setEnvRawText(raw);
    setNewEnvKey("");
    setNewEnvValue("");
  };

  const handleUpdateEnvVar = (idx, field, val) => {
    const nextVars = (formData.envVars || []).map((v, i) =>
      i === idx ? { ...v, [field]: val } : v
    );
    const raw = formatVarsToEnvText(nextVars);
    setFormData((prev) => ({ ...prev, envVars: nextVars, env: raw }));
    setEnvRawText(raw);
  };

  const handleRemoveEnvVar = (idx) => {
    const nextVars = (formData.envVars || []).filter((_, i) => i !== idx);
    const raw = formatVarsToEnvText(nextVars);
    setFormData((prev) => ({ ...prev, envVars: nextVars, env: raw }));
    setEnvRawText(raw);
  };

  const handleRawEnvChange = (text) => {
    setEnvRawText(text);
    const parsed = parseEnvTextToVars(text);
    setFormData((prev) => ({
      ...prev,
      envVars: parsed,
      env: text,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const finalVars = formData.envVars || [];
    const payload = {
      ...formData,
      env: envRawText || formatVarsToEnvText(finalVars),
      envVars: finalVars,
    };
    onSave(payload);
    onClose();
  };

  const updateBuildStep = (idx, field, val) => {
    setFormData((prev) => ({
      ...prev,
      buildSteps: prev.buildSteps.map((b, i) => (i === idx ? { ...b, [field]: val } : b)),
    }));
  };

  const updateArtifact = (idx, field, val) => {
    setFormData((prev) => ({
      ...prev,
      artifacts: prev.artifacts.map((a, i) => (i === idx ? { ...a, [field]: val } : a)),
    }));
  };

  const updateRemoteStep = (idx, field, val) => {
    setFormData((prev) => ({
      ...prev,
      remoteSetupSteps: (prev.remoteSetupSteps || []).map((s, i) => (i === idx ? { ...s, [field]: val } : s)),
    }));
  };

  const serverOptions = servers.map((s) => ({
    value: s.id,
    label: s.name,
    badge: `${s.host}:${s.port}`,
  }));

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">
              {project ? `Edit Recipe: ${project.name}` : "Configure New Project Recipe"}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Local Folder Selection with Native Picker */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <label className="text-[10px] font-mono uppercase text-slate-400 block font-semibold">
              Project Folder (Development Machine)
            </label>
            <div className="flex gap-2">
              <input
                required
                placeholder="Click Browse to select project directory..."
                value={formData.localPath}
                onChange={(e) => {
                  const val = e.target.value;
                  setFormData((prev) => ({ ...prev, localPath: val }));
                  scanEnvFiles(val, false);
                }}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono outline-none min-w-0"
              />
              <button
                type="button"
                onClick={handleBrowseFolder}
                disabled={isBrowsing}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shrink-0 active:scale-95"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>{isBrowsing ? "Browsing..." : "Browse Folder..."}</span>
              </button>
            </div>

            {hasDetectedConfig && (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 pt-1 font-mono">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Detected skiff.json — recipe populated automatically.</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Recipe Name</label>
              <input
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Target VPS Server</label>
              <CustomSelect
                value={formData.serverId}
                onChange={(val) => setFormData({ ...formData, serverId: val })}
                options={serverOptions}
                placeholder="Select VPS destination..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Remote Target App Path</label>
              <input
                required
                value={formData.appDir}
                onChange={(e) => setFormData({ ...formData, appDir: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Health Check Probe URL</label>
              <input
                placeholder="https://notes.yourdomain.com/api/health"
                value={formData.healthUrl}
                onChange={(e) => setFormData({ ...formData, healthUrl: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* PROJECT ENVIRONMENT VARIABLES INTERFACE */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <FileKey2 className="w-3.5 h-3.5 text-emerald-400" />
                <label className="text-[10px] font-mono uppercase text-emerald-400 font-bold">
                  Environment Variables (.env)
                </label>
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800">
                  {(formData.envVars || []).length} configured
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {formData.localPath && (
                  <button
                    type="button"
                    onClick={() => scanEnvFiles(formData.localPath, true)}
                    disabled={isDetectingEnv}
                    className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-[10px] font-mono flex items-center gap-1 border border-slate-800 transition"
                    title="Scan project folder for .env files"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${isDetectingEnv ? "animate-spin text-emerald-400" : ""}`} />
                    <span>Detect .env</span>
                  </button>
                )}

                <div className="flex items-center p-0.5 rounded-lg bg-slate-900 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEnvEditorMode("table")}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition ${
                      envEditorMode === "table" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Table2 className="w-2.5 h-2.5" /> Key-Value
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnvEditorMode("raw")}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition ${
                      envEditorMode === "raw" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Pencil className="w-2.5 h-2.5" /> Raw
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAllSecrets((s) => !s)}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-900"
                  title={showAllSecrets ? "Mask secrets" : "Reveal secrets"}
                >
                  {showAllSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Auto-detected .env files banner & quick loader */}
            {detectedFiles.length > 0 && (
              <div className="p-2.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-emerald-300 flex items-center gap-1.5 font-bold">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    Auto-detected {detectedFiles.length} env file(s) in project folder:
                  </span>
                  <span className="text-slate-500">Click to load</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {detectedFiles.map((df) => (
                    <button
                      key={df.name}
                      type="button"
                      onClick={() => applyDetectedEnvFile(df)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-mono flex items-center gap-1 border transition ${
                        activeDetectedFile === df.name
                          ? "bg-emerald-950 text-emerald-300 border-emerald-700/80 font-bold"
                          : "bg-slate-900 text-slate-300 border-slate-800 hover:border-emerald-600/50"
                      }`}
                    >
                      <span>{df.name}</span>
                      <span className="text-slate-500">({df.vars?.length || 0})</span>
                      {activeDetectedFile === df.name && <Check className="w-2.5 h-2.5 text-emerald-400 ml-0.5" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Mode A: Key-Value Table Editor */}
            {envEditorMode === "table" && (
              <div className="space-y-2">
                <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scroll pr-1">
                  {(formData.envVars || []).map((ev, idx) => {
                    const isSecret = isSecretKey(ev.key);
                    return (
                      <div key={idx} className="flex items-center gap-1.5">
                        <input
                          placeholder="KEY"
                          value={ev.key}
                          onChange={(e) => handleUpdateEnvVar(idx, "key", e.target.value.toUpperCase())}
                          className="w-1/3 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-indigo-300 font-mono outline-none focus:border-indigo-500 min-w-0"
                        />
                        <input
                          type={isSecret && !showAllSecrets ? "password" : "text"}
                          placeholder="value"
                          value={ev.value}
                          onChange={(e) => handleUpdateEnvVar(idx, "value", e.target.value)}
                          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-indigo-500 min-w-0"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveEnvVar(idx)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 rounded shrink-0 transition"
                          title="Remove variable"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}

                  {(!formData.envVars || formData.envVars.length === 0) && (
                    <div className="p-4 text-center text-slate-600 text-[11px] font-mono border border-dashed border-slate-800/80 rounded-xl">
                      No environment variables set. Add one below or load from detected .env.
                    </div>
                  )}
                </div>

                {/* Manual Add Variable Inputs */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/60">
                  <input
                    placeholder="NEW_KEY"
                    value={newEnvKey}
                    onChange={(e) => setNewEnvKey(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddEnvVar())}
                    className="w-1/3 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-indigo-300 font-mono outline-none focus:border-indigo-500 min-w-0"
                  />
                  <input
                    placeholder="value"
                    value={newEnvValue}
                    onChange={(e) => setNewEnvValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddEnvVar())}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-indigo-500 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={handleAddEnvVar}
                    disabled={!newEnvKey.trim()}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </div>
            )}

            {/* Mode B: Raw Text Editor */}
            {envEditorMode === "raw" && (
              <div className="space-y-1">
                <textarea
                  value={envRawText}
                  onChange={(e) => handleRawEnvChange(e.target.value)}
                  spellCheck={false}
                  placeholder={`# Define variables as KEY=value\nPORT=8080\nNODE_ENV=production`}
                  className="w-full h-36 bg-slate-900 border border-slate-800 rounded-xl p-2.5 font-mono text-[11px] text-slate-100 outline-none focus:border-indigo-500 leading-relaxed resize-y"
                />
                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>Lines: {envRawText ? envRawText.split("\n").length : 0}</span>
                  <span>Parsed: {(formData.envVars || []).length} variables</span>
                </div>
              </div>
            )}

            <p className="text-[10px] text-slate-500 font-mono leading-tight">
              Stored securely on VPS at <code className="text-slate-400">{formData.appDir || "/opt/skiff/apps/<app>"}/shared/.env</code> (chmod 0600) and linked into each release.
            </p>
          </div>

          {/* Sequential Local Build Commands */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase text-slate-400">Local Build Steps (Executed in sequence)</label>
              <button
                type="button"
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    buildSteps: [...prev.buildSteps, { name: "New Step", command: "" }],
                  }))
                }
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold"
              >
                <Plus className="w-3 h-3" /> Add Step
              </button>
            </div>
            <div className="space-y-2">
              {formData.buildSteps.map((b, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    placeholder="Step Label"
                    value={b.name}
                    onChange={(e) => updateBuildStep(i, "name", e.target.value)}
                    className="w-1/3 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-300 min-w-0"
                  />
                  <input
                    placeholder="Command string (e.g. npm run build)"
                    value={b.command}
                    onChange={(e) => updateBuildStep(i, "command", e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-mono min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        buildSteps: prev.buildSteps.filter((_, j) => j !== i),
                      }))
                    }
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Artifacts */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase text-slate-400">Artifacts to Ship</label>
              <button
                type="button"
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    artifacts: [...(prev.artifacts || []), { local: "", remote: "" }],
                  }))
                }
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold"
              >
                <Plus className="w-3 h-3" /> Add Artifact
              </button>
            </div>
            <div className="space-y-2">
              {(formData.artifacts || []).map((a, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    placeholder="Local (e.g. dist)"
                    value={a.local}
                    onChange={(e) => updateArtifact(i, "local", e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-mono min-w-0"
                  />
                  <span className="text-slate-600 text-xs shrink-0">→</span>
                  <input
                    placeholder="Remote (e.g. public)"
                    value={a.remote}
                    onChange={(e) => updateArtifact(i, "remote", e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-mono min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        artifacts: prev.artifacts.filter((_, j) => j !== i),
                      }))
                    }
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Domain & SSL Configuration (synced to Caddy on deploy) */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <label className="text-[10px] font-mono uppercase text-indigo-400 block font-semibold">
              Domain &amp; SSL Configuration
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] font-mono text-slate-500 block mb-1">Domain Name (Optional)</label>
                <input
                  placeholder="e.g. notes.mydomain.com"
                  value={formData.domain || ""}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-500 block mb-1">Backend Port</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  placeholder="8080"
                  value={formData.targetPort || 8080}
                  onChange={(e) => setFormData({ ...formData, targetPort: Number(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-mono text-slate-500 block mb-1">TLS / SSL Mode</label>
              <CustomSelect
                value={formData.tlsMode || "auto"}
                onChange={(val) => setFormData({ ...formData, tlsMode: val })}
                options={[
                  { value: "auto", label: "Automatic Let's Encrypt SSL (Production)" },
                  { value: "http", label: "Fast Prototyping (HTTP Only, No SSL)" },
                  { value: "none", label: "Raw Port Proxy Only" },
                ]}
              />
            </div>
          </div>

          {/* Remote Setup / Migration Steps (run on VPS inside release dir) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase text-slate-400">
                Remote Setup Steps (VPS, with DB env injected)
              </label>
              <button
                type="button"
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    remoteSetupSteps: [
                      ...(prev.remoteSetupSteps || []),
                      { name: "Run Setup", command: "bash setup.sh" },
                    ],
                  }))
                }
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold"
              >
                <Plus className="w-3 h-3" /> Add Remote Step
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mb-2 font-mono">
              Env available: $SURREAL_USER $SURREAL_PASS $SURREAL_ENDPOINT $SKIFF_SHARED_DIR $SKIFF_RELEASE_DIR
            </p>
            <div className="space-y-2">
              {(formData.remoteSetupSteps || []).map((s, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    placeholder="Step Label (e.g. DB Schema)"
                    value={s.name}
                    onChange={(e) => updateRemoteStep(i, "name", e.target.value)}
                    className="w-1/3 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-300 min-w-0"
                  />
                  <input
                    placeholder="Remote command (e.g. bash setup.sh)"
                    value={s.command}
                    onChange={(e) => updateRemoteStep(i, "command", e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white font-mono min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        remoteSetupSteps: prev.remoteSetupSteps.filter((_, j) => j !== i),
                      }))
                    }
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {(formData.remoteSetupSteps || []).length === 0 && (
                <div className="text-[11px] text-slate-600 font-mono">
                  No remote steps — ship artifacts only.
                </div>
              )}
            </div>
          </div>

          {/* Shared files */}
          <div>
            <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
              Shared Files (comma-separated, symlinked from shared/)
            </label>
            <input
              placeholder=".env, uploads"
              value={(formData.sharedFiles || []).join(", ")}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  sharedFiles: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Post-Deploy Activation Command</label>
            <input
              value={formData.restartCommand}
              onChange={(e) => setFormData({ ...formData, restartCommand: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Releases to Keep</label>
            <input
              type="number"
              min={1}
              max={20}
              value={formData.keepReleases}
              onChange={(e) => setFormData({ ...formData, keepReleases: Number(e.target.value) })}
              className="w-32 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition"
            >
              Save Project Recipe
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
