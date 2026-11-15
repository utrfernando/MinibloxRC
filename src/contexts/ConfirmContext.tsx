import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui/Button';

type Options = { title?: string; message: React.ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Ask = (o: Options | string) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** Use instead of window.confirm: `if (!(await ask({ message: '…', danger: true }))) return;` */
export const useConfirm = (): Ask => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((o) => new Promise<boolean>(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOpts(typeof o === 'string' ? { message: o } : o);
  }), []);

  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); };

  useEffect(() => {
    if (!opts) return;
    const prev = document.activeElement as HTMLElement | null;
    okRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); prev?.focus?.(); };
  }, [opts]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {opts && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4" role="alertdialog" aria-modal="true" aria-label={opts.title || 'Please confirm'}>
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => close(false)} />
          <div className="relative w-full sm:max-w-sm rounded-t-4xl sm:rounded-4xl bg-white p-6 shadow-soft-lg">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${opts.danger ? 'bg-red-100 text-red-500' : 'bg-mint-100 text-mint-600'}`}><AlertTriangle size={20} /></div>
              <div>
                <h3 className="font-display text-lg font-extrabold text-ink-900">{opts.title || (opts.danger ? 'Are you sure?' : 'Please confirm')}</h3>
                <div className="mt-1 text-sm text-ink-600">{opts.message}</div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>{opts.cancelLabel || 'Cancel'}</Button>
              <button ref={okRef} onClick={() => close(true)} className={`rounded-full px-5 py-2.5 text-sm font-extrabold text-white focus:outline-none focus-visible:ring-4 ${opts.danger ? 'bg-red-500 hover:bg-red-600 focus-visible:ring-red-200' : 'bg-mint-500 hover:bg-mint-600 focus-visible:ring-mint-200'}`}>{opts.confirmLabel || (opts.danger ? 'Delete' : 'Yes, continue')}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};
