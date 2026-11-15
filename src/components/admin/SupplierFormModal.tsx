import React, { useEffect, useState } from 'react';
import { supabase, type Supplier } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Textarea, Field } from '../ui/Input';

const blank = { name: '', contact_person: '', phone: '', email: '', address: '', notes: '' };

/** Add a supplier, or edit an existing one (pass `supplier`). */
export const SupplierFormModal: React.FC<{ open: boolean; supplier: Supplier | null; onClose: () => void; onSaved: (id?: string) => void }> = ({ open, supplier, onClose, onSaved }) => {
  const { success, error } = useToast();
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(supplier ? {
      name: supplier.name || '', contact_person: supplier.contact_person || '', phone: supplier.phone || '',
      email: supplier.email || '', address: supplier.address || '', notes: supplier.notes || '',
    } : blank);
  }, [open, supplier]);

  const save = async () => {
    if (!form.name.trim()) return error('Enter the supplier name.');
    if (form.email.trim() && !/\S+@\S+\.\S+/.test(form.email.trim())) return error('That email address does not look right.');
    setSaving(true);
    const row = {
      name: form.name.trim(), contact_person: form.contact_person.trim() || null, phone: form.phone.trim() || null,
      email: form.email.trim() || null, address: form.address.trim() || null, notes: form.notes.trim() || null,
    };
    const { data, error: e } = supplier
      ? await supabase.from('suppliers').update(row).eq('id', supplier.id).select('id').single()
      : await supabase.from('suppliers').insert(row).select('id').single();
    setSaving(false);
    if (e) return error(e.message);
    success(supplier ? 'Supplier updated' : 'Supplier added');
    onSaved(data?.id);
  };

  return (
    <Modal open={open} onClose={onClose} title={supplier ? 'Edit supplier' : 'Add supplier'}>
      <div className="space-y-4">
        <Field label="Company / seller name"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Contact person"><Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} /></Field>
          <Field label="Phone / WhatsApp"><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+86 …" /></Field>
        </div>
        <Field label="Email"><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Address"><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field>
        <Field label="Notes" hint="Alibaba store link, payment terms, shipping time, minimum order…"><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="min-h-[80px]" /></Field>
        <div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>{supplier ? 'Save changes' : 'Add supplier'}</Button></div>
      </div>
    </Modal>
  );
};
