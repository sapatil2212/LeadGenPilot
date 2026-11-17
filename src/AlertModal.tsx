import React, { useEffect } from "react";
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  HelpCircle,
  Loader2,
  Trash2,
  AlertOctagon,
} from "lucide-react";
import { ModalPortal } from "./ui/primitives";

export type AlertModalType =
  | "success"
  | "confirm"
  | "danger"
  | "warning"
  | "info"
  | "delete"
  | "error";

export interface AlertModalProps {
  isOpen: boolean;
  type?: AlertModalType;
  title: string;
  message?: React.ReactNode;
  /** Highlighted entity name (e.g., list name, contact key, campaign name) */
  itemName?: string;
  /** Explanatory subtext or permanence warning */
  consequence?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  isLight?: boolean;
  isLoading?: boolean;
  hideCancel?: boolean;
  children?: React.ReactNode;
}

export default function AlertModal({
  isOpen,
  type = "info",
  title,
  message,
  itemName,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  isLight,
  isLoading = false,
  hideCancel,
  children,
}: AlertModalProps) {
  const light =
    isLight !== undefined
      ? isLight
      : typeof document !== "undefined"
      ? document.documentElement.getAttribute("data-theme") !== "dark"
      : false;

  // Handle ESC and Enter key events for smooth accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading && onCancel) {
        e.preventDefault();
        onCancel();
      } else if (
        e.key === "Enter" &&
        !isLoading &&
        onConfirm &&
        e.target instanceof HTMLElement &&
        e.target.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onCancel, onConfirm]);

  if (!isOpen) return null;

  const isDelete = type === "delete";
  const isDanger = type === "danger" || type === "error" || isDelete;
  const isSuccess = type === "success";
  const isWarning = type === "warning";
  const isConfirm = type === "confirm";

  // Default labels if not explicitly supplied
  const effectiveConfirmLabel =
    confirmLabel ||
    (isDelete ? "Delete" : isDanger ? "Continue" : isSuccess ? "Got it" : isConfirm ? "Confirm" : "OK");

  // Pure alerts hide cancel unless explicitly set or on confirm/delete/danger actions
  const shouldShowCancel =
    hideCancel === undefined
      ? (isConfirm || isDelete || (isDanger && Boolean(onCancel && onConfirm)))
      : !hideCancel;

  // Icon badge renderer
  const renderIcon = () => {
    if (isDelete) {
      return (
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-4 mx-auto shadow-sm shadow-rose-500/10">
          <Trash2 className="h-6 w-6 stroke-[2.2]" />
        </div>
      );
    }
    if (isDanger) {
      return (
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-4 mx-auto shadow-sm shadow-rose-500/10">
          <AlertOctagon className="h-6 w-6 stroke-[2.2]" />
        </div>
      );
    }
    if (isWarning) {
      return (
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-4 mx-auto shadow-sm shadow-amber-500/10">
          <AlertTriangle className="h-6 w-6 stroke-[2.2]" />
        </div>
      );
    }
    if (isSuccess) {
      return (
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-4 mx-auto shadow-sm shadow-emerald-500/10">
          <CheckCircle2 className="h-6 w-6 stroke-[2.2]" />
        </div>
      );
    }
    if (isConfirm) {
      return (
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 mb-4 mx-auto shadow-sm shadow-indigo-500/10">
          <HelpCircle className="h-6 w-6 stroke-[2.2]" />
        </div>
      );
    }
    return (
      <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500 mb-4 mx-auto shadow-sm shadow-sky-500/10">
        <Info className="h-6 w-6 stroke-[2.2]" />
      </div>
    );
  };

  // Button style class selector
  const getConfirmButtonClass = () => {
    if (isDanger) {
      return "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 focus:ring-rose-500";
    }
    if (isWarning) {
      return "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 focus:ring-amber-500";
    }
    if (isSuccess) {
      return "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 focus:ring-emerald-500";
    }
    return "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 focus:ring-indigo-500";
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading && onCancel) {
      onCancel();
    }
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm transition-all duration-200 animate-fadeIn"
        onClick={handleBackdropClick}
      >
        {/* Container Card */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`w-full max-w-sm rounded-2xl border p-6 relative shadow-2xl transition-all duration-200 scale-100 ${
            light
              ? "bg-white border-slate-200 text-slate-800 shadow-slate-900/15"
              : "bg-[#090d16] border-[#1e293b] text-slate-100 shadow-black/60"
          }`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-modal-title"
        >
          {/* Close absolute button */}
          {!isLoading && onCancel && (
            <button
              onClick={onCancel}
              className={`absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer transition-colors ${
                light ? "hover:bg-slate-100" : "hover:bg-slate-800"
              }`}
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/* Header Icon & Title */}
          <div className="text-center">
            {renderIcon()}
            <h3
              id="alert-modal-title"
              className={`text-base font-bold tracking-tight mb-2 ${
                light ? "text-slate-900" : "text-white"
              }`}
            >
              {title}
            </h3>

            {/* Optional Highlighted Entity Tag */}
            {itemName && (
              <div
                className={`my-2.5 px-3 py-1.5 rounded-lg border font-mono text-xs font-semibold truncate ${
                  light
                    ? "bg-slate-50 border-slate-200 text-slate-800"
                    : "bg-slate-900/80 border-slate-800 text-slate-200"
                }`}
                title={itemName}
              >
                {itemName}
              </div>
            )}

            {/* Message Body */}
            {message && (
              <div
                className={`text-xs leading-relaxed mb-4 ${
                  light ? "text-slate-600" : "text-slate-300"
                }`}
              >
                {message}
              </div>
            )}

            {/* Warning / Consequence Callout */}
            {(consequence || isDelete) && (
              <div
                className={`mb-4 px-3 py-2 rounded-xl text-[11px] leading-relaxed flex items-center gap-2 text-left ${
                  isDelete || isDanger
                    ? light
                      ? "bg-rose-50 border border-rose-200 text-rose-800"
                      : "bg-rose-950/30 border border-rose-900/50 text-rose-300"
                    : light
                    ? "bg-amber-50 border border-amber-200 text-amber-800"
                    : "bg-amber-950/30 border border-amber-900/50 text-amber-300"
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{consequence || "This action is permanent and cannot be undone."}</span>
              </div>
            )}

            {children}
          </div>

          {/* Buttons Action row */}
          <div className="flex gap-2.5 justify-end text-xs font-semibold mt-2">
            {shouldShowCancel && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className={`flex-1 py-2.5 px-4 rounded-xl border transition-all cursor-pointer text-center disabled:opacity-40 disabled:cursor-not-allowed ${
                  light
                    ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                    : "border-slate-700/80 bg-slate-800/50 text-slate-200 hover:bg-slate-800 hover:border-slate-600"
                }`}
              >
                {cancelLabel}
              </button>
            )}
            {onConfirm && (
              <button
                type="button"
                onClick={onConfirm}
                disabled={isLoading}
                className={`flex-1 py-2.5 px-4 rounded-xl text-center font-semibold transition-all hover:brightness-110 active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  light ? "focus:ring-offset-white" : "focus:ring-offset-slate-900"
                } ${getConfirmButtonClass()}`}
              >
                {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                <span>
                  {isLoading
                    ? isDelete
                      ? "Deleting…"
                      : "Processing…"
                    : effectiveConfirmLabel}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * Dedicated shorthand modal specifically tailored for confirming deletions.
 */
export function ConfirmDeleteModal({
  isOpen,
  title = "Delete Item?",
  message = "Are you sure you want to delete this item? This action cannot be undone.",
  itemName,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  isLight,
  isLoading,
  consequence = "This action is permanent and cannot be undone.",
}: Omit<AlertModalProps, "type"> & { title?: string }) {
  return (
    <AlertModal
      isOpen={isOpen}
      type="delete"
      title={title}
      message={message}
      itemName={itemName}
      consequence={consequence}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
      isLight={isLight}
      isLoading={isLoading}
    />
  );
}
