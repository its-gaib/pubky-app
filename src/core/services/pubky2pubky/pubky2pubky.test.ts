import { describe, expect, it, vi } from 'vitest';
import type { Pubky } from '@/models/models.types';
import { Pubky2PubkyService } from './pubky2pubky';
import type {
  Pubky2PubkyAdapterListener,
  Pubky2PubkyTransport,
  Pubky2PubkyTransportEvent,
  Pubky2PubkyTransportSession,
} from './pubky2pubky.transport';

const ACCOUNT = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy' as Pubky;
const PEER = 'gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo' as Pubky;
const OTHER = 'o4dksfbqk85ogzdb5osziw6befigbuxmuxkuxq8434q89uj56uyy' as Pubky;

class FakeTransport implements Pubky2PubkyTransport {
  listeners = new Set<Pubky2PubkyAdapterListener>();
  initialized: Pubky2PubkyTransportSession[] = [];
  sent: Array<{ session: Pubky2PubkyTransportSession; peerId: Pubky; plaintext: Uint8Array }> = [];
  disconnect = vi.fn(async (_session: Pubky2PubkyTransportSession) => undefined);
  reset = vi.fn(async (_session: Pubky2PubkyTransportSession) => undefined);

  async initialize(session: Pubky2PubkyTransportSession): Promise<void> {
    this.initialized.push(session);
  }

  subscribe(listener: Pubky2PubkyAdapterListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publishAndGoOnline(_session: Pubky2PubkyTransportSession): Promise<void> {}
  async connect(_session: Pubky2PubkyTransportSession, _peerId: Pubky): Promise<void> {}
  async acceptInbound(_session: Pubky2PubkyTransportSession, _requestId: string): Promise<void> {}
  async rejectInbound(_session: Pubky2PubkyTransportSession, _requestId: string): Promise<void> {}

  async sendMessage(session: Pubky2PubkyTransportSession, peerId: Pubky, plaintext: Uint8Array): Promise<void> {
    this.sent.push({ session, peerId, plaintext });
  }

  emit(output: unknown): void {
    for (const listener of this.listeners) listener(output);
  }
}

function authorize(transport: FakeTransport, epoch: string, accountId = ACCOUNT): void {
  transport.emit({ type: 'identity', epoch, identity: accountId, restored: false });
}

function verifyPeer(transport: FakeTransport, epoch: string, accountId = ACCOUNT): void {
  transport.emit({
    type: 'peer-verified',
    epoch,
    ringGrantIssuer: accountId,
    peerId: PEER,
    route: 'relay',
    protocolVersion: 4,
    irohQuicEncrypted: true,
    pubkyIdentityVerified: true,
  });
}

describe('Pubky2PubkyService epoch and identity boundary', () => {
  it('rejects an app session whose exact Ring grant issuer does not match', () => {
    const service = new Pubky2PubkyService(new FakeTransport());

    expect(() => service.startSession({ accountId: ACCOUNT, ringGrantIssuer: OTHER }, vi.fn())).toThrow(
      'Ring grant issuer does not match',
    );
  });

  it('does not emit online state until a matching identity event authorizes the epoch', () => {
    const transport = new FakeTransport();
    const service = new Pubky2PubkyService(transport);
    const events: Pubky2PubkyTransportEvent[] = [];
    const epoch = service.startSession({ accountId: ACCOUNT, ringGrantIssuer: ACCOUNT }, (event) => events.push(event));

    transport.emit({ type: 'identity', epoch, identity: OTHER, restored: false });
    transport.emit({ type: 'online-state', epoch, ringGrantIssuer: ACCOUNT, state: 'online' });
    expect(events).toEqual([]);

    authorize(transport, epoch);
    transport.emit({ type: 'online-state', epoch, ringGrantIssuer: OTHER, state: 'online' });
    expect(events.map((event) => event.type)).toEqual(['identity']);

    transport.emit({ type: 'online-state', epoch, ringGrantIssuer: ACCOUNT, state: 'online' });
    expect(events.map((event) => event.type)).toEqual(['identity', 'online-state']);
  });

  it('discards stale epoch output after an account switch', () => {
    const transport = new FakeTransport();
    const service = new Pubky2PubkyService(transport);
    const firstEvents: Pubky2PubkyTransportEvent[] = [];
    const secondEvents: Pubky2PubkyTransportEvent[] = [];
    const firstEpoch = service.startSession({ accountId: ACCOUNT, ringGrantIssuer: ACCOUNT }, (event) =>
      firstEvents.push(event),
    );
    const secondEpoch = service.startSession({ accountId: OTHER, ringGrantIssuer: OTHER }, (event) =>
      secondEvents.push(event),
    );

    transport.emit({ type: 'identity', epoch: firstEpoch, identity: ACCOUNT, restored: true });
    transport.emit({ type: 'online-state', epoch: firstEpoch, ringGrantIssuer: ACCOUNT, state: 'online' });
    expect(firstEvents).toEqual([]);
    expect(secondEvents).toEqual([]);

    transport.emit({ type: 'identity', epoch: secondEpoch, identity: OTHER, restored: true });
    expect(secondEvents.map((event) => event.type)).toEqual(['identity']);
  });

  it('does not let completion of an old disconnect tear down a newer epoch', async () => {
    const transport = new FakeTransport();
    let finishDisconnect: ((value: undefined) => void) | undefined;
    transport.disconnect.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finishDisconnect = resolve)),
    );
    const service = new Pubky2PubkyService(transport);
    const firstEpoch = service.startSession({ accountId: ACCOUNT, ringGrantIssuer: ACCOUNT }, vi.fn());
    const stopping = service.stopSession(firstEpoch);
    const events: Pubky2PubkyTransportEvent[] = [];
    const secondEpoch = service.startSession({ accountId: OTHER, ringGrantIssuer: OTHER }, (event) =>
      events.push(event),
    );

    finishDisconnect?.(undefined);
    await stopping;
    transport.emit({ type: 'identity', epoch: secondEpoch, identity: OTHER, restored: true });

    expect(service.isActiveSession(secondEpoch, OTHER)).toBe(true);
    expect(events.map((event) => event.type)).toEqual(['identity']);
    expect(transport.reset).toHaveBeenCalledWith(expect.objectContaining({ epoch: firstEpoch }));
  });

  it('accepts and sends message bytes only for an identity-authorized, verified peer', async () => {
    const transport = new FakeTransport();
    const service = new Pubky2PubkyService(transport);
    const events: Pubky2PubkyTransportEvent[] = [];
    const epoch = service.startSession({ accountId: ACCOUNT, ringGrantIssuer: ACCOUNT }, (event) => events.push(event));
    authorize(transport, epoch);

    transport.emit({
      type: 'message',
      epoch,
      ringGrantIssuer: ACCOUNT,
      peerId: PEER,
      messageId: 'before_verification',
      plaintext: new TextEncoder().encode('blocked'),
      receivedAt: Date.now(),
    });
    expect(events.some((event) => event.type === 'message')).toBe(false);
    await expect(service.sendMessage(epoch, PEER, new TextEncoder().encode('blocked'))).rejects.toThrow(
      'not completed v4 identity verification',
    );

    verifyPeer(transport, epoch);
    transport.emit({
      type: 'message',
      epoch,
      ringGrantIssuer: ACCOUNT,
      peerId: PEER,
      messageId: 'message_1',
      plaintext: new TextEncoder().encode('hello'),
      receivedAt: Date.now(),
    });
    await service.sendMessage(epoch, PEER, new TextEncoder().encode('reply'));

    expect(events.find((event) => event.type === 'message')).toMatchObject({ body: 'hello', peerId: PEER });
    expect(transport.sent).toHaveLength(1);

    transport.emit({ type: 'peer-disconnected', epoch, ringGrantIssuer: ACCOUNT, peerId: OTHER });
    await service.sendMessage(epoch, PEER, new TextEncoder().encode('still connected'));
    expect(transport.sent).toHaveLength(2);
  });
});
