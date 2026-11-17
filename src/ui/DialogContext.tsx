import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import AlertModal, { AlertModalType } from "../AlertModal";

export interface AlertOptions {
  type?: AlertModalType;
  title: string;
  message?: React.ReactNode;
  itemName?: string;
  consequence?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  hideCancel?: boolean;
}

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  itemName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "confirm" | "danger" | "warning" | "info";
  consequence?: string;
}

export interface ConfirmDeleteOptions {
  title?: string;
  message?: React.ReactNode;
  itemName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  consequence?: string;
}

export interface DialogContextValue {
  /** Opens an alert dialog (success, error, warning, info) and resolves when acknowledged */
  alert: (options: AlertOptions) => Promise<void>;
  /** Opens a confirmation dialog and resolves true if confirmed, false if cancelled */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Opens a dedicated delete confirmation dialog and resolves true if confirmed, false if cancelled */
  confirmDelete: (options: ConfirmDeleteOptions) => Promise<boolean>;
  /** Quick helper for success alert */
  success: (title: string, message?: React.ReactNode) => Promise<void>;
  /** Quick helper for error alert */
  error: (title: string, message?: React.ReactNode) => Promise<void>;
  /** Quick helper for warning alert */
  warning: (title: string, message?: React.ReactNode) => Promise<void>;
  /** Quick helper for info alert */
  info: (title: string, message?: React.ReactNode) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    // Graceful fallback if invoked outside a DialogProvider
    return {
      alert: async (opts) => {
        window.alert(`${opts.title}\n\n${typeof opts.message === "string" ? opts.message : ""}`);
      },
      confirm: async (opts) => {
        return window.confirm(`${opts.title}\n\n${typeof opts.message === "string" ? opts.message : ""}`);
      },
      confirmDelete: async (opts) => {
        return window.confirm(
          `${opts.title || "Delete Item?"}\n\n${typeof opts.message === "string" ? opts.message : ""}`
        );
      },
      success: async (title, msg) => {
        window.alert(`${title}\n\n${typeof msg === "string" ? msg : ""}`);
      },
      error: async (title, msg) => {
        window.alert(`${title}\n\n${typeof msg === "string" ? msg : ""}`);
      },
      warning: async (title, msg) => {
        window.alert(`${title}\n\n${typeof msg === "string" ? msg : ""}`);
      },
      info: async (title, msg) => {
        window.alert(`${title}\n\n${typeof msg === "string" ? msg : ""}`);
      },
    };
  }
  return ctx;
}

interface ActiveDialogState {
  isOpen: boolean;
  type: AlertModalType;
  title: string;
  message?: React.ReactNode;
  itemName?: string;
  consequence?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  hideCancel?: boolean;
  resolve?: (value: any) => void;
}

export function DialogProvider({
  children,
  isLight,
}: {
  children: React.ReactNode;
  isLight?: boolean;
}) {
  const [dialog, setDialog] = useState<ActiveDialogState>({
    isOpen: false,
    type: "info",
    title: "",
  });

  const alert = useCallback((options: AlertOptions): Promise<void> => {
    return new Promise<void>((resolve) => {
      setDialog({
        isOpen: true,
        type: options.type || "info",
        title: options.title,
        message: options.message,
        itemName: options.itemName,
        consequence: options.consequence,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        hideCancel: options.hideCancel !== undefined ? options.hideCancel : true,
        resolve: () => resolve(),
      });
    });
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        isOpen: true,
        type: options.tone || "confirm",
        title: options.title,
        message: options.message,
        itemName: options.itemName,
        consequence: options.consequence,
        confirmLabel: options.confirmLabel || "Confirm",
        cancelLabel: options.cancelLabel || "Cancel",
        hideCancel: false,
        resolve: (confirmed: boolean) => resolve(confirmed),
      });
    });
  }, []);

  const confirmDelete = useCallback((options: ConfirmDeleteOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        isOpen: true,
        type: "delete",
        title: options.title || "Delete Item?",
        message:
          options.message ||
          "Are you sure you want to delete this item? This action cannot be undone.",
        itemName: options.itemName,
        consequence:
          options.consequence || "This action is permanent and cannot be undone.",
        confirmLabel: options.confirmLabel || "Delete Permanently",
        cancelLabel: options.cancelLabel || "Cancel",
        hideCancel: false,
        resolve: (confirmed: boolean) => resolve(confirmed),
      });
    });
  }, []);

  const success = useCallback(
    (title: string, message?: React.ReactNode) => alert({ type: "success", title, message }),
    [alert]
  );
  const error = useCallback(
    (title: string, message?: React.ReactNode) => alert({ type: "danger", title, message }),
    [alert]
  );
  const warning = useCallback(
    (title: string, message?: React.ReactNode) => alert({ type: "warning", title, message }),
    [alert]
  );
  const info = useCallback(
    (title: string, message?: React.ReactNode) => alert({ type: "info", title, message }),
    [alert]
  );

  // Catch custom global events so non-React files can trigger alerts
  useEffect(() => {
    const handleGlobalAlert = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.title) {
        alert(detail);
      }
    };
    window.addEventListener("leadgenpilot:alert", handleGlobalAlert);
    return () => window.removeEventListener("leadgenpilot:alert", handleGlobalAlert);
  }, [alert]);

  const handleConfirm = () => {
    const res = dialog.resolve;
    setDialog((prev) => ({ ...prev, isOpen: false }));
    if (res) res(true);
  };

  const handleCancel = () => {
    const res = dialog.resolve;
    setDialog((prev) => ({ ...prev, isOpen: false }));
    if (res) res(false);
  };

  const value: DialogContextValue = {
    alert,
    confirm,
    confirmDelete,
    success,
    error,
    warning,
    info,
  };

  return (
    <DialogContext.Provider value={value}>
      {children}
      <AlertModal
        isOpen={dialog.isOpen}
        type={dialog.type}
        title={dialog.title}
        message={dialog.message}
        itemName={dialog.itemName}
        consequence={dialog.consequence}
        confirmLabel={dialog.confirmLabel}
        cancelLabel={dialog.cancelLabel}
        hideCancel={dialog.hideCancel}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        isLight={isLight}
      />
    </DialogContext.Provider>
  );
}

/**
 * Global helper to trigger an alert modal from anywhere, including outside React components.
 */
export function showGlobalAlert(options: AlertOptions): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("leadgenpilot:alert", { detail: options }));
  }
}
