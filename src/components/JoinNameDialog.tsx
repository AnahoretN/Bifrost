import { useState } from 'react';

interface Props {
  onJoin: (name: string) => void;
  onCancel: () => void;
}

export default function JoinNameDialog({ onJoin, onCancel }: Props) {
  const [name, setName] = useState('');
  const valid = name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="card w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold text-slate-100">Join room</h2>
        <p className="mt-1 text-sm text-slate-400">Pick a display name other members will see.</p>
        <input
          autoFocus
          className="input mt-4"
          placeholder="Your name"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) onJoin(name.trim());
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid} onClick={() => onJoin(name.trim())}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
