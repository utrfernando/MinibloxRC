import React, { useState } from 'react';
import { Share2, Link2, Check } from 'lucide-react';
import { FaWhatsapp, FaFacebookF, FaTelegramPlane } from 'react-icons/fa';
import { Modal } from './ui/Modal';
import { useToast } from '../contexts/ToastContext';
import { cn } from '../lib/utils';

type Props = { productId: string; name: string; className?: string; size?: number; label?: string };

const productUrl = (id: string) => `${window.location.origin}/product/${id}`;

/** Share a product: the phone's own share sheet when there is one, otherwise a small list (WhatsApp, Facebook, Telegram, copy link). */
export const ShareButton: React.FC<Props> = ({ productId, name, className, size = 18, label }) => {
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = productUrl(productId);
  const text = `Look at this: ${name} — MinibloxRC`;

  const start = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: name, text, url }); }
      catch (err) { if ((err as Error)?.name !== 'AbortError') setOpen(true); }   // cancelled = fine; anything else falls back to the list
      return;
    }
    setOpen(true);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); success('Link copied'); setTimeout(() => setCopied(false), 2000); }
    catch { error('Could not copy. Long-press the link to copy it.'); }
  };

  const enc = encodeURIComponent;
  const opts = [
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${url}`)}`, icon: <FaWhatsapp size={20} />, color: 'bg-[#25D366]' },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, icon: <FaFacebookF size={18} />, color: 'bg-[#1877F2]' },
    { label: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`, icon: <FaTelegramPlane size={20} />, color: 'bg-[#229ED9]' },
  ];

  return (
    <>
      <button type="button" onClick={start} aria-label={`Share ${name}`} title="Share"
        className={cn('inline-flex items-center justify-center gap-1.5 transition active:scale-90', className)}>
        <Share2 size={size} />{label && <span>{label}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Share this toy">
        <p className="mb-4 text-sm font-semibold text-ink-500 break-words">{name}</p>
        <div className="grid grid-cols-3 gap-3">
          {opts.map(o => (
            <a key={o.label} href={o.href} target="_blank" rel="noreferrer noopener" onClick={() => setOpen(false)}
              className="flex flex-col items-center gap-2 rounded-3xl border-2 border-ink-100 p-3 text-xs font-extrabold text-ink-700 hover:border-mint-300">
              <span className={cn('flex h-11 w-11 items-center justify-center rounded-full text-white', o.color)}>{o.icon}</span>{o.label}
            </a>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-2xl border-2 border-ink-100 p-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-500">{url}</span>
          <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-mint-500 px-4 py-2 text-sm font-extrabold text-white hover:bg-mint-600">
            {copied ? <Check size={15} /> : <Link2 size={15} />}{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </Modal>
    </>
  );
};
