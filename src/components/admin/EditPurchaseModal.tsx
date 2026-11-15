import React, { useEffect, useState } from 'react';
import { supabase, type Supplier } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Select, Textarea, Field } from '../ui/Input';

export type EditablePurchase = { id: string; reference: string | null; purchase_date: string; supplier_id: string | null; notes: string | null };

/** Fix or add a shipment's invoice number (and date / supplier / notes) after it was recorded. */
export const EditPurchaseModal: React.FC<{ purchase: EditablePurchase | null; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }> = ({ purchase, suppliers, onClose, onSaved }) => {
  const { success, error } = useToast();
  const [reference, setReference] = useState('');
  const [date, setDate] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!purchase) return;
    setReference(purchase.reference || ''); setDate(purchase.purchase_date); setSupplierId(purchase.supplier_id || ''); setNotes(purchase.notes || '');
  }, [purchase]);

  if (!purchase) return null;

  const save = async () => {
    const ref = reference.trim();
    const old = (purchase.reference || '').trim();
    setSaving(true);
    const { error: e } = await supabase.from('purchases').update({ reference: ref || null, purchase_date: date, supplier_id: supplierId || null, notes: notes.trim() || null }).eq('id', purchase.id);
    if (e) { setSaving(false); return error(e.message); }
    // keep this shipment's payments in step (only ones that had no number or the old number)
    if (ref !== old) {
      const q = supabase.from('purchase_payments').update({ reference: ref || null }).eq('purchase_id', purchase.id);
      const { error: pe } = await (old && /^[\w.-]+$/.test(old) ? q.or(`reference.is.null,reference.eq.${old}`) : q.is('reference', null));
      if (pe) error('Saved, but the payments could not be updated: ' + pe.message);
    }
    setSaving(false); success('Shipment updated'); onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Edit shipment">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Field label="Invoice / order no." hint="Also applied to this shipment's payments that had no number"><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. 29909937501030126" /></Field></div>
        <Field label="Supplier"><Select value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Purchase date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea value={notes} onChange={e => setNotes(e.target.value)} className="min-h-[70px]" /></Field></div>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></div>
    </Modal>
  );
};
