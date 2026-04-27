import { X } from "lucide-react";
import type { ReactNode } from "react";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmText?: string;
  confirmColor?: "red" | "brand";
  isSubmitting?: boolean;
  children?: ReactNode; // For additional inputs like rejection reason
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  confirmColor = "brand",
  isSubmitting = false,
  children
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const btnClass = confirmColor === "red" 
    ? "bg-rose-600 hover:bg-rose-700 focus:ring-rose-500 text-white" 
    : "bg-brand-600 hover:bg-brand-700 focus:ring-brand-500 text-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600">{message}</p>
          {children}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-200 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className={`px-4 py-2 text-sm font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition disabled:opacity-50 flex items-center gap-2 ${btnClass}`}
          >
            {isSubmitting ? "Processing..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
