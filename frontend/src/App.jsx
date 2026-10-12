import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  CheckCircle2,
  Edit2,
  Layers,
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
import BootstrapModal from "./components/BootstrapModal.jsx";
import ServerManageView from "./components/ServerManageView.jsx";
import CustomSelect from "./components/CustomSelect.jsx";

export default function App() {
  // Navigation: "servers" (Pick VPS) | "manage" (Manage selected VPS)
  //             | "deployments" (Ship to selected VPS) | "logs"
  const [activeView, setActiveView] = useState("servers");
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);

  // Live Deploy Pipeline
  const [deployLogs, setDeployLogs] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [steps, setSteps] = useState({
    preflight: "idle",
    build: "idle",
    transfer: "idle",
    activate: "idle",
    verify: "idle",
  });

  // Telemetry & Diagnostics
  const [telemetry, setTelemetry] = useState(null);
  const [testingServerId, setTestingServerId] = useState(null);
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [selectedServerForTele, setSelectedServerForTele] = useState(null);

  // Bootstrap console
  const [bootstrapState, setBootstrapState] = useState({
    isOpen: false,
    server: null,
    logs: [],
    status: "idle",
  });

  // Modals
  const [showServerModal, setShowServerModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  // Toasts
  const [toasts, setToasts] = useState([]);
  const addToast = (type, title, message, duration = 4000) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, title, message, duration }]);
  };
  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // Confirmations
  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    isDestructive: false,
    isLoading: false,
    onConfirm: null,
  });

  // Server Form
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

  useEffect(() => {
    loadData();

    if (window.runtime) {
      window.runtime.EventsOn("deploy:log", (msg) => setDeployLogs((prev) => [...prev, msg]));
      window.runtime.EventsOn("deploy:step", (data) =>
        setSteps((prev) => ({ ...prev, [data.step]: data.status }))
      );
      window.runtime.EventsOn("deploy:error", (err) => {
        setDeployLogs((prev) => [...prev, `[ERROR] ${err}`]);
        setIsDeploying(false);
        addToast("error", "Deployment Error", err, 6000);
      });
      window.runtime.EventsOn("remote:log", (line) =>
        setRemoteLogs((prev) => [...prev.slice(-350), line])
      );
      window.runtime.EventsOn("bootstrap:log", (line) => {
        setBootstrapState((prev) => ({ ...prev, logs: [...prev.logs, line] }));
      });
      window.runtime.EventsOn("bootstrap:status", (status) => {
        setBootstrapState((prev) => ({ ...prev, status }));
        if (status === "success") {
          addToast("success", "Provisioning Done", "VPS is ready for deployments.");
        }
      });
      window.runtime.EventsOn("bootstrap:error", (err) => {
        addToast("error", "Bootstrap Failed", err, 6000);
      });
    }

    return () => {
      if (window.runtime) {
        window.runtime.EventsOff("deploy:log");
        window.runtime.EventsOff("deploy:step");
        window.runtime.EventsOff("deploy:error");
        window.runtime.EventsOff("remote:log");
        window.runtime.EventsOff("bootstrap:log");
        window.runtime.EventsOff("bootstrap:status");
        window.runtime.EventsOff("bootstrap:error");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (s && s.length > 0 && !selectedServer) {
        setSelectedServer(s[0]);
      }
      if (p && p.length > 0 && !activeProject) {
        setActiveProject(p[0]);
      }
    } catch (err) {
      addToast("error", "Storage Read Error", String(err));
    }
  };

  const handleSelectServerCard = (srv) => {
    setSelectedServer(srv);
    setActiveView("manage");
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
          if (selectedServer?.id === srv.id) {
            setSelectedServer(null);
            setActiveView("servers");
          }
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
    addToast("info", "Deploying", `Shipping ${activeProject.name} to ${selectedServer?.name || "VPS"}`);

    try {
      await window.go.main.App.DeployProject(activeProject.id);
    } catch (err) {
      addToast("error", "Deployment Failure", String(err));
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
      message: `This will SSH into ${srv.host} and idempotently verify swap, Caddy, SurrealDB, and directories under /opt/skiff. Already-installed components are skipped, never wiped. Continue?`,
      confirmText: "Run Provisioner",
      isDestructive: false,
      isLoading: false,
      onConfirm: () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        handleOpenBootstrap(srv);
      },
    });
  };

  const handleOpenBootstrap = (srv) => {
    setBootstrapState({ isOpen: true, server: srv, logs: [], status: "running" });
    window.go.main.App.BootstrapVPS(srv.id).catch((err) => {
      addToast("error", "Execution Failed", String(err));
      setBootstrapState((prev) => ({ ...prev, status: "failed" }));
    });
  };

  const handleCancelBootstrap = () => {
    window.go.main.App.CancelBootstrap();
    setBootstrapState((prev) => ({ ...prev, status: "failed" }));
    addToast("warning", "Aborted", "Bootstrap cancelled by user.");
  };

  const handleStartLogs = () => {
    if (!selectedServer) return;
    setRemoteLogs([]);
    window.go.main.App.StartLogStream(selectedServer.id, "journalctl -u esper-server -f -n 60");
  };

  // Projects bound to the selected VPS
  const filteredProjects = projects.filter(
    (p) => !selectedServer || p.serverId === selectedServer.id
  );

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200 text-xs font-sans select-none">
      {/* App Header */}
      <header className="h-12 border-b border-slate-800 bg-slate-900/90 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
            <span className="font-bold text-sm text-white tracking-wider font-mono">SKIFF</span>
          </div>

          <span className="text-slate-700">/</span>

          {/* Quick Switch Server Dropdown */}
          <div className="w-48">
            <CustomSelect
              value={selectedServer?.id || ""}
              onChange={(id) => {
                const s = servers.find((item) => item.id === id);
                if (s) {
                  setSelectedServer(s);
                  setActiveView("manage");
                }
              }}
              options={servers.map((s) => ({
                value: s.id,
                label: s.name,
                badge: s.host,
              }))}
              placeholder="Select Target VPS..."
            />
          </div>
        </div>

        {/* Global Navigation */}
        <nav className="flex items-center gap-1">
          <button
            onClick={() => setActiveView("servers")}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeView === "servers" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            1. VPS Servers ({servers.length})
          </button>
          <button
            onClick={() => selectedServer && setActiveView("manage")}
            disabled={!selectedServer}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeView === "manage"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white disabled:opacity-30"
            }`}
          >
            2. Manage VPS
          </button>
          <button
            onClick={() => selectedServer && setActiveView("deployments")}
            disabled={!selectedServer}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeView === "deployments"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white disabled:opacity-30"
            }`}
          >
            3. Deployments
          </button>
          <button
            onClick={() => {
              setActiveView("logs");
              handleStartLogs();
            }}
            disabled={!selectedServer}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeView === "logs"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white disabled:opacity-30"
            }`}
          >
            Remote Logs
          </button>
        </nav>
      </header>

      {/* Main Body */}
      <main className="flex-1 overflow-hidden flex">
        {/* VIEW 1: SERVERS SELECTION (STEP 1) */}
        {activeView === "servers" && (
          <div className="flex-1 p-8 max-w-4xl mx-auto overflow-y-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Select a VPS Server</h2>
                <p className="text-slate-400">Click any server to inspect and manage its running services.</p>
              </div>
              <button
                onClick={() => {
                  setServerForm({
                    id: "",
                    name: "Low-End VPS",
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
              {servers.map((s) => {
                const isCurrent = selectedServer?.id === s.id;
                const probing = testingServerId === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectServerCard(s)}
                    className={`group bg-slate-900 border rounded-2xl p-5 space-y-4 cursor-pointer transition hover:-translate-y-0.5 shadow-sm ${
                      isCurrent
                        ? "border-indigo-500/80 ring-1 ring-indigo-500/40"
                        : "border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Server className="w-4 h-4 text-indigo-400" />
                        <span className="font-bold text-white text-sm">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                          {s.authType}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteServer(s);
                          }}
                          className="p-1 rounded text-slate-600 hover:text-rose-400"
                          title="Delete Server"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="font-mono text-slate-400 text-xs">
                      {s.user}@{s.host}:{s.port}
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                      <span className="text-indigo-400 group-hover:underline text-[11px] font-semibold">
                        Click to Manage VPS &rarr;
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTestConnection(s);
                          }}
                          disabled={probing}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] flex items-center gap-1 transition"
                        >
                          {probing ? (
                            <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
                          ) : (
                            <Activity className="w-3 h-3 text-emerald-400" />
                          )}
                          <span>{probing ? "Probing" : "Probe"}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleBootstrapPrompt(s);
                          }}
                          className="px-2.5 py-1 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 rounded-lg text-[11px] flex items-center gap-1 border border-indigo-800/60"
                        >
                          <Wrench className="w-3 h-3" /> Bootstrap
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {servers.length === 0 && (
                <div className="col-span-2 p-8 rounded-2xl border border-dashed border-slate-800 text-center text-slate-500">
                  No VPS endpoints yet. Click &quot;Add Server&quot; to register your first host.
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: SERVER MANAGEMENT */}
        {activeView === "manage" && selectedServer && (
          <ServerManageView
            server={selectedServer}
            onBack={() => setActiveView("servers")}
            onOpenDeployments={() => setActiveView("deployments")}
            onProbe={() => handleTestConnection(selectedServer)}
            probing={testingServerId === selectedServer.id}
            addToast={addToast}
          />
        )}

        {/* VIEW 3: DEPLOYMENTS COCKPIT (STEP 2) */}
        {activeView === "deployments" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar Projects */}
            <aside className="w-64 border-r border-slate-800 bg-slate-900/40 p-4 flex flex-col justify-between shrink-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                    Recipes on {selectedServer?.name}
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
                  {filteredProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setActiveProject(p)}
                      className={`w-full text-left p-2.5 rounded-xl border transition ${
                        activeProject?.id === p.id
                          ? "bg-indigo-950/60 border-indigo-500/60 text-white font-semibold"
                          : "border-transparent text-slate-400 hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="truncate">{p.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{p.localPath}</div>
                    </button>
                  ))}
                  {filteredProjects.length === 0 && (
                    <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-slate-500 text-[11px]">
                      No projects bound to this VPS. Click &quot;+&quot; to configure one.
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

            {/* Central Terminal Pipeline */}
            <div className="flex-1 flex flex-col p-6 space-y-4 overflow-hidden">
              {activeProject ? (
                <>
                  <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                    <div>
                      <h2 className="text-base font-bold text-white">{activeProject.name}</h2>
                      <span className="text-slate-400 font-mono text-[11px]">
                        Target App: {activeProject.appDir} &middot; VPS: {selectedServer?.name}
                      </span>
                    </div>

                    <button
                      onClick={handleStartDeploy}
                      disabled={isDeploying}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition active:scale-95"
                    >
                      {isDeploying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
                      <span>{isDeploying ? "Shipping..." : "Ship to VPS"}</span>
                    </button>
                  </div>

                  {/* Step Tracker */}
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
                          className={`p-3 rounded-xl border flex items-center justify-between ${
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

                  {/* Terminal Feed */}
                  <div className="flex-1 bg-black border border-slate-800 rounded-2xl p-4 font-mono text-[11px] overflow-y-auto space-y-1">
                    <div className="text-slate-600 border-b border-slate-900 pb-2 mb-2 flex items-center justify-between">
                      <span>[SKIFF PIPELINE TERMINAL]</span>
                      <span className="text-emerald-500">READY</span>
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
                  Select a project recipe from the left panel.
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 4: REMOTE LOGS */}
        {activeView === "logs" && (
          <div className="flex-1 flex flex-col p-6 space-y-3 bg-black">
            <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
              <span className="font-mono text-xs flex items-center gap-2 text-white">
                <Terminal className="w-4 h-4 text-indigo-400" /> Remote journalctl stream
                <span className="text-slate-500">— {selectedServer?.name}</span>
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
              <CustomSelect
                value={serverForm.authType}
                onChange={(val) => setServerForm({ ...serverForm, authType: val })}
                options={[
                  { value: "key", label: "Private Key" },
                  { value: "password", label: "Password" },
                ]}
              />
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
        selectedServerId={selectedServer?.id}
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

      {/* REAL-TIME BOOTSTRAP TERMINAL MODAL */}
      <BootstrapModal
        isOpen={bootstrapState.isOpen}
        onClose={() => setBootstrapState((prev) => ({ ...prev, isOpen: false }))}
        server={bootstrapState.server}
        logs={bootstrapState.logs}
        status={bootstrapState.status}
        onCancel={handleCancelBootstrap}
      />

      {/* TOAST SYSTEM */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
