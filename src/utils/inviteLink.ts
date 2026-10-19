import { ROOM_ID_PREFIX } from '../constants';

export function generateRoomId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(36).padStart(2, '0'))
          .join('')
          .slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${ROOM_ID_PREFIX}-${rand}`;
}

export function buildInviteLink(roomId: string): string {
  const url = new URL(window.location.href);
  url.search = `?roomId=${encodeURIComponent(roomId)}`;
  url.hash = '';
  return url.toString();
}

export function roomIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('roomId');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context + focus; fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
