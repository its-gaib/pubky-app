import type {
  BrowserTransport,
  BrowserTransportConfig,
  BrowserTransportEvent,
  LocalIdentitySummary,
  MessageReceipt,
} from 'pubky2pubky/browser';
import { describe, expect, it, vi } from 'vitest';
import type { Pubky } from '@/models/models.types';
import { asInvalid } from '@/test-utils/type-assertions';
import { BrowserPubky2PubkyTransport } from './pubky2pubky.browser';
import type { Pubky2PubkyTransportSession } from './pubky2pubky.transport';

const ACCOUNT = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy' as Pubky;
const PEER = 'gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo' as Pubky;
const OTHER = 'o4dksfbqk85ogzdb5osziw6befigbuxmuxkuxq8434q89uj56uyy' as Pubky;
const CONFIG: BrowserTransportConfig = {
  clientId: 'chat.pubky2pubky',
  httpRelay: 'https://httprelay.staging.pubky.app/inbox',
  irohRelays: ['https://euc1-1.relay.n0.iroh.link/'],
};

function session(epoch: string, accountId = ACCOUNT): Pubky2PubkyTransportSession {
  return { epoch, accountId, expectedRingGrantIssuer: accountId };
}

function authorizationUrl(): string {
  const query = new URLSearchParams({
    caps: '/pub/pubky2pubky/:rw',
    cid: CONFIG.clientId,
    cpk: OTHER,
    relay: CONFIG.httpRelay,
    secret: 'a'.repeat(43),
  });
  return `pubkyauth://signin_grant?${query.toString()}`;
}

class FakeBrowserTransport implements BrowserTransport {
  private readonly listeners = new Set<(event: BrowserTransportEvent) => void>();
  readonly initialize = vi.fn(async (_accountId?: string) => undefined);
  readonly connectWithRing = vi.fn(async () => ACCOUNT);
  readonly listLocalIdentities = vi.fn(async (): Promise<readonly LocalIdentitySummary[]> => []);
  readonly removeLocalIdentity = vi.fn(async (_identity: string): Promise<LocalIdentitySummary> => {
    throw new Error('unused');
  });
  readonly publishAndGoOnline = vi.fn(async () => undefined);
  readonly connect = vi.fn(async (_peerId: string) => undefined);
  readonly requestPeer = vi.fn(async (_peerId: string) => undefined);
  readonly requestConversation = vi.fn(async (_peerId: string) => undefined);
  readonly acceptInbound = vi.fn(async (_requestId: string) => undefined);
  readonly accept = vi.fn(async (_requestId: string) => undefined);
  readonly rejectInbound = vi.fn(async (_requestId: string) => undefined);
  readonly decline = vi.fn(async (_requestId: string) => undefined);
  readonly sendMessage = vi.fn(
    async (peerId: string, _bytes: Uint8Array): Promise<MessageReceipt> => ({ peerId, acceptedAt: Date.now() }),
  );
  readonly send = vi.fn(
    async (peerId: string, _text: string): Promise<MessageReceipt> => ({ peerId, acceptedAt: Date.now() }),
  );
  readonly disconnect = vi.fn(async () => undefined);
  readonly destroy = vi.fn(async () => undefined);

  subscribe(listener: (event: BrowserTransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: BrowserTransportEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function adapterWith(...browsers: FakeBrowserTransport[]): BrowserPubky2PubkyTransport {
  let next = 0;
  return new BrowserPubky2PubkyTransport(
    () => CONFIG,
    async () => {
      const browser = browsers[next++];
      if (!browser) throw new Error('Missing fake browser transport.');
      return browser;
    },
  );
}

function restore(browser: FakeBrowserTransport, identity = ACCOUNT): void {
  browser.initialize.mockImplementationOnce(async () => {
    browser.emit({ type: 'identity', identity, restored: true });
  });
}

function verifiedEvent(overrides: Partial<Extract<BrowserTransportEvent, { type: 'peer-verified' }>> = {}) {
  return {
    type: 'peer-verified' as const,
    peerId: PEER,
    peerDeviceId: 'browser',
    path: 'relay' as const,
    route: 'relay' as const,
    e2e: true as const,
    irohQuicEncrypted: true as const,
    pubkyIdentityVerified: true as const,
    protocolVersion: 4 as const,
    alpn: 'pubky2pubky/iroh/v4' as const,
    ...overrides,
  };
}

function inboundRequest(id = 'request_1', peerId = PEER): BrowserTransportEvent {
  return { type: 'inbound-request', id, peerId, peerDeviceId: 'browser', receivedAt: Date.now() };
}

function emitAndReturn(browser: FakeBrowserTransport, event: BrowserTransportEvent): undefined {
  browser.emit(event);
  return undefined;
}

describe('BrowserPubky2PubkyTransport', () => {
  it('exposes a bounded Ring handoff and authorizes the epoch only from the exact package identity', async () => {
    const browser = new FakeBrowserTransport();
    browser.connectWithRing.mockImplementationOnce(async () => {
      browser.emit({ type: 'auth-required', authorizationUrl: authorizationUrl() });
      browser.emit({ type: 'identity', identity: ACCOUNT, restored: false });
      return ACCOUNT;
    });
    const adapter = adapterWith(browser);
    const outputs: unknown[] = [];
    adapter.subscribe((output) => outputs.push(output));

    await adapter.initialize(session('epoch_auth'));
    browser.emit({ type: 'connecting' });
    browser.emit({ type: 'online-state', online: true, status: 'online' });

    expect(browser.initialize).toHaveBeenCalledWith(ACCOUNT);
    expect(outputs).toEqual([
      { type: 'auth-required', epoch: 'epoch_auth', authorizationUrl: authorizationUrl() },
      { type: 'identity', epoch: 'epoch_auth', identity: ACCOUNT, restored: false },
      { type: 'online-state', epoch: 'epoch_auth', ringGrantIssuer: ACCOUNT, state: 'publishing' },
      { type: 'online-state', epoch: 'epoch_auth', ringGrantIssuer: ACCOUNT, state: 'online' },
    ]);
  });

  it('requires every v4 verification invariant before messages or sends can cross the boundary', async () => {
    const browser = new FakeBrowserTransport();
    restore(browser);
    const adapter = adapterWith(browser);
    const outputs: Array<Record<string, unknown>> = [];
    adapter.subscribe((output) => outputs.push(output as Record<string, unknown>));
    const active = session('epoch_verified');
    await adapter.initialize(active);

    browser.requestConversation.mockImplementationOnce(async () => emitAndReturn(browser, verifiedEvent()));
    await adapter.connect(active, PEER);
    browser.emit({ type: 'message', peerId: PEER, body: new TextEncoder().encode('hello'), receivedAt: Date.now() });
    await adapter.sendMessage(active, PEER, new TextEncoder().encode('reply'));

    const verified = outputs.find((event) => event.type === 'peer-verified');
    const message = outputs.find((event) => event.type === 'message');
    expect(verified).toMatchObject({ ringGrantIssuer: ACCOUNT, peerId: PEER, route: 'relay', protocolVersion: 4 });
    expect(message).toMatchObject({ ringGrantIssuer: ACCOUNT, peerId: PEER });
    expect(message?.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(browser.sendMessage).toHaveBeenCalledOnce();
  });

  it('rejects an otherwise valid peer verification when no peer attempt was authorized', async () => {
    const browser = new FakeBrowserTransport();
    restore(browser);
    const adapter = adapterWith(browser);
    const outputs: Array<Record<string, unknown>> = [];
    adapter.subscribe((output) => outputs.push(output as Record<string, unknown>));
    await adapter.initialize(session('epoch_unsolicited'));

    browser.emit(verifiedEvent());

    expect(outputs.some((event) => event.type === 'peer-verified')).toBe(false);
    expect(outputs.at(-1)).toEqual({
      type: 'unavailable',
      epoch: 'epoch_unsolicited',
      reason: 'v4-browser-package-unavailable',
    });
    expect(browser.destroy).toHaveBeenCalledOnce();
  });

  it('binds inbound acceptance to the exact request peer and marks it before a synchronous verification event', async () => {
    const acceptedBrowser = new FakeBrowserTransport();
    restore(acceptedBrowser);
    const acceptedAdapter = adapterWith(acceptedBrowser);
    const acceptedOutputs: Array<Record<string, unknown>> = [];
    acceptedAdapter.subscribe((output) => acceptedOutputs.push(output as Record<string, unknown>));
    const acceptedSession = session('epoch_inbound_accepted');
    await acceptedAdapter.initialize(acceptedSession);
    acceptedBrowser.emit(inboundRequest());
    acceptedBrowser.acceptInbound.mockImplementationOnce(async () => emitAndReturn(acceptedBrowser, verifiedEvent()));

    await acceptedAdapter.acceptInbound(acceptedSession, 'request_1');
    expect(acceptedOutputs.some((event) => event.type === 'peer-verified' && event.peerId === PEER)).toBe(true);

    const unacceptedBrowser = new FakeBrowserTransport();
    restore(unacceptedBrowser);
    const unacceptedAdapter = adapterWith(unacceptedBrowser);
    const unacceptedOutputs: Array<Record<string, unknown>> = [];
    unacceptedAdapter.subscribe((output) => unacceptedOutputs.push(output as Record<string, unknown>));
    await unacceptedAdapter.initialize(session('epoch_inbound_unaccepted'));
    unacceptedBrowser.emit(inboundRequest());
    unacceptedBrowser.emit(verifiedEvent());
    expect(unacceptedOutputs.some((event) => event.type === 'peer-verified')).toBe(false);
    expect(unacceptedOutputs.at(-1)?.type).toBe('unavailable');

    const wrongBrowser = new FakeBrowserTransport();
    restore(wrongBrowser);
    const wrongAdapter = adapterWith(wrongBrowser);
    const wrongOutputs: Array<Record<string, unknown>> = [];
    wrongAdapter.subscribe((output) => wrongOutputs.push(output as Record<string, unknown>));
    const wrongSession = session('epoch_inbound_wrong');
    await wrongAdapter.initialize(wrongSession);
    wrongBrowser.emit(inboundRequest());
    wrongBrowser.acceptInbound.mockImplementationOnce(async () =>
      emitAndReturn(wrongBrowser, verifiedEvent({ peerId: OTHER })),
    );

    await expect(wrongAdapter.acceptInbound(wrongSession, 'request_1')).rejects.toThrow('rejected invalid or stale');
    expect(wrongOutputs.some((event) => event.type === 'peer-verified')).toBe(false);
    expect(wrongOutputs.at(-1)).toEqual({
      type: 'unavailable',
      epoch: 'epoch_inbound_wrong',
      reason: 'v4-browser-package-unavailable',
    });
  });

  it('rolls failed outbound and inbound operations back so an explicit retry can authorize verification', async () => {
    const outboundBrowser = new FakeBrowserTransport();
    restore(outboundBrowser);
    const outboundAdapter = adapterWith(outboundBrowser);
    const outboundSession = session('epoch_outbound_retry');
    await outboundAdapter.initialize(outboundSession);
    outboundBrowser.requestConversation.mockRejectedValueOnce(new Error('unreachable'));
    await expect(outboundAdapter.connect(outboundSession, PEER)).rejects.toThrow('unreachable');
    outboundBrowser.requestConversation.mockImplementationOnce(async () =>
      emitAndReturn(outboundBrowser, verifiedEvent()),
    );
    await expect(outboundAdapter.connect(outboundSession, PEER)).resolves.toBeUndefined();

    const inboundBrowser = new FakeBrowserTransport();
    restore(inboundBrowser);
    const inboundAdapter = adapterWith(inboundBrowser);
    const inboundSession = session('epoch_inbound_retry');
    await inboundAdapter.initialize(inboundSession);
    inboundBrowser.emit(inboundRequest());
    inboundBrowser.acceptInbound.mockRejectedValueOnce(new Error('temporary failure'));
    await expect(inboundAdapter.acceptInbound(inboundSession, 'request_1')).rejects.toThrow('temporary failure');
    inboundBrowser.acceptInbound.mockImplementationOnce(async () => emitAndReturn(inboundBrowser, verifiedEvent()));
    await expect(inboundAdapter.acceptInbound(inboundSession, 'request_1')).resolves.toBeUndefined();
  });

  it('removes inbound authorization state on rejection and expiry', async () => {
    const rejectedBrowser = new FakeBrowserTransport();
    restore(rejectedBrowser);
    const rejectedAdapter = adapterWith(rejectedBrowser);
    const rejectedOutputs: Array<Record<string, unknown>> = [];
    rejectedAdapter.subscribe((output) => rejectedOutputs.push(output as Record<string, unknown>));
    const rejectedSession = session('epoch_rejected');
    await rejectedAdapter.initialize(rejectedSession);
    rejectedBrowser.emit(inboundRequest());
    await rejectedAdapter.rejectInbound(rejectedSession, 'request_1');
    rejectedBrowser.emit(verifiedEvent());
    expect(rejectedOutputs.some((event) => event.type === 'peer-verified')).toBe(false);
    expect(rejectedOutputs.at(-1)?.type).toBe('unavailable');

    const expiredBrowser = new FakeBrowserTransport();
    restore(expiredBrowser);
    const expiredAdapter = adapterWith(expiredBrowser);
    const expiredOutputs: Array<Record<string, unknown>> = [];
    expiredAdapter.subscribe((output) => expiredOutputs.push(output as Record<string, unknown>));
    const expiredSession = session('epoch_expired');
    await expiredAdapter.initialize(expiredSession);
    expiredBrowser.emit(inboundRequest());
    expiredBrowser.emit({ type: 'inbound-request-expired', id: 'request_1' });
    expiredBrowser.emit(verifiedEvent());
    expect(expiredOutputs.some((event) => event.type === 'peer-verified')).toBe(false);
    expect(expiredOutputs.at(-1)?.type).toBe('unavailable');
  });

  it('fails closed instead of laundering a wrong identity or forged peer verification', async () => {
    const wrongIdentityBrowser = new FakeBrowserTransport();
    restore(wrongIdentityBrowser, OTHER);
    const identityAdapter = adapterWith(wrongIdentityBrowser);
    const identityOutputs: Array<Record<string, unknown>> = [];
    identityAdapter.subscribe((output) => identityOutputs.push(output as Record<string, unknown>));

    await expect(identityAdapter.initialize(session('epoch_wrong'))).rejects.toThrow('rejected invalid or stale');
    expect(identityOutputs).toEqual([
      { type: 'unavailable', epoch: 'epoch_wrong', reason: 'v4-browser-package-unavailable' },
    ]);
    expect(identityOutputs.some((event) => 'ringGrantIssuer' in event)).toBe(false);

    const forgedBrowser = new FakeBrowserTransport();
    restore(forgedBrowser);
    const verificationAdapter = adapterWith(forgedBrowser);
    const verificationOutputs: Array<Record<string, unknown>> = [];
    verificationAdapter.subscribe((output) => verificationOutputs.push(output as Record<string, unknown>));
    await verificationAdapter.initialize(session('epoch_forged'));
    forgedBrowser.emit(asInvalid<BrowserTransportEvent>({ ...verifiedEvent(), e2e: false }));

    expect(verificationOutputs.at(-1)).toEqual({
      type: 'unavailable',
      epoch: 'epoch_forged',
      reason: 'v4-browser-package-unavailable',
    });
    expect(verificationOutputs.some((event) => event.type === 'peer-verified')).toBe(false);
    expect(forgedBrowser.destroy).toHaveBeenCalledOnce();
  });

  it('scopes delayed teardown to its old epoch and browser object', async () => {
    const first = new FakeBrowserTransport();
    const second = new FakeBrowserTransport();
    restore(first, ACCOUNT);
    restore(second, OTHER);
    let finishDisconnect: (() => void) | undefined;
    first.disconnect.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finishDisconnect = () => resolve(undefined))),
    );
    const adapter = adapterWith(first, second);
    const firstSession = session('epoch_first', ACCOUNT);
    const secondSession = session('epoch_second', OTHER);
    await adapter.initialize(firstSession);

    const oldDisconnect = adapter.disconnect(firstSession);
    await adapter.initialize(secondSession);
    finishDisconnect?.();
    await oldDisconnect;
    await adapter.reset(firstSession);

    second.emit({ type: 'online-state', online: true, status: 'online' });
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.disconnect).not.toHaveBeenCalled();
    expect(second.destroy).not.toHaveBeenCalled();
  });
});
