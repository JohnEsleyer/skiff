import { Activity, ArrowDown, ArrowUp, Cpu, HardDrive, Network, X } from "lucide-react";

export default function TelemetryModal({ isOpen, onClose, server, telemetry }) {
  if (!isOpen || !telemetry) return null;

  const ramUsed = telemetry.usedRamMb || 0;
  const ramTotal = telemetry.totalRamMb || 1;
  const ramPercent = telemetry.ramPercent || ((ramUsed / ramTotal) * 100);
  const freeRam = Math.max(0, ramTotal - ramUsed);
  const bwPercent = telemetry.bandwidthPercent || 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>VPS Health &amp; Bandwidth Report</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </h3>
              <p className="text-[10px] font-mono text-slate-400">
                {server?.name} ({server?.host}:{server?.port})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Gauges & Telemetry */}
        <div className="p-5 space-y-4">
          {/* Memory Bar */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Cpu className="w-3.5 h-3.5 text-indigo-400" /> RAM Consumption
              </span>
              <span className="font-mono text-[11px] text-white font-bold">
                {ramUsed}MB / {ramTotal}MB ({ramPercent.toFixed(1)}%)
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  ramPercent > 85 ? "bg-rose-500" : ramPercent > 70 ? "bg-amber-400" : "bg-emerald-400"
                }`}
                style={{ width: `${Math.min(100, ramPercent)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-500 pt-0.5">
              <span>Free: {freeRam} MB available</span>
              <span>Headless state: Clean</span>
            </div>
          </div>

          {/* Bandwidth Consumption Bar */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Network className="w-3.5 h-3.5 text-cyan-400" /> Network Bandwidth
              </span>
              <span className="font-mono text-[11px] text-cyan-300 font-bold">
                {telemetry.bandwidthTotal || "0 B"} Total
              </span>
            </div>

            {telemetry.bandwidthLimitGb > 0 ? (
              <>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      bwPercent > 90 ? "bg-rose-500" : bwPercent > 75 ? "bg-amber-400" : "bg-cyan-400"
                    }`}
                    style={{ width: `${Math.min(100, bwPercent)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-500 pt-0.5">
                  <span>Usage: {bwPercent.toFixed(1)}%</span>
                  <span>Limit: {telemetry.bandwidthLimitGb} GB</span>
                </div>
              </>
            ) : null}

            <div className="flex justify-between text-[11px] font-mono pt-1 text-slate-400 border-t border-slate-900">
              <span className="flex items-center gap-1 text-emerald-400">
                <ArrowDown className="w-3 h-3" /> RX: {telemetry.rxFormatted || "0 B"}
              </span>
              <span className="flex items-center gap-1 text-sky-400">
                <ArrowUp className="w-3 h-3" /> TX: {telemetry.txFormatted || "0 B"}
              </span>
            </div>
          </div>

          {/* Disk Card */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <HardDrive className="w-4 h-4 text-indigo-400" />
              <div>
                <span className="text-xs font-medium text-slate-300 block">Root Filesystem</span>
                <span className="text-[10px] text-slate-500 font-mono">Used: {telemetry.diskUsed || "N/A"}</span>
              </div>
            </div>
            <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
              {telemetry.diskAvail || "Unknown"} Free
            </span>
          </div>

          {/* Uptime and Shell Specs */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 text-[11px] font-mono">
            <span className="text-[10px] uppercase text-slate-500 block mb-1">System Uptime</span>
            <div className="text-slate-300 truncate">{telemetry.uptime || "Online"}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/90 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition"
          >
            Close Diagnostics
          </button>
        </div>
      </div>
    </div>
  );
}
