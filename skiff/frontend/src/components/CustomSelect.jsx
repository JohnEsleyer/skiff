import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export default function CustomSelect({
  value,
  onChange,
  options = [], // [{ value: string, label: string, badge?: string, icon?: ReactNode }]
  placeholder = "Select an option...",
  className = "",
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const selectedOption = options.find((o) => o.value === value) || null;

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("pointerdown", handleOutsideClick);
    }
    return () => document.removeEventListener("pointerdown", handleOutsideClick);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full bg-slate-950 border text-xs rounded-xl px-3 py-2 flex items-center justify-between gap-2 transition outline-none ${
          disabled
            ? "opacity-50 cursor-not-allowed border-slate-800"
            : isOpen
            ? "border-indigo-500 shadow-sm shadow-indigo-500/20"
            : "border-slate-800 hover:border-slate-700"
        }`}
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span className={`truncate ${selectedOption ? "text-white" : "text-slate-500"}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 truncate">
              {selectedOption.badge}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
            isOpen ? "rotate-180 text-indigo-400" : ""
          }`}
        />
      </button>

      {/* Dropdown Options Popup */}
      {isOpen && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden py-1 max-h-56 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-500 text-center">No options available</div>
          ) : (
            options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition ${
                    isSelected
                      ? "bg-indigo-600/20 text-indigo-300 font-semibold"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate min-w-0">
                    {option.icon && <span className="shrink-0">{option.icon}</span>}
                    <span className="truncate">{option.label}</span>
                    {option.badge && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800 truncate">
                        {option.badge}
                      </span>
                    )}
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
