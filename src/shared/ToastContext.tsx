import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 5000);
  }, [removeToast]);

  const success = useCallback((msg: string) => toast(msg, 'success'), [toast]);
  const error = useCallback((msg: string) => toast(msg, 'error'), [toast]);
  const info = useCallback((msg: string) => toast(msg, 'info'), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg transition-all animate-in slide-in-from-right-8 ${
              t.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
              t.type === 'error' ? 'bg-rose-50 text-rose-800 border border-rose-200' :
              'bg-blue-50 text-blue-800 border border-blue-200'
            }`}
          >
            {t.type === 'success' && <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />}
            {t.type === 'error' && <XCircle className="h-5 w-5 text-rose-500 shrink-0" />}
            {t.type === 'info' && <Info className="h-5 w-5 text-blue-500 shrink-0" />}
            
            <p className="text-sm font-medium pr-4">{t.message}</p>
            
            <button onClick={() => removeToast(t.id)} className="ml-auto opacity-70 hover:opacity-100 transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) throw new Error('useToast must be used within a ToastProvider');
  return context;
}
