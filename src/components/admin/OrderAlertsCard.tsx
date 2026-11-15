import React, { useEffect, useState } from 'react';
import { Send, Save, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../ui/Button';
import { Input, Field } from '../ui/Input';

type Chat = { id: string; label: string };

/** Telegram alert for every new order: bot token, chat id, on/off, and a test button. */
export const OrderAlertsCard: React.FC = () => {
  const { success, error } = useToast();
  const [token, setToken] = useState('');
  const [chat, setChat] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [finding, setFinding] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase.from('alert_settings').select('*').eq('id', 1).maybeSingle().then(({ data, error: e }) => {
      if (e) { setMissing(true); return; }
      if (data) { setToken(data.telegram_bot_token || ''); setChat(data.telegram_chat_id || ''); setEnabled(data.enabled !== false); }
    });
  }, []);

  const save = async (quiet = false) => {
    setSaving(true);
    const { error: e } = await supabase.from('alert_settings').upsert({ id: 1, telegram_bot_token: token.trim() || null, telegram_chat_id: chat.trim() || null, enabled, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    setSaving(false);
    if (e) { error(e.message); return false; }
    if (!quiet) success('Order alert settings saved');
    return true;
  };

  const test = async () => {
    setResult(null);
    if (!token.trim() || !chat.trim()) { setResult({ ok: false, text: 'Enter the bot token and chat ID first.' }); return; }
    setTesting(true);
    if (!(await save(true))) { setTesting(false); return; }
    const { data: id, error: e } = await supabase.rpc('send_telegram_test');
    if (e || id == null) { setTesting(false); setResult({ ok: false, text: e?.message || 'Alerts are switched off or not saved yet.' }); return; }
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const { data: st } = await supabase.rpc('telegram_last_status', { p_id: id });
      if (st?.done) {
        setTesting(false);
        if (st.status === 200) setResult({ ok: true, text: 'Sent! Check your Telegram.' });
        else {
          let why = st.error || '';
          try { why = JSON.parse(st.content || '{}').description || why; } catch { /* keep raw */ }
          setResult({ ok: false, text: `Telegram said: ${why || 'error ' + st.status}. ${/chat not found/i.test(why) ? 'Add the bot to the group (or press Start in its chat) and send a message first.' : /unauthorized|not found/i.test(why) ? 'Check the bot token.' : ''}` });
        }
        return;
      }
    }
    setTesting(false); setResult({ ok: false, text: 'No answer yet. Wait a few seconds and press Test again.' });
  };

  const findChats = async () => {
    setFinding(true); setChats([]); setResult(null);
    try {
      const r = await fetch(`https://api.telegram.org/bot${token.trim()}/getUpdates`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'Telegram refused the token');
      const seen = new Map<string, string>();
      (j.result || []).forEach((u: any) => {
        const c = u.message?.chat || u.my_chat_member?.chat || u.channel_post?.chat || u.edited_message?.chat;
        if (c) seen.set(String(c.id), c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id));
      });
      const list = [...seen.entries()].map(([id, label]) => ({ id, label }));
      setChats(list);
      if (!list.length) setResult({ ok: false, text: 'No chats found yet. Add the bot to your group (or send it a message), type anything there, then press Find again.' });
    } catch (e: any) {
      setResult({ ok: false, text: 'Could not look up the chat: ' + (e.message || 'blocked') + '. Open https://api.telegram.org/bot<YOUR TOKEN>/getUpdates in a new tab and copy the number after "chat":{"id":.' });
    }
    setFinding(false);
  };

  return (
    <section className="rounded-4xl border border-ink-100 bg-white p-6 shadow-soft">
      <h2 className="font-display text-lg font-extrabold text-ink-900 mb-1 flex items-center gap-2"><Send size={18} className="text-sky-500" /> Order alerts on Telegram</h2>
      <p className="text-sm text-ink-500 mb-4">Get a message on your phone the moment a customer places an order. Free, and everyone in the Telegram group gets it.</p>

      {missing && <div className="mb-4 rounded-3xl bg-sunshine-50 border border-sunshine-200 p-3 text-sm text-ink-800 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5 text-sunshine-600" />Run <code>supabase/migrations/0015_telegram_order_alerts.sql</code> in the Supabase SQL Editor first.</div>}

      <details className="mb-4 rounded-3xl bg-ink-50 px-4 py-3 text-sm text-ink-700">
        <summary className="cursor-pointer font-extrabold">How to set it up (5 minutes)</summary>
        <ol className="mt-2 list-decimal pl-5 space-y-1">
          <li>In Telegram, search for <b>@BotFather</b>, send <b>/newbot</b>, pick a name, and copy the <b>token</b> it gives you.</li>
          <li>Create a Telegram <b>group</b> with you and your sister, then add your new bot to it.</li>
          <li>Send any message in the group.</li>
          <li>Paste the token below and press <b>Find my chat</b>. Click your group to fill in the chat ID.</li>
          <li>Press <b>Save</b>, then <b>Send test message</b>.</li>
        </ol>
      </details>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Bot token"><Input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="123456789:ABC…" /></Field>
        <Field label="Chat ID"><Input value={chat} onChange={e => setChat(e.target.value)} placeholder="e.g. -1001234567890" /></Field>
      </div>
      {chats.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">{chats.map(c => (
          <button key={c.id} onClick={() => { setChat(c.id); setChats([]); }} className="rounded-full border border-mint-300 bg-mint-50 px-3 py-1 text-xs font-extrabold text-mint-700 hover:bg-mint-100">{c.label} <span className="font-semibold text-ink-400">({c.id})</span></button>
        ))}</div>
      )}
      <label className="mt-4 flex items-center gap-2 text-sm font-bold text-ink-700"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="h-5 w-5 accent-teal-500" /> Send an alert for every new order</label>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => save()} loading={saving}><Save size={16} /> Save</Button>
        <Button variant="secondary" onClick={findChats} loading={finding} disabled={!token.trim()}><Search size={16} /> Find my chat</Button>
        <Button variant="outline" onClick={test} loading={testing}><Send size={16} /> Send test message</Button>
      </div>
      {result && (
        <p className={`mt-3 flex items-start gap-2 text-sm font-bold ${result.ok ? 'text-mint-700' : 'text-red-500'}`}>{result.ok ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}{result.text}</p>
      )}
      <p className="mt-3 text-xs text-ink-400 font-semibold">Each alert shows the order number, total, payment type, items and the customer's name and city — never the address or phone. Open the order in Admin → Orders for the rest.</p>
    </section>
  );
};
