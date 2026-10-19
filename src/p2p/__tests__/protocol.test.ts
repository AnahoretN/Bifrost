import { describe, expect, it, vi } from 'vitest';
import { createProtocolHandler, type ProtocolDeps } from '../protocol';

function makeDeps(): ProtocolDeps & { calls: string[] } {
  const calls: string[] = [];
  const deps = {
    calls,
    isHost: () => false,
    hostId: () => 'host-1',
    selfId: () => 'me',
    onHello: vi.fn(() => calls.push('hello')),
    onManifest: vi.fn(() => calls.push('manifest')),
    onHostPing: vi.fn(() => calls.push('ping')),
    onHostReloading: vi.fn(() => calls.push('reloading')),
    onPoolUpdate: vi.fn(() => calls.push('poolUpdate')),
    onFileAdded: vi.fn(() => calls.push('fileAdded')),
    onFileRemoved: vi.fn(() => calls.push('fileRemoved')),
    onHaveReport: vi.fn(() => calls.push('haveReport')),
    onPreviewReq: vi.fn(() => calls.push('previewReq')),
    onDownloadReq: vi.fn(() => calls.push('downloadReq')),
    onOffer: vi.fn(() => calls.push('offer')),
    onAccept: vi.fn(() => calls.push('accept')),
    onReject: vi.fn(() => calls.push('reject')),
    onAck: vi.fn(() => calls.push('ack')),
    onNak: vi.fn(() => calls.push('nak')),
    onPause: vi.fn(() => calls.push('pause')),
    onResume: vi.fn(() => calls.push('resume')),
    onCancel: vi.fn(() => calls.push('cancel')),
    onComplete: vi.fn(() => calls.push('complete')),
  };
  return deps as unknown as ProtocolDeps & { calls: string[] };
}

describe('protocol dispatcher — host/guest split', () => {
  it('guest: HELLO is ignored (no pseudo-hosting), manifest applies', () => {
    const deps = makeDeps();
    const handle = createProtocolHandler(deps);
    handle({ type: 'HELLO', payload: {} }, 'p1');
    expect(deps.onHello).not.toHaveBeenCalled();
    handle({ type: 'POOL_MANIFEST', payload: {} }, 'p1');
    expect(deps.onManifest).toHaveBeenCalledOnce();
  });

  it('host: HELLO applies, manifest is ignored (host is the authority)', () => {
    const deps = makeDeps();
    deps.isHost = () => true;
    const handle = createProtocolHandler(deps);
    handle({ type: 'HELLO', payload: {} }, 'p1');
    expect(deps.onHello).toHaveBeenCalledOnce();
    handle({ type: 'POOL_MANIFEST', payload: {} }, 'p1');
    expect(deps.onManifest).not.toHaveBeenCalled();
  });

  it('host: FILE_ADDED routes, POOL_UPDATE is ignored', () => {
    const deps = makeDeps();
    deps.isHost = () => true;
    const handle = createProtocolHandler(deps);
    handle({ type: 'FILE_ADDED', payload: {} }, 'p1');
    expect(deps.onFileAdded).toHaveBeenCalledOnce();
    handle({ type: 'POOL_UPDATE', payload: {} }, 'p1');
    expect(deps.onPoolUpdate).not.toHaveBeenCalled();
  });

  it('transfer messages route on both roles', () => {
    const deps = makeDeps();
    const handle = createProtocolHandler(deps);
    const types = [
      ['TRANSFER_OFFER', 'offer'],
      ['TRANSFER_ACCEPT', 'accept'],
      ['TRANSFER_REJECT', 'reject'],
      ['CHUNK_ACK', 'ack'],
      ['CHUNK_NAK', 'nak'],
      ['PAUSE', 'pause'],
      ['RESUME', 'resume'],
      ['CANCEL', 'cancel'],
      ['TRANSFER_COMPLETE', 'complete'],
      ['DOWNLOAD_REQ', 'downloadReq'],
      ['PREVIEW_REQ', 'previewReq'],
      ['HOST_PING', 'ping'],
      ['HOST_RELOADING', 'reloading'],
    ] as const;
    for (const [type, expected] of types) {
      handle({ type, payload: {} }, 'p1');
      expect(deps.calls).toContain(expected);
    }
  });

  it('garbage messages are dropped without throwing', () => {
    const deps = makeDeps();
    const handle = createProtocolHandler(deps);
    expect(() => handle(null as never, 'p1')).not.toThrow();
    expect(() => handle({ type: 42, payload: {} } as never, 'p1')).not.toThrow();
    expect(() => handle({ type: 'UNKNOWN_TYPE', payload: {} }, 'p1')).not.toThrow();
  });
});
