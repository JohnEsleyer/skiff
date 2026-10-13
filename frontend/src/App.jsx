import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Copy,
  Edit2,
  ExternalLink,
  FileKey2,
  Globe,
  Layers,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";

import ToastContainer from "./components/ToastContainer.jsx";
import ConfirmModal from "./components/ConfirmModal.jsx";
import TelemetryModal from "./components/TelemetryModal.jsx";
import ProjectModal from "./components/ProjectModal.jsx";
import BootstrapModal from "./components/BootstrapModal.jsx";
import ResetVPSModal from "./components/ResetVPSModal.jsx";
import DatabaseManageModal from "./components/DatabaseManageModal.jsx";
import DeployDomainSection from "./components/DeployDomainSection.jsx";
import DeployEnvSection from "./components/DeployEnvSection.jsx";
import ServerManageView from "./components/ServerManageView.jsx";
import TerminalView from "./components/TerminalView.jsx";
import CustomSelect from "./components/CustomSelect.jsx";

export default function App() {
  const [activeView, setActiveView] = useState("servers");
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [terminalInitialDir, setTerminalInitialDir] = useState("/");

  // Live Deploy Pipeline
  const [deployLogs, setDeployLogs] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [steps, setSteps] = useState({
    preflight: "idle",
    build: "idle",
    transfer: "idle",
    setup: "idle",
    activate: "idle",
    verify: "idle",
  });

  // Track deployed release state on the target VPS
  const [deploymentStatus, setDeploymentStatus] = useState(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [releasesList, setReleasesList] = useState([]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [deletingReleaseId, setDeletingReleaseId] = useState(null);
  const [activatingReleaseId, setActivatingReleaseId] = useState(null);

  const [deployCockpitTab, setDeployCockpitTab] = useState("domain");
  const [copiedIpUrl, setCopiedIpUrl] = useState(false);

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

  // Full VPS reset console
  const [resetState, setResetState] = useState({
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

      window.runtime.EventsOn("deploy:success", () => {
        setIsDeploying(false);
        addToast("success", "Deployment Complete", "Release active on VPS.");
        refreshAppDeploymentStatus();
      });

      window.runtime.EventsOn("deploy:done", () => {
        setIsDeploying(false);
        refreshAppDeploymentStatus();
      });

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
      window.runtime.EventsOn("reset:log", (line) => {
        setResetState((prev) => ({ ...prev, logs: [...prev.logs, line] }));
      });

      // Resetting VPS removes all deployments both on the host and in local recipes
      window.runtime.EventsOn("reset:status", (status) => {
        setResetState((prev) => ({ ...prev, status }));
        if (status === "success") {
          addToast("success", "VPS Reset Complete", "Server wiped and all deployment recipes cleared.");
          loadData();
          setActiveProject(null);
          setDeploymentStatus(null);
          setReleasesList([]);
        }
      });

      window.runtime.EventsOn("reset:error", (err) => {
        addToast("error", "Reset Failed", err, 6000);
      });
    }

    return () => {
      if (window.runtime) {
        window.runtime.EventsOff("deploy:log");
        window.runtime.EventsOff("deploy:step");
        window.runtime.EventsOff("deploy:success");
        window.runtime.EventsOff("deploy:done");
        window.runtime.EventsOff("deploy:error");
        window.runtime.EventsOff("remote:log");
        window.runtime.EventsOff("bootstrap:log");
        window.runtime.EventsOff("bootstrap:status");
        window.runtime.EventsOff("bootstrap:error");
        window.runtime.EventsOff("reset:log");
        window.runtime.EventsOff("reset:status");
        window.runtime.EventsOff("reset:error");
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

  const refreshAppDeploymentStatus = async (showToast = false) => {
    if (!activeProject || !selectedServer || !window.go?.main?.App?.GetProjectDeploymentStatus) {
      setDeploymentStatus(null);
      setReleasesList([]);
      return;
    }
    setIsRefreshingStatus(true);
    try {
      const res = await window.go.main.App.GetProjectDeploymentStatus(
        selectedServer.id,
        activeProject.appDir,
        activeProject.name
      );
      setDeploymentStatus(res);
      await loadReleasesList();
      if (showToast) {
        addToast("info", "Refreshed", "Live deployment and release status updated.");
      }
    } catch {
      setDeploymentStatus(null);
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  const loadReleasesList = async () => {
    if (!activeProject || !selectedServer || !window.go?.main?.App?.GetAppReleases) return;
    setLoadingReleases(true);
    try {
      const rels = await window.go.main.App.GetAppReleases(selectedServer.id, activeProject.appDir);
      setReleasesList(rels || []);
    } catch {
      setReleasesList([]);
    } finally {
      setLoadingReleases(false);
    }
  };

  useEffect(() => {
    refreshAppDeploymentStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, selectedServer?.id]);

  // Open a URL in the OS browser. Plain anchors cannot escape the Wails
  // webview, so every "open" button routes through the Go backend.
  const openExternal = async (url) => {
    if (!url) return;
    try {
      if (window.go?.main?.App?.OpenURL) {
        await window.go.main.App.OpenURL(url);
        return;
      }
      window.open(url, "_blank", "noopener");
    } catch {
      try {
        window.open(url, "_blank", "noopener");
      } catch {
        //
      }
    }
  };

  // Domain DNS state lifted from DeployDomainSection (it polls every 12s)
  const [domainDnsCheck, setDomainDnsCheck] = useState(null);

  // Live endpoint probes (status + latency per URL)
  const [endpointProbes, setEndpointProbes] = useState({});
  const [probingEndpoints, setProbingEndpoints] = useState(false);

  const probeEndpoints = async (defs, serverId) => {
    if (!defs || defs.length === 0 || !serverId || !window.go?.main?.App?.ProbeEndpoint) return;
    setProbingEndpoints(true);
    try {
      const results = await Promise.all(
        defs.map((d) =>
          window.go.main.App.ProbeEndpoint(serverId, d.name, d.url).catch(() => ({
            name: d.name,
            url: d.url,
            ok: false,
            statusCode: 0,
            latencyMs: 0,
            error: "probe failed",
          }))
        )
      );
      const map = {};
      results.forEach((r) => {
        map[r.url] = r;
      });
      setEndpointProbes(map);
    } finally {
      setProbingEndpoints(false);
    }
  };

  const handleSelectServerCard = (srv) => {
    setSelectedServer(srv);
    setActiveView("manage");
  };

  const handleOpenTerminalWithDir = (dir) => {
    setTerminalInitialDir(dir || "/");
    setActiveView("terminal");
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

  const handleDeleteDeploymentPrompt = (proj) => {
    if (!proj) return;
    setConfirmState({
      isOpen: true,
      title: "Delete Deployment & Remote Files?",
      message: `Permanently delete "${proj.name}"? This stops the app service, removes its Caddy route, wipes "${proj.appDir}" from the VPS, and deletes this recipe.`,
      confirmText: "Delete Deployment",
      isDestructive: true,
      isLoading: false,
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, isLoading: true }));
        try {
          await window.go.main.App.DeleteProjectDeployment(
            selectedServer?.id || proj.serverId,
            proj.id,
            proj.appDir,
            proj.name
          );
          addToast("info", "Deployment Deleted", `${proj.name} removed from VPS and local recipes.`);
          const remaining = projects.filter((p) => p.id !== proj.id);
          setProjects(remaining);
          setActiveProject(remaining.length > 0 ? remaining[0] : null);
          setDeploymentStatus(null);
          setReleasesList([]);
        } catch (err) {
          addToast("error", "Deletion Failed", String(err));
        } finally {
          setConfirmState((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        }
      },
    });
  };

  const handleStartDeploy = async () => {
    if (!activeProject || isDeploying) return;
    setIsDeploying(true);
    setDeployCockpitTab("terminal");
    setDeployLogs([]);
    setSteps({ preflight: "idle", build: "idle", transfer: "idle", setup: "idle", activate: "idle", verify: "idle" });
    addToast("info", "Deploying", `Shipping ${activeProject.name} to ${selectedServer?.name || "VPS"}`);

    try {
      await window.go.main.App.DeployProject(activeProject.id);
    } catch (err) {
      addToast("error", "Deployment Failure", String(err));
      setIsDeploying(false);
    }
  };

  const handleDeleteReleasePrompt = (rel) => {
    if (!activeProject || !selectedServer || rel.isCurrent) return;
    setConfirmState({
      isOpen: true,
      title: "Delete Release Artifact?",
      message: `Permanently remove release "${rel.id}" (${rel.size}) from the VPS? This cannot be undone.`,
      confirmText: "Delete Release",
      isDestructive: true,
      isLoading: false,
      onConfirm: async () => {
        setDeletingReleaseId(rel.id);
        try {
          await window.go.main.App.DeleteAppRelease(selectedServer.id, activeProject.appDir, rel.id);
          addToast("info", "Release Removed", `Deleted ${rel.id}`);
          loadReleasesList();
        } catch (err) {
          addToast("error", "Delete Failed", String(err));
        } finally {
          setDeletingReleaseId(null);
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const handleActivateRelease = async (rel) => {
    if (!activeProject || !selectedServer || rel.isCurrent) return;
    setActivatingReleaseId(rel.id);
    try {
      await window.go.main.App.ActivateAppRelease(
        selectedServer.id,
        activeProject.appDir,
        rel.id,
        activeProject.restartCommand || "true"
      );
      addToast("success", "Release Swapped", `Symlink pointing to release ${rel.id}`);
      refreshAppDeploymentStatus();
    } catch (err) {
      addToast("error", "Switch Failed", String(err));
    } finally {
      setActivatingReleaseId(null);
    }
  };

  const handleBootstrapPrompt = (srv) => {
    setConfirmState({
      isOpen: true,
      title: "Bootstrap Low-End VPS",
      message: `Open the stack provisioner for ${srv.host}? Already-installed components are skipped. Continue?`,
      confirmText: "Open Provisioner",
      isDestructive: false,
      isLoading: false,
      onConfirm: () => {
        setConfirmState((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        handleOpenBootstrap(srv);
      },
    });
  };

  const handleOpenBootstrap = (srv) => {
    setBootstrapState({ isOpen: true, server: srv, logs: [], status: "idle" });
  };

  const handleStartBootstrap = (stackCfg) => {
    const srv = bootstrapState.server;
    if (!srv) return;
    setBootstrapState((prev) => ({ ...prev, logs: [], status: "running" }));
    window.go.main.App.BootstrapVPSWithStack(srv.id, stackCfg).catch((err) => {
      addToast("error", "Execution Failed", String(err));
      setBootstrapState((prev) => ({ ...prev, status: "failed" }));
    });
  };

  const [dbModal, setDbModal] = useState({ isOpen: false, dbType: "surrealdb" });
  const handleOpenDatabaseModal = (dbType) => {
    if (!selectedServer) return;
    setDbModal({ isOpen: true, dbType });
  };

  const handleCancelBootstrap = () => {
    window.go.main.App.CancelBootstrap();
    setBootstrapState((prev) => ({ ...prev, status: "failed" }));
    addToast("warning", "Aborted", "Bootstrap cancelled by user.");
  };

  const handleOpenReset = (srv) => {
    if (!srv) return;
    setResetState({ isOpen: true, server: srv, logs: [], status: "idle" });
  };

  const handleConfirmReset = () => {
    if (!resetState.server) return;
    setResetState((prev) => ({ ...prev, logs: [], status: "running" }));
    window.go.main.App.ResetVPS(resetState.server.id).catch((err) => {
      addToast("error", "Reset Execution Error", String(err));
      setResetState((prev) => ({ ...prev, status: "failed" }));
    });
  };

  const handleStartLogs = () => {
    if (!selectedServer) return;
    setRemoteLogs([]);
    window.go.main.App.StartLogStream(selectedServer.id, "journalctl -u caddy -f -n 60");
  };

  const handleSelectAppFromManage = (appName) => {
    const match = projects.find(
      (p) =>
        (p.appDir || "").split("/").filter(Boolean).pop() === appName ||
        p.name.toLowerCase() === appName.toLowerCase()
    );
    if (match) {
      setActiveProject(match);
    }
    setManageEnvTarget(null);
    setActiveView("deployments");
    setDeployCockpitTab("domain");
  };

  // Jump target for the ".env" shortcut on Manage-VPS app cards when no local
  // recipe matches the remote app (env works off appDir alone).
  const [manageEnvTarget, setManageEnvTarget] = useState(null);

  const handleSelectAppForEnv = (appName) => {
    const match = projects.find(
      (p) =>
        (p.appDir || "").split("/").filter(Boolean).pop() === appName ||
        p.name.toLowerCase() === appName.toLowerCase()
    );
    if (match) {
      setActiveProject(match);
      setManageEnvTarget(null);
    } else {
      setActiveProject(null);
      setManageEnvTarget(appName);
    }
    setActiveView("deployments");
    setDeployCockpitTab("env");
  };

  const envFallbackAppDir = manageEnvTarget ? `/opt/skiff/apps/${manageEnvTarget}` : "";

  const filteredProjects = projects.filter(
    (p) => !selectedServer || p.serverId === selectedServer.id
  );

  const activeAppSlug = activeProject
    ? (activeProject.appDir || "").split("/").filter(Boolean).pop() || activeProject.name
    : "";

  const isReallyDeployed = !!deploymentStatus?.isDeployed;

  // Direct IP Access via Caddy port 80: bypasses local firewall blocks & DNS propagation delay
  const directIpUrl = selectedServer?.host ? `http://${selectedServer.host}` : "";

  // Canonical live URLs for the deployed screen
  const projectDomain = (activeProject?.domain || "").trim();
  const projectTlsMode = activeProject?.tlsMode || "auto";
  const domainLiveUrl = projectDomain
    ? projectTlsMode === "http"
      ? `http://${projectDomain}`
      : `https://${projectDomain}`
    : "";
  const primaryUrl = domainLiveUrl || directIpUrl;
  const healthEndpointUrl =
    (activeProject?.healthUrl || "").trim() ||
    (primaryUrl ? `${primaryUrl.replace(/\/$/, "")}/api/health` : "");

  const endpointDefs = isReallyDeployed
    ? [
        ...(primaryUrl ? [{ name: "Live Site", url: primaryUrl }] : []),
        ...(domainLiveUrl && directIpUrl && domainLiveUrl !== directIpUrl
          ? [{ name: "Direct IP", url: directIpUrl }]
          : []),
        ...(healthEndpointUrl ? [{ name: "Health Check", url: healthEndpointUrl }] : []),
      ]
    : [];

  // Auto-probe endpoints whenever a deployment becomes visible
  useEffect(() => {
    if (deploymentStatus?.isDeployed && selectedServer && endpointDefs.length > 0) {
      probeEndpoints(endpointDefs, selectedServer.id);
    } else {
      setEndpointProbes({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentStatus?.isDeployed, activeProject?.id, selectedServer?.id]);

  const domainDnsChip = (() => {
    if (!projectDomain) return null;
    if (!domainDnsCheck)
      return { text: "DNS checking…", cls: "bg-slate-800 text-slate-400 border-slate-700" };
    if (domainDnsCheck.isPointing)
      return { text: "DNS ● pointing", cls: "bg-emerald-950 text-emerald-300 border-emerald-700/60" };
    if (domainDnsCheck.isCloudflare)
      return { text: "Cloudflare proxied", cls: "bg-amber-950/60 text-amber-300 border-amber-800/60" };
    return { text: "DNS pending", cls: "bg-slate-800 text-slate-400 border-slate-700" };
  })();

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
            onClick={() => selectedServer && setActiveView("terminal")}
            disabled={!selectedServer}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
              activeView === "terminal"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white disabled:opacity-30"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>4. Terminal</span>
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
        {/* VIEW 1: SERVERS SELECTION */}
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
            onOpenTerminal={() => handleOpenTerminalWithDir("/")}
            onOpenTerminalWithDir={handleOpenTerminalWithDir}
            onSelectAppForDeployments={handleSelectAppFromManage}
            onSelectAppForEnv={handleSelectAppForEnv}
            onOpenBootstrap={() => handleBootstrapPrompt(selectedServer)}
            onOpenDatabaseModal={handleOpenDatabaseModal}
            onOpenResetModal={() => handleOpenReset(selectedServer)}
            onProbe={() => handleTestConnection(selectedServer)}
            probing={testingServerId === selectedServer.id}
            addToast={addToast}
          />
        )}

        {/* VIEW 3: REDESIGNED DEPLOYMENTS COCKPIT */}
        {activeView === "deployments" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar Projects */}
            <aside className="w-60 border-r border-slate-800 bg-slate-900/40 p-3.5 flex flex-col justify-between shrink-0 min-h-0">
              <div className="space-y-3 flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">
                    Recipes ({filteredProjects.length})
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
                      onClick={() => {
                        setActiveProject(p);
                        setManageEnvTarget(null);
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition ${
                        activeProject?.id === p.id
                          ? "bg-indigo-950/60 border-indigo-500/60 text-white font-semibold"
                          : "border-transparent text-slate-400 hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="truncate">{p.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{p.appDir}</div>
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
                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
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
                    onClick={() => handleDeleteDeploymentPrompt(activeProject)}
                    className="w-full py-1.5 px-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 transition"
                  >
                    <Trash2 className="w-3 h-3" /> Delete Deployment
                  </button>
                </div>
              )}
            </aside>

            {/* Central Cockpit (scrolls with custom bar when viewport is short) */}
            <div className="flex-1 flex flex-col p-5 space-y-3.5 overflow-y-auto custom-scroll min-h-0 min-w-0">
              {activeProject ? (
                <>
                  {/* Top Bar: Title, Deployed State & Redeploy/Ship Button */}
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-base font-bold text-white truncate">{activeProject.name}</h2>
                        {isDeploying ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-semibold animate-pulse flex items-center gap-1 shrink-0">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Shipping to VPS...
                          </span>
                        ) : isReallyDeployed ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-700/60 font-semibold flex items-center gap-1.5 shrink-0">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span>Deployed &amp; Live</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                            Ready for Initial Deploy
                          </span>
                        )}

                        {/* REFRESH DEPLOYMENT STATUS BUTTON */}
                        <button
                          type="button"
                          onClick={() => refreshAppDeploymentStatus(true)}
                          disabled={isRefreshingStatus || isDeploying}
                          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                          title="Refresh VPS Status & Releases"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingStatus ? "animate-spin text-indigo-400" : ""}`} />
                        </button>
                      </div>

                      <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px] truncate">
                        <span>Dir: {activeProject.appDir}</span>
                        <span>&middot;</span>
                        <span>VPS: {selectedServer?.host}</span>
                        {deploymentStatus?.currentRelease && (
                          <>
                            <span>&middot;</span>
                            <span className="text-emerald-400">Current: {deploymentStatus.currentRelease}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isReallyDeployed ? (
                        <button
                          onClick={handleStartDeploy}
                          disabled={isDeploying}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition active:scale-95"
                        >
                          {isDeploying ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <RotateCw className="w-4 h-4" />
                          )}
                          <span>{isDeploying ? "Redeploying..." : "Redeploy to VPS"}</span>
                        </button>
                      ) : (
                        <button
                          onClick={handleStartDeploy}
                          disabled={isDeploying}
                          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition active:scale-95"
                        >
                          {isDeploying ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4 fill-white" />
                          )}
                          <span>{isDeploying ? "Shipping..." : "Ship to VPS"}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* DEPLOYED LIVE SCREEN (with URLs) / DIRECT IP BAR (pre-deploy) */}
                  {isReallyDeployed ? (
                    <div className="space-y-2.5 shrink-0">
                      {/* LIVE HERO */}
                      <div className="p-4 bg-emerald-950/25 border border-emerald-500/40 rounded-2xl space-y-3 shadow-lg shadow-emerald-950/30">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="relative flex h-3 w-3 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono uppercase text-emerald-400/90 font-bold tracking-wider">
                                Live deployment
                              </div>
                              <div className="font-mono text-sm text-white font-bold truncate select-all">
                                {primaryUrl || "—"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!primaryUrl) return;
                                try {
                                  await navigator.clipboard.writeText(primaryUrl);
                                  setCopiedIpUrl(true);
                                  addToast("info", "Copied", `Copied ${primaryUrl}`);
                                  setTimeout(() => setCopiedIpUrl(false), 2000);
                                } catch {
                                  //
                                }
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium flex items-center gap-1 transition"
                            >
                              {copiedIpUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedIpUrl ? "Copied" : "Copy URL"}</span>
                            </button>
                            {primaryUrl && (
                              <button
                                type="button"
                                onClick={() => openExternal(primaryUrl)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center gap-1 transition shadow-sm"
                              >
                                <span>Open Live Site</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                          <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/60 min-w-0">
                            <div className="text-[9px] font-mono uppercase text-slate-500 font-bold">Service</div>
                            <div className={`font-mono font-bold truncate ${deploymentStatus?.serviceActive ? "text-emerald-300" : "text-amber-300"}`}>
                              {deploymentStatus?.serviceActive ? "● active" : `○ ${deploymentStatus?.serviceStatus || "stopped"}`}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono truncate">{activeAppSlug || activeProject?.name}</div>
                          </div>
                          <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/60 min-w-0">
                            <div className="text-[9px] font-mono uppercase text-slate-500 font-bold">Release</div>
                            <div className="font-mono font-bold text-white truncate">{deploymentStatus?.currentRelease || "—"}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{deploymentStatus?.releasesCount ?? 0} kept</div>
                          </div>
                          <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/60 min-w-0">
                            <div className="text-[9px] font-mono uppercase text-slate-500 font-bold">Domain</div>
                            <div className="font-mono font-bold text-white truncate">{projectDomain || "—"}</div>
                            {domainDnsChip && (
                              <span className={`inline-block mt-0.5 text-[9px] font-mono px-1.5 py-0.2 rounded border ${domainDnsChip.cls}`}>
                                {domainDnsChip.text}
                              </span>
                            )}
                          </div>
                          <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/60 min-w-0">
                            <div className="text-[9px] font-mono uppercase text-slate-500 font-bold">Health</div>
                            {(() => {
                              const hp = healthEndpointUrl ? endpointProbes[healthEndpointUrl] : null;
                              if (!hp)
                                return <div className="font-mono text-slate-500">probing…</div>;
                              if (hp.ok)
                                return <div className="font-mono font-bold text-emerald-300">{hp.statusCode} • {hp.latencyMs}ms</div>;
                              return <div className="font-mono font-bold text-rose-300 truncate" title={hp.error || ""}>{hp.error || `HTTP ${hp.statusCode}`}</div>;
                            })()}
                            <div className="text-[10px] text-slate-500 font-mono truncate">/api/health</div>
                          </div>
                        </div>

                        {domainLiveUrl && directIpUrl && domainLiveUrl !== directIpUrl && (
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800/60">
                            <span className="truncate">
                              Direct IP: <span className="text-slate-200 select-all">{directIpUrl}</span>{" "}
                              <span className="text-slate-500">(no DNS wait)</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => openExternal(directIpUrl)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 transition shrink-0"
                            >
                              <span>Open IP</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <div className="text-[10px] font-mono text-slate-500">
                          💡 Chrome tip: always open the explicit <code className="text-emerald-300">http://</code> link — typing a bare IP gets auto-upgraded to https:// and fails.
                        </div>
                      </div>

                      {/* LIVE ENDPOINTS */}
                      <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5 text-indigo-400" />
                            <h3 className="text-xs font-bold text-white">Live Endpoints</h3>
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                              {endpointDefs.length}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => probeEndpoints(endpointDefs, selectedServer?.id)}
                            disabled={probingEndpoints}
                            className="p-1 rounded text-slate-400 hover:text-white transition"
                            title="Re-probe endpoints"
                          >
                            <RefreshCw className={`w-3 h-3 ${probingEndpoints ? "animate-spin text-indigo-400" : ""}`} />
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {endpointDefs.map((def) => {
                            const p = endpointProbes[def.url];
                            return (
                              <div
                                key={def.url}
                                className="px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                      !p ? "bg-slate-600" : p.ok ? "bg-emerald-400" : "bg-rose-400"
                                    }`}
                                  />
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-bold text-white">{def.name}</div>
                                    <div className="font-mono text-[10px] text-slate-400 truncate select-all">{def.url}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="font-mono text-[10px] text-slate-400">
                                    {!p ? "…" : p.ok ? `${p.statusCode} • ${p.latencyMs}ms` : p.error || `HTTP ${p.statusCode}`}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openExternal(def.url)}
                                    className="p-1 rounded-lg text-slate-500 hover:text-indigo-300 hover:bg-slate-800 transition"
                                    title={`Open ${def.name}`}
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {endpointDefs.length === 0 && (
                            <div className="text-[11px] text-slate-500 font-mono">No endpoints yet.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <Zap className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">
                              Direct IP Access (Port 80 via Caddy)
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-950 text-emerald-400 border border-slate-800">
                              Instant Access — No DNS Wait
                            </span>
                          </div>
                          <span className="font-mono text-xs text-white font-bold truncate block select-all">
                            {directIpUrl || "—"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!directIpUrl) return;
                            try {
                              await navigator.clipboard.writeText(directIpUrl);
                              setCopiedIpUrl(true);
                              addToast("info", "Copied", `Copied ${directIpUrl}`);
                              setTimeout(() => setCopiedIpUrl(false), 2000);
                            } catch {
                              //
                            }
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium flex items-center gap-1 transition"
                        >
                          {copiedIpUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedIpUrl ? "Copied" : "Copy IP URL"}</span>
                        </button>

                      {directIpUrl && (
                        <button
                          type="button"
                          onClick={() => openExternal(directIpUrl)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1 transition shadow-sm"
                        >
                          <span>Open IP URL</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                      </div>
                    </div>

                    {/* Chrome HTTPS-First explanation */}
                    <div className="text-[10px] font-mono text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 flex items-center justify-between">
                      <span>💡 <strong>Tip for Chrome</strong>: Typing bare IPs causes Chrome to try <code className="text-rose-300">https://</code> and fail. Use explicit <code className="text-emerald-300">http://</code> or click <strong>Open IP URL</strong> above.</span>
                    </div>
                  </div>
                  )}

                  {/* 6 STAGES PIPELINE: ALL-GREEN IF REALLY DEPLOYED */}
                  <div className="grid grid-cols-6 gap-2 shrink-0">
                    {[
                      { key: "preflight", label: "1. Preflight" },
                      { key: "build", label: "2. Local Build" },
                      { key: "transfer", label: "3. Tar Stream" },
                      { key: "setup", label: "4. Remote Setup" },
                      { key: "activate", label: "5. Activation" },
                      { key: "verify", label: "6. Verification" },
                    ].map((st) => {
                      const isStepSuccess = isReallyDeployed && !isDeploying ? true : steps[st.key] === "success";
                      const isStepRunning = isDeploying && steps[st.key] === "running";
                      const isStepFailed = isDeploying && steps[st.key] === "failed";

                      return (
                        <div
                          key={st.key}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-1 transition ${
                            isStepSuccess
                              ? "bg-emerald-950/30 border-emerald-500/50 text-emerald-300"
                              : isStepRunning
                              ? "bg-indigo-950/40 border-indigo-500 text-indigo-300 animate-pulse"
                              : isStepFailed
                              ? "bg-rose-950/20 border-rose-500/40 text-rose-300"
                              : "bg-slate-900/60 border-slate-800 text-slate-500"
                          }`}
                        >
                          <span className="font-semibold text-[10px] truncate">{st.label}</span>
                          {isStepSuccess && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                          {isStepFailed && <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                          {isStepRunning && <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />}
                        </div>
                      );
                    })}
                  </div>

                  {/* TWO-COLUMN LAYOUT: RELEASES LIST (LEFT) & DOMAIN/LOGS (RIGHT) */}
                  <div className="flex-none grid grid-cols-1 md:grid-cols-12 gap-3.5 items-start">
                    {/* LEFT COLUMN: RELEASES COLUMN LIST WITH DELETE BUTTON */}
                    <div className="md:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col overflow-hidden min-h-0 min-w-0">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
                        <div className="flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-indigo-400" />
                          <h3 className="text-xs font-bold text-white">Releases on VPS</h3>
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                            {releasesList.length}
                          </span>
                        </div>
                        <button
                          onClick={loadReleasesList}
                          disabled={loadingReleases}
                          className="p-1 rounded text-slate-400 hover:text-white"
                          title="Refresh Releases"
                        >
                          <RefreshCw className={`w-3 h-3 ${loadingReleases ? "animate-spin text-indigo-400" : ""}`} />
                        </button>
                      </div>

                      <div className="flex-1 overflow-y-auto custom-scroll space-y-2 py-3 max-h-[380px]">
                        {releasesList.map((rel) => {
                          const isBusy = deletingReleaseId === rel.id || activatingReleaseId === rel.id;
                          return (
                            <div
                              key={rel.id}
                              className={`p-3 rounded-xl border flex items-center justify-between gap-2 transition ${
                                rel.isCurrent
                                  ? "bg-emerald-950/20 border-emerald-500/60 ring-1 ring-emerald-500/30"
                                  : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                              }`}
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-xs font-bold text-white truncate">
                                    {rel.id}
                                  </span>
                                  {rel.isCurrent && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-700/60 font-bold shrink-0">
                                      CURRENT
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
                                  <span>{rel.size}</span>
                                  <span>&middot;</span>
                                  <span className="truncate">{rel.createdAt || "Synced"}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {!rel.isCurrent && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => handleActivateRelease(rel)}
                                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] font-medium flex items-center gap-1 transition"
                                      title="Switch to this release"
                                    >
                                      <ArrowLeftRight className="w-2.5 h-2.5" />
                                      <span>Rollback</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => handleDeleteReleasePrompt(rel)}
                                      className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition"
                                      title="Delete Release"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {releasesList.length === 0 && !loadingReleases && (
                          <div className="p-6 text-center text-slate-500 text-[11px] font-mono">
                            No release directories created yet.
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500 flex justify-between shrink-0">
                        <span>Retention: keep last {activeProject.keepReleases || 3}</span>
                        <span>Atomic symlink current/</span>
                      </div>
                    </div>

                    {/* RIGHT COLUMN: DOMAIN MANAGEMENT & LOGS TABS */}
                    <div className="md:col-span-7 flex flex-col min-w-0 space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setDeployCockpitTab("domain")}
                            className={`px-3 py-1 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition ${
                              deployCockpitTab === "domain"
                                ? "bg-indigo-600 text-white"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            <Globe className="w-3 h-3" />
                            <span>Domain &amp; SSL Routing</span>
                          </button>
                          <button
                            onClick={() => setDeployCockpitTab("env")}
                            className={`px-3 py-1 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition ${
                              deployCockpitTab === "env"
                                ? "bg-indigo-600 text-white"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            <FileKey2 className="w-3 h-3" />
                            <span>Environment (.env)</span>
                          </button>
                          <button
                            onClick={() => setDeployCockpitTab("terminal")}
                            className={`px-3 py-1 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition ${
                              deployCockpitTab === "terminal"
                                ? "bg-indigo-600 text-white"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            <Terminal className="w-3 h-3" />
                            <span>Live Pipeline Logs</span>
                          </button>
                        </div>
                      </div>

                      {deployCockpitTab === "env" && (
                        <div className="min-w-0">
                          <DeployEnvSection
                            server={selectedServer}
                            appDir={activeProject?.appDir || ""}
                            appName={activeAppSlug}
                            localPath={activeProject?.localPath || ""}
                            addToast={addToast}
                          />
                        </div>
                      )}

                      {deployCockpitTab === "domain" && (
                        <div className="min-w-0">
                          <DeployDomainSection
                            server={selectedServer}
                            project={activeProject}
                            appName={activeAppSlug}
                            onProjectUpdated={(up) => setActiveProject(up)}
                            addToast={addToast}
                            onDnsCheck={setDomainDnsCheck}
                            onOpenUrl={openExternal}
                          />
                        </div>
                      )}

                      {deployCockpitTab === "terminal" && (
                        <div className="bg-black border border-slate-800 rounded-2xl p-3.5 font-mono text-[11px] overflow-y-auto custom-scroll space-y-1 max-h-[420px] min-w-0">
                          <div className="text-slate-600 border-b border-slate-900 pb-2 mb-2 flex items-center justify-between">
                            <span className="text-emerald-500 text-[10px]">[PIPELINE STREAM]</span>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(deployLogs.join("\n"));
                                  addToast("info", "Copied", "Pipeline logs copied to clipboard");
                                } catch {
                                  //
                                }
                              }}
                              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[10px] flex items-center gap-1 transition"
                            >
                              <Copy className="w-3 h-3" /> Copy Logs
                            </button>
                          </div>
                          {deployLogs.map((log, i) => (
                            <div key={i} className="text-slate-300 whitespace-pre-wrap leading-relaxed select-text">
                              {log}
                            </div>
                          ))}
                          <div ref={logBottomRef} />
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : envFallbackAppDir ? (
                <div className="min-w-0">
                  <DeployEnvSection
                    server={selectedServer}
                    appDir={envFallbackAppDir}
                    appName={manageEnvTarget}
                    localPath=""
                    addToast={addToast}
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500">
                  Select a project recipe from the left panel.
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 4: LAG-FREE TERMINAL COMMAND RUNNER */}
        {activeView === "terminal" && selectedServer && (
          <TerminalView
            server={selectedServer}
            initialDir={terminalInitialDir}
            addToast={addToast}
          />
        )}

        {/* VIEW 5: REMOTE LOGS */}
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

      {/* MODALS */}
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

      <ProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={handleSaveProject}
        project={editingProject}
        servers={servers}
        selectedServerId={selectedServer?.id}
      />

      <TelemetryModal
        isOpen={showTelemetryModal}
        onClose={() => setShowTelemetryModal(false)}
        server={selectedServerForTele}
        telemetry={telemetry}
      />

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

      <BootstrapModal
        isOpen={bootstrapState.isOpen}
        onClose={() => setBootstrapState((prev) => ({ ...prev, isOpen: false }))}
        server={bootstrapState.server}
        logs={bootstrapState.logs}
        status={bootstrapState.status}
        onStartBootstrap={handleStartBootstrap}
        onCancel={handleCancelBootstrap}
      />

      <DatabaseManageModal
        isOpen={dbModal.isOpen}
        onClose={() => setDbModal((prev) => ({ ...prev, isOpen: false }))}
        server={selectedServer}
        dbType={dbModal.dbType}
        addToast={addToast}
      />

      <ResetVPSModal
        isOpen={resetState.isOpen}
        onClose={() => setResetState((prev) => ({ ...prev, isOpen: false }))}
        server={resetState.server}
        logs={resetState.logs}
        status={resetState.status}
        onConfirmReset={handleConfirmReset}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
