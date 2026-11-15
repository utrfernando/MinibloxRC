import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, wide }) => {
  const box = useRef<HTMLDivElement>(null);
  // callers often pass a fresh onClose on every render; keep it in a ref so typing never re-runs the focus logic
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // move focus into the dialog, keep Tab inside it, and give focus back when it closes
    // (on phones focus the dialog itself so the keyboard does not pop up by surprise)
    const hasMouse = window.matchMedia?.('(pointer: fine)').matches;
    const first = (hasMouse && box.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]), select, textarea')) || box.current;
    first?.focus({ preventScroll: true });
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', fn);
    return () => { window.removeEventListener('keydown', fn); previous?.focus?.({ preventScroll: true }); };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={cn('relative w-full bg-white rounded-t-4xl sm:rounded-4xl shadow-soft-lg max-h-[92vh] overflow-y-auto animate-slide-up focus:outline-none', wide ? 'sm:max-w-4xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 bg-white/95 backdrop-blur px-6 py-4 border-b border-ink-100 flex items-center justify-between z-10 rounded-t-4xl">
          <h3 className="font-display text-xl font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-full hover:bg-ink-100 text-ink-500"><X size={20} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};
