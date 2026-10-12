import { useEffect, useState } from "react";
import { CheckCircle2, Folder, Layers, Plus, Trash2, X } from "lucide-react";
import CustomSelect from "./CustomSelect.jsx";

const blankForm = (serverId) => ({
  id: `proj-${Date.now()}`,
  name: "New Project",
  localPath: "",
  serverId: serverId || "",
  appDir: "/opt/skiff/apps/my-app",
  buildSteps: [{ name: "Vite Client", command: "npm run build" }],
  artifacts: [{ local: "dist", remote: "public" }],
  remoteSetupSteps: [],
  sharedFiles: [".env", "uploads"],
  restartCommand: "sudo systemctl restart my-app && sudo systemctl reload caddy",
  healthUrl: "",
  keepReleases: 3,
});

const normalize = (p) => ({
  ...p,
  buildSteps: p.buildSteps?.length ? p.buildSteps : [{ name: "Build App", command: "npm run build" }],
  artifacts: p.artifacts?.length ? p.artifacts : [{ local: "dist", remote: "public" }],
  remoteSetupSteps: p.remoteSetupSteps || [],
  sharedFiles: p.sharedFiles ?? [".env", "uploads"],
  keepReleases: p.keepReleases ?? 3,
});

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

  useEffect(() => {
    if (!isOpen) return;
    if (project) {
      setFormData(normalize(project));
      setHasDetectedConfig(false);
    } else {
      setFormData(blankForm(selectedServerId || servers[0]?.id || ""));
      setHasDetectedConfig(false);
    }
  }, [project, servers, selectedServerId, isOpen]);

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
    } catch (err) {
      console.error("Directory dialog error:", err);
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
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
                readOnly
                placeholder="Click Browse to select project directory..."
                value={formData.localPath}
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
