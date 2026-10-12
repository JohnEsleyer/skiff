import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export function ToastItem({ toast, onDismiss }) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (toast.duration === 0) return;
    const interval = 25;
    const step = (interval / toast.duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) {
          clearInterval(timer);
          onDismiss(toast.id);
          return 0;
        }
        return prev - step;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [toast, onDismiss]);

  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
    error: <XCircle className="w-4 h-4 text-rose-400 shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
    info: <Info className="w-4 h-4 text-indigo-400 shrink-0" />,
  };

  const borders = {
    success: "border-emerald-500/40 bg-slate-900/95 shadow-emerald-950/20",
    error: "border-rose-500/40 bg-slate-900/95 shadow-rose-950/20",
    warning: "border-amber-500/40 bg-slate-900/95 shadow-amber-950/20",
    info: "border-indigo-500/40 bg-slate-900/95 shadow-indigo-950/20",
  };

  const progressColors = {
    success: "bg-emerald-500",
    error: "bg-rose-500",
    warning: "bg-amber-500",
    info: "bg-indigo-500",
  };

  return (
    <div
      role="alert"
      className={`relative w-80 overflow-hidden rounded-xl border p-3 shadow-xl backdrop-blur-md transition-all duration-200 ${borders[toast.type]}`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="mt-0.5">{icons[toast.type]}</div>
        <div className="flex-1 min-w-0">
          {toast.title && (
            <h4 className="text-xs font-bold text-white tracking-tight">{toast.title}</h4>
          )}
          <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed break-words font-mono">
            {toast.message}
          </p>
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {toast.duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-800">
          <div
            className={`h-full transition-all duration-75 ease-linear ${progressColors[toast.type]}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-auto">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
