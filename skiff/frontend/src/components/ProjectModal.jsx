import { useState, useEffect } from "react";
import { Layers, Plus, Trash2, X } from "lucide-react";

const emptyForm = (servers) => ({
  id: `proj-${Date.now()}`,
  name: "New Project",
  localPath: ".",
  serverId: servers[0]?.id || "",
  appDir: "/opt/skiff/apps/my-app",
  buildSteps: [
    { name: "Frontend", command: "npm run build" },
    { name: "Backend", command: "cargo build --release --target x86_64-unknown-linux-musl" },
  ],
  artifacts: [
    { local: "dist", remote: "public" },
    { local: "server/target/x86_64-unknown-linux-musl/release/esper-server", remote: "esper-server" },
  ],
  sharedFiles: [".env", "uploads"],
  restartCommand: "sudo systemctl restart esper-server && sudo systemctl reload caddy",
  healthUrl: "",
  keepReleases: 3,
});

export default function ProjectModal({ isOpen, onClose, onSave, project, servers = [] }) {
  const [formData, setFormData] = useState(() => emptyForm(servers));

  useEffect(() => {
    if (!isOpen) return;
    if (project) {
      setFormData({
        ...project,
        buildSteps: project.buildSteps?.length ? project.buildSteps : [{ name: "Build App", command: "npm run build" }],
        artifacts: project.artifacts?.length ? project.artifacts : [{ local: "dist", remote: "public" }],
        sharedFiles: project.sharedFiles ?? [".env", "uploads"],
        keepReleases: project.keepReleases ?? 3,
      });
    } else {
      setFormData(emptyForm(servers));
    }
  }, [project, servers, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  const addBuildStep = () => {
    setFormData((prev) => ({
      ...prev,
      buildSteps: [...prev.buildSteps, { name: "Step", command: "" }],
    }));
  };

  const removeBuildStep = (idx) => {
    setFormData((prev) => ({
      ...prev,
      buildSteps: prev.buildSteps.filter((_, i) => i !== idx),
    }));
  };

  const addArtifact = () => {
    setFormData((prev) => ({
      ...prev,
      artifacts: [...(prev.artifacts || []), { local: "", remote: "" }],
    }));
  };

  const removeArtifact = (idx) => {
    setFormData((prev) => ({
      ...prev,
      artifacts: prev.artifacts.filter((_, i) => i !== idx),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">
              {project ? "Edit Project Recipe" : "New Project Recipe"}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Project Name</label>
              <input
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Target VPS Server</label>
              <select
                required
                value={formData.serverId}
                onChange={(e) => setFormData({ ...formData, serverId: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
              >
                <option value="">Select a server...</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.host})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Local Project Path</label>
              <input
                required
                value={formData.localPath}
                onChange={(e) => setFormData({ ...formData, localPath: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Remote Root App Directory</label>
              <input
                required
                value={formData.appDir}
                onChange={(e) => setFormData({ ...formData, appDir: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Sequential Local Build Commands */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase text-slate-400">Local Build Steps</label>
              <button
                type="button"
                onClick={addBuildStep}
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
                    onChange={(e) => {
                      const next = [...formData.buildSteps];
                      next[i] = { ...next[i], name: e.target.value };
                      setFormData({ ...formData, buildSteps: next });
                    }}
                    className="w-1/3 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-slate-300"
                  />
                  <input
                    placeholder="Command string (e.g. npm run build)"
                    value={b.command}
                    onChange={(e) => {
                      const next = [...formData.buildSteps];
                      next[i] = { ...next[i], command: e.target.value };
                      setFormData({ ...formData, buildSteps: next });
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeBuildStep(i)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded"
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
                onClick={addArtifact}
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
                    onChange={(e) => {
                      const next = [...formData.artifacts];
                      next[i] = { ...next[i], local: e.target.value };
                      setFormData({ ...formData, artifacts: next });
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-white font-mono"
                  />
                  <span className="text-slate-600 text-xs">→</span>
                  <input
                    placeholder="Remote (e.g. public)"
                    value={a.remote}
                    onChange={(e) => {
                      const next = [...formData.artifacts];
                      next[i] = { ...next[i], remote: e.target.value };
                      setFormData({ ...formData, artifacts: next });
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeArtifact(i)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Restart Command</label>
            <input
              value={formData.restartCommand}
              onChange={(e) => setFormData({ ...formData, restartCommand: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Health Check Probe URL</label>
              <input
                placeholder="https://notes.yourdomain.com/api/health"
                value={formData.healthUrl}
                onChange={(e) => setFormData({ ...formData, healthUrl: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">Keep Releases</label>
              <input
                type="number"
                min={1}
                max={20}
                value={formData.keepReleases}
                onChange={(e) => setFormData({ ...formData, keepReleases: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-xs"
            >
              Save Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
