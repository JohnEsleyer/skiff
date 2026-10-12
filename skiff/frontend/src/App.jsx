import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  CheckCircle2,
  Cpu,
  Edit2,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";

import ToastContainer from "./components/ToastContainer.jsx";
import ConfirmModal from "./components/ConfirmModal.jsx";
import TelemetryModal from "./components/TelemetryModal.jsx";
import ProjectModal from "./components/ProjectModal.jsx";

export default function App() {
  const [activeTab, setActiveTab] = useState("deploy"); // "deploy" | "servers" | "logs"
  const [servers, setServers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);

  // Live Pipeline State
  const [deployLogs, setDeployLogs] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [steps, setSteps] = useState({
    preflight: "idle",
    build: "idle",
    transfer: "idle",
    activate: "idle",
    verify: "idle",
  });

  // Telemetry & Diagnostic state
  const [telemetry, setTelemetry] = useState(null);
  const [testingServerId, setTestingServerId] = useState(null);
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [selectedServerForTele, setSelectedServerForTele] = useState(null);

  // Modals
  const [showServerModal, setShowServerModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  // Custom Toast Engine
  const [toasts, setToasts] = useState([]);
  const addToast = (type, title, message, duration = 4000) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, title, message, duration }]);
  };
  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Custom Confirmation Engine
  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    isDestructive: false,
    isLoading: false,
    onConfirm: null,
  });

  // Server Modal Form
  const [serverForm, setServerForm] = useState({
    id: "",
    name: "",
    host: "",
    port: 22,
    user: "root",
    authType: "key",
    keyPath: "",
    password: "",
  });

  const [remoteLogs, setRemoteLogs] = useState([]);
  const logBottomRef = useRef(null);

  // Load persistence and register runtime events
  useEffect(() => {
    loadData();

    if (window.runtime) {
      window.runtime.EventsOn("deploy:log", (msg) => {
        setDeployLogs((prev) => [...prev, msg]);
      });
      window.runtime.EventsOn("deploy:step", (data) => {
        setSteps((prev) => ({ ...prev, [data.step]: data.status }));
      });
      window.runtime.EventsOn("deploy:error", (err) => {
        setDeployLogs((prev) => [...prev, `[ERROR] ${err}`]);
        setIsDeploying(false);
        addToast("error", "Deployment Failed", err, 6000);
      });
      window.runtime.EventsOn("remote:log", (line) => {
        setRemoteLogs((prev) => [...prev.slice(-400), line]);
      });
    }

    return () => {
      if (window.runtime) {
        window.runtime.EventsOff("deploy:log");
        window.runtime.EventsOff("deploy:step");
        window.runtime.EventsOff("deploy:error");
        window.runtime.EventsOff("remote:log");
      }
    };
  }, []);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [deployLogs, remoteLogs]);

  const loadData = async () => {
    if (!window.go?.main?.App) return;
    try {
      const s = await window.go.main.App.GetServers();
      const p = await window.go.main.App.GetProjects();
      setServers(s || []);
      setProjects(p || []);
      if (p && p.length > 0 && !activeProject) {
        setActiveProject(p[0]);
      }
    } catch (err) {
      addToast("error", "Storage Read Error", String(err));
    }
  };

  const handleTestConnection = async (srv) => {
    if (!window.go?.main?.App) return;
    setTestingServerId(srv.id);
    try {
      const res = await window.go.main.App.TestServerConnection(srv);
      setTelemetry(res);
      setSelectedServerForTele(srv);
      setShowTelemetryModal(true);
      addToast("success", "Connected", `Probe successful on ${srv.host}`);
    } catch (err) {
      addToast("error", "SSH Connection Failed", String(err), 6000);
    } finally {
      setTestingServerId(null);
    }
  };

  const handleSaveServer = async (e) => {
    e.preventDefault();
    const id = serverForm.id || `srv-${Date.now()}`;
    try {
      await window.go.main.App.SaveServer({ ...serverForm, id, port: Number(serverForm.port) });
      setShowServerModal(false);
      addToast("success", "Server Saved", `${serverForm.name} profile configured`);
      loadData();
    } catch (err) {
      addToast("error", "Save Failed", String(err));
    }
  };

  const handleDeleteServer = (srv) => {
    setConfirmState({
      isOpen: true,
      title: "Remove Server Connection?",
      message: `Delete "${srv.name}" (${srv.host}) from your local keychain?`,
      confirmText: "Delete Server",
      isDestructive: true,
      isLoading: false,
      onConfirm: async () => {
        try {
          await window.go.main.App.DeleteServer(srv.id);
          addToast("info", "Server Removed", srv.name);
          loadData();
        } catch (err) {
          addToast("error", "Delete Failed", String(err));
        } finally {
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const handleSaveProject = async (proj) => {
    try {
      await window.go.main.App.SaveProject(proj);
      addToast("success", "Project Updated", proj.name);
      loadData();
      setActiveProject(proj);
    } catch (err) {
      addToast("error", "Project Save Error", String(err));
    }
  };

  const handleStartDeploy = async () => {
    if (!activeProject || isDeploying) return;
    setIsDeploying(true);
    setDeployLogs([]);
    setSteps({ preflight: "idle", build: "idle", transfer: "idle", activate: "idle", verify: "idle" });
    addToast("info", "Deploy Started", `Preparing pipeline for ${activeProject.name}`);

    try {
      await window.go.main.App.DeployProject(activeProject.id);
    } catch (err) {
      addToast("error", "Deploy Trigger Failed", String(err));
      setIsDeploying(false);
    }
  };

  const handleRollbackPrompt = () => {
    if (!activeProject) return;
    setConfirmState({
      isOpen: true,
      title: "Atomic Rollback",
      message: `Switch symlink on "${activeProject.name}" to the previous release and restart service?`,
      confirmText: "Rollback Release",
      isDestructive: false,
      isLoading: false,
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isLoading: true }));
        try {
          await window.go.main.App.RollbackProject(activeProject.id);
          addToast("success", "Rollback Executed", "Symlink swapped to prior release.");
        } catch (err) {
          addToast("error", "Rollback Failed", String(err));
        } finally {
          setConfirmState((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        }
      },
    });
  };

  const handleBootstrapPrompt = (srv) => {
    setConfirmState({
      isOpen: true,
      title: "Bootstrap Low-End VPS",
      message: `This will SSH into ${srv.host}, enable a 1.5GB swap file, install Caddy & SurrealDB, and prepare directories under /opt/skiff. Continue?`,
      confirmText: "Run Provisioner",
      isDestructive: false,
      isLoading: false,
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isLoading: true }));
        try {
          await window.go.main.App.BootstrapVPS(srv.id);
          setActiveTab("deploy");
          addToast("info", "Provisioning Initiated", "Check pipeline logs for progress");
        } catch (err) {
          addToast("error", "Bootstrap Failed", String(err));
        } finally {
          setConfirmState((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        }
      },
    });
  };

  const handleStartLogs = () => {
    if (!activeProject) return;
    setRemoteLogs([]);
    window.go.main.App.StartLogStream(activeProject.serverId, "journalctl -u esper-server -f -n 60");
  };

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200 text-xs font-sans select-none">
      {/* Top Application Header */}
      <header className="h-12 border-b border-slate-800 bg-slate-900/90 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
            <span className="font-bold text-sm text-white tracking-wider font-mono">SKIFF</span>
          </div>
          <span className="text-slate-700">/</span>
          <span className="text-slate-400 font-medium">Desktop Deployment Engine</span>
        </div>

        {/* Global Hardware Telemetry Pill */}
        {telemetry && (
          <button
            onClick={() => setShowTelemetryModal(true)}
            className="flex items-center gap-3 px-3 py-1 rounded-full bg-slate-950 hover:bg-slate-900 border border-slate-800 font-mono text-[11px] transition"
          >
            <span className="flex items-center gap-1 text-emerald-400">
              <Cpu className="w-3 h-3" /> RAM: {telemetry.usedRamMb}/{telemetry.totalRamMb}MB ({telemetry.ramPercent.toFixed(1)}%)
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1 text-slate-300">
              <HardDrive className="w-3 h-3" /> Disk: {telemetry.diskAvail}
            </span>
          </button>
        )}

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("deploy")}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === "deploy" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Deploy
          </button>
          <button
            onClick={() => setActiveTab("servers")}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === "servers" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Servers ({servers.length})
          </button>
          <button
            onClick={() => {
              setActiveTab("logs");
              handleStartLogs();
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === "logs" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Remote Logs
          </button>
        </nav>
      </header>

      {/* Main Body Switcher */}
      <main className="flex-1 overflow-hidden flex">
        {/* TAB 1: DEPLOY VIEW */}
        {activeTab === "deploy" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar: Projects Selector */}
            <aside className="w-64 border-r border-slate-800 bg-slate-900/40 p-4 flex flex-col justify-between shrink-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                    Projects ({projects.length})
                  </span>
                  <button
                    onClick={() => {
                      setEditingProject(null);
                      setShowProjectModal(true);
                    }}
                    className="p-1 rounded text-indigo-400 hover:bg-slate-800"
                    title="Add Project"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setActiveProject(p)}
                      className={`w-full text-left p-2.5 rounded-xl border transition ${
                        activeProject?.id === p.id
                          ? "bg-indigo-950/60 border-indigo-500/60 text-white font-semibold shadow-sm"
                          : "border-transparent text-slate-400 hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="truncate">{p.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{p.localPath}</div>
                    </button>
                  ))}

                  {projects.length === 0 && (
                    <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-slate-500 text-[11px]">
                      No projects configured. Click &quot;+&quot; to add.
                    </div>
                  )}
                </div>
              </div>

              {activeProject && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">Controls</span>
                  <button
                    onClick={() => {
                      setEditingProject(activeProject);
                      setShowProjectModal(true);
                    }}
                    className="w-full py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 transition"
                  >
                    <Edit2 className="w-3 h-3 text-indigo-400" /> Edit Recipe
                  </button>
                  <button
                    onClick={handleRollbackPrompt}
                    className="w-full py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 transition"
                  >
                    <ArrowLeftRight className="w-3 h-3" /> Rollback Release
                  </button>
                </div>
              )}
            </aside>

            {/* Central Deploy Cockpit */}
            <div className="flex-1 flex flex-col p-6 space-y-4 overflow-hidden">
              {activeProject ? (
                <>
                  <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-sm">
                    <div>
                      <h2 className="text-base font-bold text-white">{activeProject.name}</h2>
                      <span className="text-slate-400 font-mono text-[11px]">
                        Target: {activeProject.appDir} &middot; Server: {activeProject.serverId}
                      </span>
                    </div>

                    <button
                      onClick={handleStartDeploy}
                      disabled={isDeploying}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition active:scale-95"
                    >
                      {isDeploying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
                      <span>{isDeploying ? "Deploying..." : "Ship to VPS"}</span>
                    </button>
                  </div>

                  {/* Visual Step Tracker */}
                  <div className="grid grid-cols-5 gap-2.5">
                    {[
                      { key: "preflight", label: "1. Preflight" },
                      { key: "build", label: "2. Local Build" },
                      { key: "transfer", label: "3. Tar Stream" },
                      { key: "activate", label: "4. Activation" },
                      { key: "verify", label: "5. Verification" },
                    ].map((st) => {
                      const status = steps[st.key];
                      return (
                        <div
                          key={st.key}
                          className={`p-3 rounded-xl border flex items-center justify-between transition-colors ${
                            status === "success"
                              ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-300"
                              : status === "running"
                              ? "bg-indigo-950/40 border-indigo-500 text-indigo-300 animate-pulse"
                              : status === "failed"
                              ? "bg-rose-950/20 border-rose-500/40 text-rose-300"
                              : "bg-slate-900/60 border-slate-800 text-slate-500"
                          }`}
                        >
                          <span className="font-semibold text-[11px]">{st.label}</span>
                          {status === "success" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          {status === "failed" && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                          {status === "running" && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        </div>
                      );
                    })}
                  </div>

                  {/* Streaming Terminal Window */}
                  <div className="flex-1 bg-black border border-slate-800 rounded-2xl p-4 font-mono text-[11px] overflow-y-auto space-y-1">
                    <div className="text-slate-600 border-b border-slate-900 pb-2 mb-2 flex items-center justify-between">
                      <span>[SKIFF PIPELINE TERMINAL]</span>
                      <span className="text-emerald-500">LIVE FEED</span>
                    </div>
                    {deployLogs.map((log, i) => (
                      <div key={i} className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {log}
                      </div>
                    ))}
                    <div ref={logBottomRef} />
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500">
                  Select a project from the left panel to begin.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: SERVERS MANAGEMENT */}
        {activeTab === "servers" && (
          <div className="flex-1 p-8 max-w-4xl mx-auto overflow-y-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">VPS Connections</h2>
                <p className="text-slate-400">Manage low-end VPS endpoints stored on your machine.</p>
              </div>
              <button
                onClick={() => {
                  setServerForm({
                    id: "",
                    name: "Primary VPS",
                    host: "",
                    port: 22,
                    user: "root",
                    authType: "key",
                    keyPath: "",
                    password: "",
                  });
                  setShowServerModal(true);
                }}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Add Server
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {servers.map((s) => (
                <div key={s.id} className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-indigo-400" />
                      <span className="font-bold text-white text-sm">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                        {s.authType}
                      </span>
                      <button
                        onClick={() => handleDeleteServer(s)}
                        className="p-1 rounded text-slate-500 hover:text-rose-400"
                        title="Delete Server"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="font-mono text-slate-400 text-[11px] space-y-0.5">
                    <div>Host: {s.host}:{s.port}</div>
                    <div>User: {s.user}</div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                    <button
                      onClick={() => handleTestConnection(s)}
                      disabled={testingServerId === s.id}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] flex items-center gap-1.5 transition"
                    >
                      {testingServerId === s.id ? (
                        <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
                      ) : (
                        <Activity className="w-3 h-3 text-emerald-400" />
                      )}
                      <span>{testingServerId === s.id ? "Probing..." : "Test Connection"}</span>
                    </button>

                    <button
                      onClick={() => handleBootstrapPrompt(s)}
                      className="px-2.5 py-1.5 bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-800/60 rounded-lg text-[11px] flex items-center gap-1.5 transition"
                    >
                      <Wrench className="w-3 h-3" />
                      <span>Bootstrap VPS</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: REMOTE LOGS */}
        {activeTab === "logs" && (
          <div className="flex-1 flex flex-col p-6 space-y-3 bg-black">
            <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
              <span className="font-mono text-xs flex items-center gap-2 text-white">
                <Terminal className="w-4 h-4 text-indigo-400" /> Remote journalctl stream
              </span>
              <button
                onClick={() => setRemoteLogs([])}
                className="text-[11px] text-slate-500 hover:text-white"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-[11px] space-y-1 text-slate-300">
              {remoteLogs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
              <div ref={logBottomRef} />
            </div>
          </div>
        )}
      </main>

      {/* SERVER CONFIG MODAL */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form onSubmit={handleSaveServer} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-white text-sm">Configure VPS Endpoint</h3>

            <div>
              <label className="text-slate-400 text-[10px] uppercase font-mono block mb-1">Server Name</label>
              <input
                required
                value={serverForm.name}
                onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-slate-400 text-[10px] uppercase font-mono block mb-1">Host / IP</label>
                <input
                  required
                  placeholder="192.168.1.100"
                  value={serverForm.host}
                  onChange={(e) => setServerForm({ ...serverForm, host: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-slate-400 text-[10px] uppercase font-mono block mb-1">Port</label>
                <input
                  required
                  type="number"
                  value={serverForm.port}
                  onChange={(e) => setServerForm({ ...serverForm, port: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-400 text-[10px] uppercase font-mono block mb-1">Username</label>
              <input
                required
                value={serverForm.user}
                onChange={(e) => setServerForm({ ...serverForm, user: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-slate-400 text-[10px] uppercase font-mono block mb-1">Auth Type</label>
              <select
                value={serverForm.authType}
                onChange={(e) => setServerForm({ ...serverForm, authType: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white outline-none focus:border-indigo-500"
              >
                <option value="key">Private Key</option>
                <option value="password">Password</option>
              </select>
            </div>

            {serverForm.authType === "key" ? (
              <div>
                <label className="text-slate-400 text-[10px] uppercase font-mono block mb-1">Private Key Path</label>
                <input
                  placeholder="~/.ssh/id_rsa or ~/.ssh/id_ed25519"
                  value={serverForm.keyPath}
                  onChange={(e) => setServerForm({ ...serverForm, keyPath: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <div>
                <label className="text-slate-400 text-[10px] uppercase font-mono block mb-1">Password</label>
                <input
                  type="password"
                  value={serverForm.password}
                  onChange={(e) => setServerForm({ ...serverForm, password: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowServerModal(false)}
                className="px-4 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-xs"
              >
                Save Server
              </button>
            </div>
          </form>
        </div>
      )}

      {/* PROJECT RECIPE MODAL */}
      <ProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={handleSaveProject}
        project={editingProject}
        servers={servers}
      />

      {/* TELEMETRY / VPS HEALTH MODAL */}
      <TelemetryModal
        isOpen={showTelemetryModal}
        onClose={() => setShowTelemetryModal(false)}
        server={selectedServerForTele}
        telemetry={telemetry}
      />

      {/* CUSTOM CONFIRMATION MODAL */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        isDestructive={confirmState.isDestructive}
        isLoading={confirmState.isLoading}
      />

      {/* TOAST SYSTEM */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
