import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Globe,
  HardDrive,
  Layers,
  RefreshCw,
} from "lucide-react";

export default function ServerManageView({
  server,
  onBack,
  onOpenDeployments,
  onProbe,
  probing = false,
  addToast,
}) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState("");

  const refreshOverview = async () => {
    if (!window.go?.main?.App || !server) return;
    setLoading(true);
    try {
      const res = await window.go.main.App.GetServerOverview(server.id);
      setOverview(res);
    } catch (err) {
      addToast("error", "Server Query Failed", String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id]);

  const handleControlService = async (serviceName, action) => {
    setActionInProgress(`${serviceName}-${action}`);
    try {
      await window.go.main.App.ControlServerService(server.id, serviceName, action);
      addToast("success", "Service Controlled", `${serviceName} ${action} command sent.`);
      await refreshOverview();
    } catch (err) {
      addToast("error", "Action Failed", String(err));
    } finally {
      setActionInProgress("");
    }
  };

  const tele = overview?.telemetry;
  const ramUsed = tele?.usedRamMb || 0;
  const ramTotal = tele?.totalRamMb || 1;
  const ramPercent = tele?.ramPercent || ((ramUsed / ramTotal) * 100);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6 max-w-5xl mx-auto w-full">
      {/* Top Banner Navigation */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">{server.name}</h2>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-bold">
                Online
              </span>
            </div>
            <span className="text-slate-400 font-mono text-xs">
              {server.user}@{server.host}:{server.port}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onProbe}
            disabled={probing}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs flex items-center gap-1.5 transition"
          >
            <Activity className={`w-3.5 h-3.5 text-emerald-400 ${probing ? "animate-pulse" : ""}`} />
            <span>{probing ? "Probing..." : "Diagnostics"}</span>
          </button>
          <button
            onClick={refreshOverview}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={onOpenDeployments}
            className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Deployments View &rarr;</span>
          </button>
        </div>
      </div>

      {/* Live System Telemetry Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* RAM Usage */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-400 font-medium">
              <Cpu className="w-4 h-4 text-indigo-400" /> RAM Consumption
            </span>
            <span className="font-mono text-white font-bold">{ramPercent.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                ramPercent > 85 ? "bg-rose-500" : ramPercent > 70 ? "bg-amber-400" : "bg-emerald-400"
              }`}
              style={{ width: `${Math.min(100, ramPercent)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-slate-500 pt-1">
            <span>Used: {ramUsed} MB</span>
            <span>Total: {ramTotal} MB</span>
          </div>
        </div>

        {/* Disk Usage */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-400 font-medium">
              <HardDrive className="w-4 h-4 text-indigo-400" /> Root Disk Free
            </span>
            <span className="font-mono text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
              {tele?.diskAvail || "N/A"}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-2">
            Used on root filesystem: {tele?.diskUsed || "Unknown"}
          </div>
        </div>

        {/* Uptime */}
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-medium block">VPS System Uptime</span>
          <div className="text-xs font-mono text-white truncate py-1">
            {tele?.uptime || "Loading..."}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">Headless Zero-Agent Daemonless</div>
        </div>
      </div>

      {/* Background Services Control Board */}
      <div className="space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
          Managed Production Services
        </h3>
        {(overview?.services?.length > 0 || loading) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(overview?.services || []).map((svc) => {
              const busy = actionInProgress === `${svc.name}-restart`;
              return (
                <div
                  key={svc.name}
                  className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-indigo-400">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white capitalize">{svc.name}</h4>
                      <div className="flex items-center gap-1.5 text-[11px] font-mono">
                        <span
                          className={`w-2 h-2 rounded-full ${svc.active ? "bg-emerald-400" : "bg-rose-400"}`}
                        />
                        <span className="text-slate-400">{svc.status}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleControlService(svc.name, "restart")}
                    disabled={busy}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-[11px] font-medium transition flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
                    <span>Restart</span>
                  </button>
                </div>
              );
            })}
            {loading && !overview && (
              <div className="col-span-2 text-slate-500 text-xs py-4 text-center animate-pulse">
                Querying VPS services over SSH...
              </div>
            )}
          </div>
        )}
        {!loading && (!overview?.services || overview.services.length === 0) && (
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-500 text-xs text-center">
            No systemd services reported. The VPS may need bootstrapping first.
          </div>
        )}
      </div>

      {/* Deployed Apps on this VPS */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
            Applications Present in /opt/skiff/apps
          </h3>
          <span className="text-[10px] font-mono text-indigo-400">
            {overview?.deployedApps?.length || 0} active deployments
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(overview?.deployedApps || []).map((app) => (
            <div
              key={app}
              className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-white flex items-center gap-2"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">{app}</span>
            </div>
          ))}
          {(!overview?.deployedApps || overview.deployedApps.length === 0) && !loading && (
            <div className="col-span-3 text-slate-500 text-xs py-4 text-center">
              No apps deployed on this VPS yet. Click &quot;Deployments View&quot; to ship your first project.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
