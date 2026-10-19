import { useEffect, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { copyToClipboard } from '../utils/inviteLink';
import { useSessionStore } from '../store/sessionStore';

export default function InviteLinkBar() {
  const inviteLink = useSessionStore((s) => s.inviteLink);
  const role = useSessionStore((s) => s.role);
  const [copied, setCopied] = useState(false);
  const [autoCopied, setAutoCopied] = useState(false);

  // Auto-copy once when the link first appears (host convenience, same as the
  // reference app's invite flow).
  useEffect(() => {
    if (inviteLink && role === 'host' && !autoCopied) {
      setAutoCopied(true);
      void copyToClipboard(inviteLink).then((ok) => setCopied(ok));
    }
  }, [inviteLink, role, autoCopied]);

  if (!inviteLink) return null;

  return (
    <div className="card flex items-center gap-3 p-3">
      <Link2 className="h-4 w-4 shrink-0 text-bifrost-400" />
      <input
        readOnly
        value={inviteLink}
        onFocus={(e) => e.currentTarget.select()}
        className="input flex-1 font-mono text-xs"
      />
      <button
        className="btn-primary shrink-0"
        onClick={() => void copyToClipboard(inviteLink).then(setCopied)}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
