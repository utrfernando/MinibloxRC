import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input, Select } from '../ui/Input';

export type ColourRow = { key: string; id?: string; name: string; color_hex: string; stock_quantity: string; image_url: string };

export const newColourRow = (): ColourRow => ({ key: Math.random().toString(36).slice(2), name: '', color_hex: '#14b8a6', stock_quantity: '0', image_url: '' });

/** "Colours & stock" box on the product form: one row per colour with its own quantity. */
export const ColoursEditor: React.FC<{ rows: ColourRow[]; onChange: (r: ColourRow[]) => void; imageUrls: string[] }> = ({ rows, onChange, imageUrls }) => {
  const set = (key: string, patch: Partial<ColourRow>) => onChange(rows.map(r => r.key === key ? { ...r, ...patch } : r));
  const total = rows.reduce((s, r) => s + (parseInt(r.stock_quantity, 10) || 0), 0);
  return (
    <div className="rounded-3xl border-2 border-dashed border-mint-200 bg-white p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <p className="text-xs font-extrabold uppercase tracking-wide text-mint-700">Colours &amp; stock</p>
        {rows.length > 0 && <p className="text-sm font-extrabold text-ink-900">Total in stock: {total}</p>}
      </div>
      <p className="text-xs text-ink-500 mb-3">
        {rows.length === 0
          ? 'Does this product come in different colours? Add each colour with how many you have. Leave empty if it has just one version — then use Stock Quantity above.'
          : 'Customers pick a colour before adding to cart. The total stock above is worked out from these.'}
      </p>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.key} className="grid grid-cols-[auto_1fr_5.5rem_auto] sm:grid-cols-[auto_1fr_6rem_9rem_auto] items-center gap-2">
            <input type="color" value={r.color_hex || '#cccccc'} onChange={e => set(r.key, { color_hex: e.target.value })} aria-label="Swatch colour" className="h-10 w-10 rounded-full border border-ink-200 bg-white p-0.5 cursor-pointer" />
            <Input value={r.name} onChange={e => set(r.key, { name: e.target.value })} placeholder="Colour name, e.g. Red" aria-label="Colour name" />
            <Input type="number" min={0} value={r.stock_quantity} onChange={e => set(r.key, { stock_quantity: e.target.value })} placeholder="Qty" aria-label="Quantity" />
            <Select value={r.image_url} onChange={e => set(r.key, { image_url: e.target.value })} aria-label="Photo for this colour" className="hidden sm:block">
              <option value="">Photo: none</option>
              {imageUrls.map((u, i) => <option key={u} value={u}>Photo {i + 1}</option>)}
            </Select>
            <button type="button" onClick={() => onChange(rows.filter(x => x.key !== r.key))} aria-label="Remove colour" className="rounded-full p-2 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...rows, newColourRow()])} className="mt-3 inline-flex items-center gap-1.5 rounded-full border-2 border-mint-300 px-4 py-2 text-sm font-extrabold text-mint-700 hover:bg-mint-50">
        <Plus size={15} /> Add colour
      </button>
    </div>
  );
};
