import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Clock,
  Command,
  Copy,
  Folder,
  History,
  Play,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";

// Cleanly renders text with ANSI color codes converted to CSS classes
function renderAnsiText(rawText) {
  if (!rawText) return null;

  // Split by ANSI escape sequences \x1b[...m
  const ansiRegex = /\u001b\[([0-9;]*)m/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  let currentClasses = [];

  const codeToClass = {
    "0": "RESET",
    "1": "font-bold",
    "30": "text-slate-500",
    "31": "text-rose-400 font-semibold",
    "32": "text-emerald-400 font-semibold",
    "33": "text-amber-300",
    "34": "text-sky-400",
    "35": "text-purple-400",
    "36": "text-cyan-300",
    "37": "text-slate-100",
    "90": "text-slate-500",
    "91": "text-rose-300",
    "92": "text-emerald-300",
    "93": "text-amber-200",
    "94": "text-sky-300",
    "95": "text-purple-300",
    "96": "text-cyan-200",
    "97": "text-white font-bold",
  };

  while ((match = ansiRegex.exec(rawText)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        text: rawText.substring(lastIndex, match.index),
        classes: [...currentClasses],
      });
    }

    const codes = match[1].split(";");
    for (const code of codes) {
      const cls = codeToClass[code];
      if (cls === "RESET" || code === "" || code === "0") {
        currentClasses = [];
      } else if (cls) {
        currentClasses.push(cls);
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  if (lastIndex < rawText.length) {
    parts.push({
      text: rawText.substring(lastIndex),
      classes: [...currentClasses],
    });
  }

  // Strip remaining non-color escape codes (e.g. cursor motion)
  return parts.map((part, idx) => {
    const clean = part.text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
    return (
      <span key={idx} className={part.classes.join(" ")}>
        {clean}
      </span>
    );
  });
}

const PRESET_COMMANDS = [
  { label: "Uptime & RAM", cmd: "uptime && free -h" },
  { label: "Disk Usage", cmd: "df -h /" },
  { label: "Listening Ports", cmd: "ss -tulpn | grep -E ':(80|443|8000|5432|3306|22)'" },
  { label: "Caddy Status", cmd: "systemctl status caddy --no-pager" },
  { label: "Caddy Logs", cmd: "journalctl -u caddy -n 30 --no-pager" },
  { label: "Skiff Apps", cmd: "ls -la /opt/skiff/apps" },
  { label: "Active Services", cmd: "systemctl list-units --type=service --state=running | head -25" },
  { label: "Top Memory", cmd: "ps aux --sort=-%mem | head -10" },
];

export default function TerminalView({ server, initialDir = "", addToast }) {
  const [command, setCommand] = useState("");
  const [workingDir, setWorkingDir] = useState(initialDir || "/");
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`skiff_cmd_hist_${server?.id}`) || "[]");
    } catch {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState("");

  const [entries, setEntries] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeExecId, setActiveExecId] = useState(null);
  const [copiedKey, setCopiedKey] = useState("");

  const inputRef = useRef(null);
  const terminalEndRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (initialDir) {
      setWorkingDir(initialDir);
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [initialDir]);

  // Live output streaming hook
  useEffect(() => {
    if (!window.runtime) return;

    const unlisten = window.runtime.EventsOn("terminal:stream", (data) => {
      if (!isMountedRef.current || !data?.chunk) return;
      setEntries((prev) =>
        prev.map((item) =>
          item.execId === data.execId
            ? { ...item, output: (item.output || "") + data.chunk }
            : item
        )
      );
    });

    return () => {
      if (window.runtime) {
        window.runtime.EventsOff("terminal:stream");
      }
    };
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const handleRunCommand = async (customCmd) => {
    const rawCmd = (customCmd ?? command).trim();
    if (!rawCmd || isExecuting || !server || !window.go?.main?.App) return;

    // Handle client-side 'clear'
    if (rawCmd === "clear") {
      setEntries([]);
      setCommand("");
      return;
    }

    const execId = `exec-${Date.now()}`;
    const newEntry = {
      id: execId,
      execId,
      command: rawCmd,
      dir: workingDir,
      time: new Date().toLocaleTimeString(),
      output: "",
      exitCode: null,
      durationMs: null,
      status: "running",
    };

    setEntries((prev) => [...prev, newEntry]);
    setIsExecuting(true);
    setActiveExecId(execId);
    setCommand("");
    setHistoryIndex(-1);

    // Persist in command history
    const nextHist = [rawCmd, ...history.filter((h) => h !== rawCmd)].slice(0, 100);
    setHistory(nextHist);
    try {
      localStorage.setItem(`skiff_cmd_hist_${server.id}`, JSON.stringify(nextHist));
    } catch {
      //
    }

    // Auto-sync working directory on 'cd <path>'
    if (rawCmd.startsWith("cd ") && !rawCmd.includes("&&") && !rawCmd.includes(";")) {
      const targetPath = rawCmd.slice(3).trim();
      if (targetPath) {
        const resolved =
          targetPath.startsWith("/")
            ? targetPath
            : `${workingDir.replace(/\/$/, "")}/${targetPath}`;
        setWorkingDir(resolved);
      }
    }

    try {
      const res = await window.go.main.App.ExecuteServerCommand(
        server.id,
        rawCmd,
        workingDir,
        execId
      );

      if (!isMountedRef.current) return;

      setEntries((prev) =>
        prev.map((item) =>
          item.execId === execId
            ? {
                ...item,
                output: res.combined || res.stdout || res.stderr || "(No output returned)",
                exitCode: res.exitCode,
                durationMs: res.durationMs,
                status: "done",
              }
            : item
        )
      );
    } catch (err) {
      if (!isMountedRef.current) return;
      setEntries((prev) =>
        prev.map((item) =>
          item.execId === execId
            ? {
                ...item,
                output: `[Skiff Exec Error] ${String(err)}`,
                exitCode: -1,
                status: "done",
              }
            : item
        )
      );
    } finally {
      if (isMountedRef.current) {
        setIsExecuting(false);
        setActiveExecId(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
  };

  const handleCancelActive = async () => {
    if (!activeExecId || !window.go?.main?.App) return;
    try {
      await window.go.main.App.CancelServerCommand(activeExecId);
      addToast("warning", "Cancelled", "Interrupt signal sent to remote process.");
    } catch {
      //
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRunCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndex === -1) {
        setTempInput(command);
        setHistoryIndex(0);
        setCommand(history[0]);
      } else if (historyIndex < history.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setCommand(history[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setCommand(history[nextIdx]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommand(tempInput);
      }
    } else if (e.key === "c" && e.ctrlKey && isExecuting) {
      e.preventDefault();
      handleCancelActive();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setEntries([]);
    }
  };

  const handleCopyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      addToast("info", "Copied", "Copied to clipboard");
      setTimeout(() => setCopiedKey(""), 2000);
    } catch {
      //
    }
  };

  const promptPrefix = `${server?.user || "root"}@${server?.host || "vps"}:${workingDir}$`;

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden font-sans select-none">
      {/* Top Bar: Server Target, Working Dir & Controls */}
      <div className="p-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
            <Terminal className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-white tracking-tight truncate">
                VPS Command Terminal
              </h3>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-semibold">
                Lag-Free Local Input
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 truncate">
              <span>{server?.user}@{server?.host}:{server?.port}</span>
              <span>&middot;</span>
              <span className="text-slate-500">Zero idle timeouts</span>
            </div>
          </div>
        </div>

        {/* Working Directory Input */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs">
            <Folder className="w-3 h-3 text-indigo-400 shrink-0" />
            <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">Dir:</span>
            <input
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              placeholder="/"
              className="w-28 sm:w-40 bg-transparent font-mono text-[11px] text-white outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setEntries([])}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium flex items-center gap-1 transition"
            title="Clear output history (Ctrl+L)"
          >
            <Trash2 className="w-3 h-3" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* Preset Command Quick-Pills */}
      <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800/80 flex items-center gap-1.5 overflow-x-auto custom-scroll shrink-0">
        <span className="text-[10px] font-mono uppercase text-slate-500 font-bold shrink-0 flex items-center gap-1 mr-1">
          <Zap className="w-3 h-3 text-amber-400" /> Presets:
        </span>
        {PRESET_COMMANDS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              setCommand(item.cmd);
              inputRef.current?.focus();
            }}
            onDoubleClick={() => handleRunCommand(item.cmd)}
            title={`Click to fill, double click to run: ${item.cmd}`}
            className="px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500 text-[10px] font-mono text-slate-300 hover:text-white transition shrink-0 whitespace-nowrap"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Terminal Output Area (Monospace, ANSI formatting preserved) */}
      <div className="flex-1 p-4 overflow-y-auto custom-scroll font-mono text-[11px] space-y-3 bg-black/95 select-text">
        {entries.length === 0 && (
          <div className="p-6 text-center text-slate-500 space-y-2 select-none">
            <div className="flex justify-center">
              <Command className="w-8 h-8 text-slate-700" />
            </div>
            <div className="font-bold text-slate-400 text-xs">
              Skiff Zero-Lag Remote Terminal
            </div>
            <p className="text-[11px] max-w-md mx-auto text-slate-600 leading-relaxed font-sans">
              Type any shell command in the box below and press <kbd className="px-1 py-0.5 bg-slate-900 border border-slate-800 rounded font-mono text-[10px] text-slate-300">Enter</kbd>.
              Typing is 100% client-local with zero keystroke lag and zero SSH idle disconnects.
            </p>
          </div>
        )}

        {entries.map((item) => {
          const isOk = item.exitCode === 0;
          return (
            <div
              key={item.id}
              className="rounded-xl border border-slate-800/80 bg-slate-950/70 overflow-hidden shadow-sm"
            >
              {/* Command Header Line */}
              <div className="px-3 py-1.5 bg-slate-900/80 border-b border-slate-800/80 flex items-center justify-between gap-2 text-[10px]">
                <div className="flex items-center gap-2 min-w-0 font-bold truncate">
                  <span className="text-emerald-400 shrink-0">
                    {server?.user || "root"}@{server?.host}:{item.dir}$
                  </span>
                  <span className="text-white truncate select-all">{item.command}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0 font-mono">
                  {item.durationMs !== null && (
                    <span className="text-slate-400 flex items-center gap-0.5 text-[9px]">
                      <Clock className="w-2.5 h-2.5 text-slate-500" />
                      {item.durationMs < 1000 ? `${item.durationMs}ms` : `${(item.durationMs / 1000).toFixed(2)}s`}
                    </span>
                  )}

                  {item.status === "running" ? (
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-indigo-950 text-indigo-300 border border-indigo-700 animate-pulse font-bold">
                      running…
                    </span>
                  ) : (
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                        isOk
                          ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/60"
                          : "bg-rose-950/80 text-rose-300 border-rose-800/60"
                      }`}
                    >
                      exit {item.exitCode}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => handleRunCommand(item.command)}
                    title="Re-run command"
                    className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-slate-800 transition"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(item.output, item.id)}
                    title="Copy output"
                    className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition"
                  >
                    {copiedKey === item.id ? (
                      <Check className="w-2.5 h-2.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-2.5 h-2.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Output Body */}
              <div className="p-3 text-slate-200 whitespace-pre-wrap leading-relaxed select-text font-mono text-[11px] overflow-x-auto">
                {item.output ? (
                  renderAnsiText(item.output)
                ) : item.status === "running" ? (
                  <span className="text-slate-500 italic">Streaming process output…</span>
                ) : (
                  <span className="text-slate-600 italic">(Completed with no output)</span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={terminalEndRef} />
      </div>

      {/* Lag-Free Bottom Input Bar */}
      <div className="p-3 bg-slate-900 border-t border-slate-800 shrink-0">
        <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 focus-within:border-indigo-500 transition shadow-inner">
          <span className="font-mono text-emerald-400 font-bold text-xs shrink-0 select-none hidden sm:inline">
            {promptPrefix}
          </span>
          <span className="font-mono text-indigo-400 font-bold text-xs shrink-0 select-none sm:hidden">
            $
          </span>

          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command (e.g. systemctl status caddy, df -h, ls -la) & press Enter..."
            autoFocus
            className="flex-1 bg-transparent font-mono text-xs text-white outline-none min-w-0"
          />

          <div className="flex items-center gap-1.5 shrink-0 select-none">
            {isExecuting ? (
              <button
                type="button"
                onClick={handleCancelActive}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-sm animate-pulse"
                title="Cancel running command (Ctrl+C)"
              >
                <Square className="w-3 h-3 fill-white" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!command.trim()}
                onClick={() => handleRunCommand()}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-sm"
              >
                <span>Run</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 px-1">
          <span>
            Press <kbd className="text-slate-400">Enter</kbd> to execute &middot;{" "}
            <kbd className="text-slate-400">&uarr;/&darr;</kbd> for history &middot;{" "}
            <kbd className="text-slate-400">Ctrl+L</kbd> to clear
          </span>
          <span>
            {history.length} saved in history
          </span>
        </div>
      </div>
    </div>
  );
}
