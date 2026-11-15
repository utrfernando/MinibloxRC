import React from 'react';
import { Select, Field } from '../../ui/Input';

/** Where the money came from: the business fund (deposited earlier) or a partner's own pocket. */
export const PaidFromSelect: React.FC<{ value: string; onChange: (v: string) => void; label?: string }> = ({ value, onChange, label = 'Paid from' }) => (
  <Field label={label} hint={value === 'fund' ? 'Comes out of the business fund — not counted as the partner\'s own money.' : 'The partner paid personally — counts as their investment.'}>
    <Select value={value} onChange={e => onChange(e.target.value)}>
      <option value="fund">Business fund (money already deposited)</option>
      <option value="own">Own pocket (partner paid personally)</option>
    </Select>
  </Field>
);
