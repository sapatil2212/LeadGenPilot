import React from "react";
import { X, CheckCircle2, AlertTriangle, Info, HelpCircle, Loader2 } from "lucide-react";

export type AlertModalType = "success" | "confirm" | "danger" | "warning" | "info";

interface AlertModalProps {
  isOpen: boolean;
  type: AlertModalType;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLight: boolean;
  isLoading?: boolean;
}

export default function AlertModal({
  isOpen,
  type,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  isLight,
  isLoading = false
}: AlertModalProps) {
  if (!isOpen) return null;

  // Icon selector based on type
  const renderIcon = () => {
    switch (type) {
      case "success":
        return (
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-4 mx-auto animate-pulse">
            <CheckCircle2 className="h-7 w-7" />
          </div>
        );
      case "danger":
        return (
          <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500 mb-4 mx-auto animate-pulse border border-rose-500/20">
            <AlertTriangle className="h-7 w-7" />
          </div>
        );
      case "warning":
        return (
          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4 mx-auto animate-pulse">
            <AlertTriangle className="h-7 w-7" />
          </div>
        );
      case "confirm":
        return (
          <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500 mb-4 mx-auto border border-indigo-500/20">
            <HelpCircle className="h-7 w-7" />
          </div>
        );
      default:
        return (
          <div className="w-12 h-12 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-500 mb-4 mx-auto">
            <Info className="h-7 w-7" />
          </div>
        );
    }
  };

  // Button style class selector
  const getConfirmButtonClass = () => {
    switch (type) {
      case "danger":
        return "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/10";
      case "warning":
        return "bg-amber-500 hover:bg-amber-400 text-white shadow-lg shadow-amber-500/10";
      case "success":
        return "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/10";
      default:
        return "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/10";
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-all duration-300 animate-fadeIn">
      {/* Container Card */}
      <div 
        className={`w-full max-w-sm rounded-2xl border p-6 relative shadow-2xl transform transition-all duration-300 scale-100 animate-scaleUp ${
          isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
        }`}
      >
        {/* Close absolute button */}
        {!isLoading && (
          <button
            onClick={onCancel}
            className={`absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-slate-250 cursor-pointer transition-colors ${
              isLight ? "hover:bg-slate-100" : "hover:bg-slate-800"
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Header Icon & Title */}
        <div className="text-center">
          {renderIcon()}
          <h3 className={`text-sm font-extrabold tracking-tight mb-2 ${isLight ? "text-slate-900" : "text-white"}`}>
            {title}
          </h3>
          <p className={`text-xs leading-relaxed mb-6 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
            {message}
          </p>
        </div>

        {/* Buttons Action row */}
        <div className="flex gap-3 justify-end text-xs font-bold uppercase">
          {type !== "success" && (
            <button
              onClick={onCancel}
              disabled={isLoading}
              className={`flex-1 py-2.5 px-4 rounded-xl border transition-all cursor-pointer text-center disabled:opacity-40 disabled:cursor-not-allowed ${
                isLight 
                  ? "border-slate-200 text-slate-600 hover:bg-slate-50" 
                  : "border-[#1e293b] text-slate-355 hover:bg-slate-800"
              }`}
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`flex-1 py-2.5 px-4 rounded-xl text-center font-bold tracking-wider transition-all hover:scale-[1.02] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 ${getConfirmButtonClass()}`}
          >
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            <span>{isLoading ? (type === "danger" ? "Deleting..." : "Processing...") : confirmLabel}</span>
          </button>
        </div>

      </div>
    </div>
  );
}
