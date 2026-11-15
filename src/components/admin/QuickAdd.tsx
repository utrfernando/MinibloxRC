import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ShoppingBag, Receipt, Landmark, Package, Truck } from 'lucide-react';

const ITEMS = [
  { to: '/admin/inventory/purchases?new=purchase', label: 'Record purchase', hint: 'Stock arrived from a supplier', icon: ShoppingBag },
  { to: '/admin/finance/expenses?new=expense', label: 'Add expense', hint: 'Ads, fees, rent, packaging…', icon: Receipt },
  { to: '/admin/finance/partners?new=entry', label: 'Deposit / withdrawal', hint: 'Money into or out of the fund', icon: Landmark },
  { to: '/admin/products/new', label: 'Add product', hint: 'A new item for the shop', icon: Package },
  { to: '/admin/suppliers/new', label: 'Add supplier', hint: 'A new seller or factory', icon: Truck },
];

/** "+ New" menu: the five things you add most often, one click away from any admin page. */
export const QuickAdd: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full bg-mint-500 px-4 py-2 text-sm font-extrabold text-white shadow-soft hover:bg-mint-600 active:scale-95 transition">
        <Plus size={16} /> {compact ? 'New' : 'New'}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-[85] mt-2 w-72 overflow-hidden rounded-3xl border border-ink-100 bg-white p-1.5 shadow-soft-lg">
          {ITEMS.map(i => (
            <Link key={i.to} to={i.to} role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-mint-50 focus:bg-mint-50 focus:outline-none">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mint-100 text-mint-600"><i.icon size={17} /></span>
              <span><span className="block text-sm font-extrabold text-ink-900">{i.label}</span><span className="block text-xs font-semibold text-ink-400">{i.hint}</span></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
