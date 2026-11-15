import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Bell, X, ArrowRight, EyeOff, CheckCircle2 } from 'lucide-react';
import { loadAttention, type AttentionItem, type Level } from '../../lib/attention';
import { useSettings } from '../../contexts/SettingsContext';
import { cn } from '../../lib/utils';

const KEY = 'minibloxrc_attention_hidden_v1';
const DAY = 24 * 3600 * 1000;
type Hidden = Record<string, { count: number; until: number }>;
const readHidden = (): Hidden => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

const STYLE: Record<Level, { label: string; bar: string; chip: string }> = {
  high: { label: 'Fix now', bar: 'border-red-400', chip: 'bg-red-100 text-red-600' },
  medium: { label: 'Should fix', bar: 'border-sunshine-400', chip: 'bg-sunshine-100 text-sunshine-700' },
  low: { label: 'When you have time', bar: 'border-ink-200', chip: 'bg-ink-100 text-ink-500' },
};

/** Bell with a badge: everything in your records that still needs entering or fixing, with a link to fix it. */
export const AttentionBell: React.FC<{ refreshKey: string; tone?: 'dark' | 'light' }> = ({ refreshKey, tone = 'light' }) => {
  const { currency } = useSettings();
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Hidden>(readHidden);

  const refresh = useCallback(async () => {
    try { setItems(await loadAttention(currency)); } catch { setItems(prev => prev ?? []); }
  }, [currency]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);
  useEffect(() => { const t = setInterval(refresh, 5 * 60 * 1000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  // hidden for 24h - but it comes back sooner if the problem gets bigger
  const visible = useMemo(() => (items || []).filter(i => { const h = hidden[i.key]; return !(h && h.until > Date.now() && i.count <= h.count); }), [items, hidden]);
  const urgent = visible.filter(i => i.level !== 'low');
  const hasHigh = visible.some(i => i.level === 'high');

  const hide = (i: AttentionItem) => {
    const next = { ...hidden, [i.key]: { count: i.count, until: Date.now() + DAY } };
    setHidden(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const showAll = () => { setHidden({}); try { localStorage.removeItem(KEY); } catch { /* ignore */ } };
  const hiddenCount = (items || []).length - visible.length;

  return (
    <>
      <button onClick={() => setOpen(o => !o)} aria-label="Needs attention" className={cn('relative p-2 rounded-full transition', tone === 'dark' ? 'text-white hover:bg-white/10' : 'text-ink-600 hover:bg-ink-100')}>
        <Bell size={22} />
        {urgent.length > 0 && (
          <span className={cn('absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-extrabold text-white flex items-center justify-center', hasHigh ? 'bg-red-500' : 'bg-sunshine-500')}>{urgent.length}</span>
        )}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[85]" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Needs attention"
            className="absolute right-3 top-14 lg:top-16 w-[calc(100vw-1.5rem)] sm:w-[420px] max-h-[80vh] flex flex-col rounded-4xl bg-white border border-ink-100 shadow-soft-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-ink-100">
              <div>
                <p className="font-display font-extrabold text-ink-900">Needs your attention</p>
                <p className="text-[11px] font-semibold text-ink-400">{items === null ? 'Checking your records…' : visible.length ? `${urgent.length} to fix${visible.length > urgent.length ? ` · ${visible.length - urgent.length} for later` : ''}` : 'Everything looks complete'}</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-full hover:bg-ink-100 text-ink-500" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2">
              {items !== null && visible.length === 0 && (
                <div className="py-10 text-center text-ink-500"><CheckCircle2 className="mx-auto text-mint-500 mb-2" size={36} /><p className="font-bold">All caught up!</p><p className="text-xs">No missing data found.</p></div>
              )}
              {visible.map(i => (
                <div key={i.key} className={cn('rounded-2xl border-l-4 bg-ink-50/60 px-3 py-2.5', STYLE[i.level].bar)}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-extrabold text-ink-900">{i.title}</p>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase', STYLE[i.level].chip)}>{STYLE[i.level].label}</span>
                  </div>
                  {i.detail && <p className="text-xs text-ink-500 mt-0.5 break-words">{i.detail}</p>}
                  <div className="flex items-center justify-between mt-1.5">
                    <Link to={i.to} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-xs font-extrabold text-mint-700 hover:underline">{i.action} <ArrowRight size={12} /></Link>
                    <button onClick={() => hide(i)} className="inline-flex items-center gap-1 text-[11px] font-bold text-ink-400 hover:text-ink-700"><EyeOff size={11} /> Hide 24h</button>
                  </div>
                </div>
              ))}
            </div>
            {hiddenCount > 0 && <button onClick={showAll} className="border-t border-ink-100 py-2 text-xs font-bold text-ink-500 hover:text-mint-700">{hiddenCount} hidden — show again</button>}
          </div>
        </div>, document.body)}
    </>
  );
};
