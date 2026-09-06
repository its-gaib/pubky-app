'use client';

import {
  type BrowserErrorCode,
  type BrowserTransport,
  type BrowserTransportConfig,
  createBrowserTransport,
} from 'pubky2pubky/browser';
import {
  CHAT_AUTHORIZATION_URL_MAX_LENGTH,
  CHAT_MESSAGE_ID_MAX_LENGTH,
  CHAT_MESSAGE_MAX_BYTES,
  CHAT_TRANSPORT_EPOCH_MAX_LENGTH,
  CHAT_TRANSPORT_MAX_FUTURE_SKEW_MS,
} from '@/config/chat';
import { getDefaultHttpRelay, getTestnet } from '@/libs/runtime-config/runtime-config';
import type { Pubky } from '@/models/models.types';
import type {
  Pubky2PubkyAdapterListener,
  Pubky2PubkyTransport,
  Pubky2PubkyTransportSession,
} from '@/services/pubky2pubky/pubky2pubky.transport';

const CLIENT_ID = 'chat.pubky2pubky';
const REQUIRED_CAPABILITY = '/pub/pubky2pubky/:rw';
const TRUSTED_IROH_RELAYS = ['https://euc1-1.relay.n0.iroh.link/'] as const;
const V1_ALPN = 'pubky2pubky/iroh/v1';
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_SECRET = /^[A-Za-z0-9_-]{43}$/;
const PUBKY_ID = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;
const MAX_INBOUND_REQUESTS = 32;
const ERROR_CODES = new Set<BrowserErrorCode>([
  'another-tab-online',
  'authentication-required',
  'auth-relay-invalid',
  'browser-unsupported',
  'client-id-invalid',
  'device-state-exists',
  'device-state-invalid',
  'ed25519-unsupported',
  'grant-key-missing',
  'identity-active',
  'identity-exists',
  'identity-mismatch',
  'identity-not-found',
  'identity-verification-failed',
  'internal-error',
  'invalid-pubky',
  'invalid-state',
  'message-invalid',
  'peer-already-connected',
  'peer-not-connected',
  'peer-unreachable',
  'publication-failed',
  'relay-path-unverified',
  'relay-unreachable',
  'relay-config-invalid',
  'request-expired',
  'session-closed',
  'sequence-limit',
  'signing-failed',
  'storage-blocked',
  'storage-failed',
  'storage-invalid',
  'storage-key-missing',
  'storage-tampered',
  'storage-too-large',
  'testnet-config-invalid',
  'transport-unavailable',
]);

type BrowserTransportFactory = (config: BrowserTransportConfig) => Promise<BrowserTransport>;
type Operation = 'publish' | 'connect' | 'accept' | 'reject' | 'send';

interface BrowserSessionEntry {
  readonly session: Pubky2PubkyTransportSession;
  readonly config: BrowserTransportConfig;
  readonly browserReady: Promise<BrowserTransport>;
  browser: BrowserTransport | null;
  unsubscribe: () => void;
  confirmedIdentity: Pubky | null;
  requestedOutboundPeers: Set<Pubky>;
  inboundRequests: Map<string, Pubky>;
  acceptedInboundRequests: Map<string, Pubky>;
  rejectingInboundRequests: Set<string>;
  verifiedPeers: Set<Pubky>;
  closing: boolean;
  boundaryFailed: boolean;
}

class BrowserTransportBoundaryError extends Error {
  constructor() {
    super('The secure browser transport rejected invalid or stale state.');
    this.name = 'BrowserTransportBoundaryError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && /^[A-Za-z0-9_-]+$/.test(value);
}

function isCanonicalPubky(value: unknown): value is Pubky {
  return typeof value === 'string' && PUBKY_ID.test(value);
}

function isLocalTimestamp(value: unknown, now = Date.now()): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    Math.abs(value - now) <= CHAT_TRANSPORT_MAX_FUTURE_SKEW_MS
  );
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function normalizeUrl(value: string | null): string {
  if (value === null) return '';
  try {
    return new URL(value).href;
  } catch {
    return '';
  }
}

function validateAuthorizationUrl(value: unknown, config: BrowserTransportConfig): string {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).byteLength > CHAT_AUTHORIZATION_URL_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new BrowserTransportBoundaryError();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserTransportBoundaryError();
  }

  const keys = [...url.searchParams.keys()].sort();
  const clientPublicKey = url.searchParams.get('cpk');
  if (
    url.protocol !== 'pubkyauth:' ||
    url.hostname !== 'signin_grant' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '' ||
    url.hash !== '' ||
    keys.join(',') !== 'caps,cid,cpk,relay,secret' ||
    url.searchParams.get('caps') !== REQUIRED_CAPABILITY ||
    url.searchParams.get('cid') !== config.clientId ||
    clientPublicKey === null ||
    !isCanonicalPubky(clientPublicKey) ||
    !GRANT_SECRET.test(url.searchParams.get('secret') ?? '') ||
    normalizeUrl(url.searchParams.get('relay')) !== normalizeUrl(config.httpRelay)
  ) {
    throw new BrowserTransportBoundaryError();
  }

  return url.href;
}

function validateSession(session: Pubky2PubkyTransportSession): void {
  if (
    !isBoundedIdentifier(session.epoch, CHAT_TRANSPORT_EPOCH_MAX_LENGTH) ||
    !isCanonicalPubky(session.accountId) ||
    !isCanonicalPubky(session.expectedRingGrantIssuer) ||
    session.accountId !== session.expectedRingGrantIssuer
  ) {
    throw new BrowserTransportBoundaryError();
  }
}

function defaultConfig(): BrowserTransportConfig {
  const httpRelay = getDefaultHttpRelay();
  const config: BrowserTransportConfig = {
    clientId: CLIENT_ID,
    httpRelay,
    irohRelays: TRUSTED_IROH_RELAYS,
  };

  if (!getTestnet()) return config;

  let relay: URL;
  try {
    relay = new URL(httpRelay);
  } catch {
    throw new BrowserTransportBoundaryError();
  }
  if (relay.hostname !== '127.0.0.1' && relay.hostname !== '[::1]') {
    throw new BrowserTransportBoundaryError();
  }
  return { ...config, testnet: { enabled: true, pubkyHost: relay.hostname } };
}

/**
 * Epoch-isolated adapter around the pinned pubky2pubky v1 browser artifact.
 *
 * Browser package events are treated as untrusted. The app issuer is attached
 * only after the package has restored or completed a Ring Grant for the exact
 * requested account. Old epoch cleanup owns a distinct browser object and
 * therefore cannot disconnect a replacement session.
 */
export class BrowserPubky2PubkyTransport implements Pubky2PubkyTransport {
  private readonly listeners = new Set<Pubky2PubkyAdapterListener>();
  private readonly entries = new Map<string, BrowserSessionEntry>();

  constructor(
    private readonly configFactory: () => BrowserTransportConfig = defaultConfig,
    private readonly browserFactory: BrowserTransportFactory = createBrowserTransport,
  ) {}

  async initialize(session: Pubky2PubkyTransportSession): Promise<void> {
    validateSession(session);
    if (this.entries.has(session.epoch)) throw new BrowserTransportBoundaryError();

    const config = this.configFactory();
    let entry: BrowserSessionEntry;
    const browserReady = this.browserFactory(config).then(async (browser) => {
      if (!this.isCurrent(entry)) {
        await browser.destroy().catch(() => undefined);
        throw new BrowserTransportBoundaryError();
      }
      entry.browser = browser;
      entry.unsubscribe = browser.subscribe((event) => this.consumeBrowserEvent(entry, event));
      return browser;
    });
    entry = {
      session: { ...session },
      config,
      browserReady,
      browser: null,
      unsubscribe: () => undefined,
      confirmedIdentity: null,
      requestedOutboundPeers: new Set(),
      inboundRequests: new Map(),
      acceptedInboundRequests: new Map(),
      rejectingInboundRequests: new Set(),
      verifiedPeers: new Set(),
      closing: false,
      boundaryFailed: false,
    };
    this.entries.set(session.epoch, entry);

    const browser = await browserReady;
    this.assertCurrentAndHealthy(entry);
    await browser.initialize(session.accountId);
    this.assertCurrentAndHealthy(entry);

    if (entry.confirmedIdentity === null) {
      const identity = await browser.connectWithRing();
      this.assertCurrentAndHealthy(entry);
      if (identity !== entry.confirmedIdentity || identity !== session.accountId) {
        this.failBoundary(entry);
        throw new BrowserTransportBoundaryError();
      }
    }
  }

  subscribe(listener: Pubky2PubkyAdapterListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publishAndGoOnline(session: Pubky2PubkyTransportSession): Promise<void> {
    await this.runOperation(session, 'publish', (browser) => browser.publishAndGoOnline());
  }

  async connect(session: Pubky2PubkyTransportSession, peerId: Pubky): Promise<void> {
    if (!isCanonicalPubky(peerId) || peerId === session.accountId) throw new BrowserTransportBoundaryError();
    const entry = this.requireAuthorizedEntry(session);
    if (
      entry.requestedOutboundPeers.has(peerId) ||
      entry.verifiedPeers.has(peerId) ||
      this.hasAcceptedInboundPeer(entry, peerId)
    ) {
      throw new BrowserTransportBoundaryError();
    }
    entry.requestedOutboundPeers.add(peerId);
    try {
      await this.runOperation(session, 'connect', (browser) => browser.requestConversation(peerId));
    } catch (error) {
      entry.requestedOutboundPeers.delete(peerId);
      if (this.isCurrent(entry) && entry.verifiedPeers.has(peerId)) this.failBoundary(entry);
      throw error;
    }
  }

  async acceptInbound(session: Pubky2PubkyTransportSession, requestId: string): Promise<void> {
    if (!REQUEST_ID.test(requestId) || requestId.length > CHAT_MESSAGE_ID_MAX_LENGTH) {
      throw new BrowserTransportBoundaryError();
    }
    const entry = this.requireAuthorizedEntry(session);
    const peerId = entry.inboundRequests.get(requestId);
    if (
      peerId === undefined ||
      entry.acceptedInboundRequests.has(requestId) ||
      entry.verifiedPeers.has(peerId) ||
      entry.requestedOutboundPeers.has(peerId) ||
      this.hasAcceptedInboundPeer(entry, peerId)
    ) {
      throw new BrowserTransportBoundaryError();
    }
    entry.inboundRequests.delete(requestId);
    entry.acceptedInboundRequests.set(requestId, peerId);
    try {
      await this.runOperation(session, 'accept', (browser) => browser.acceptInbound(requestId));
    } catch (error) {
      const acceptanceStillPending = entry.acceptedInboundRequests.get(requestId) === peerId;
      entry.acceptedInboundRequests.delete(requestId);
      if (this.isCurrent(entry) && entry.verifiedPeers.has(peerId)) {
        this.failBoundary(entry);
      } else if (this.isCurrent(entry) && acceptanceStillPending) {
        entry.inboundRequests.set(requestId, peerId);
      }
      throw error;
    }
  }

  async rejectInbound(session: Pubky2PubkyTransportSession, requestId: string): Promise<void> {
    if (!REQUEST_ID.test(requestId) || requestId.length > CHAT_MESSAGE_ID_MAX_LENGTH) {
      throw new BrowserTransportBoundaryError();
    }
    const entry = this.requireAuthorizedEntry(session);
    if (!entry.inboundRequests.has(requestId) || entry.rejectingInboundRequests.has(requestId)) {
      throw new BrowserTransportBoundaryError();
    }
    entry.rejectingInboundRequests.add(requestId);
    try {
      await this.runOperation(session, 'reject', (browser) => browser.rejectInbound(requestId));
      entry.inboundRequests.delete(requestId);
    } finally {
      entry.rejectingInboundRequests.delete(requestId);
    }
  }

  async sendMessage(session: Pubky2PubkyTransportSession, peerId: Pubky, plaintext: Uint8Array): Promise<void> {
    const entry = this.requireAuthorizedEntry(session);
    if (!entry.verifiedPeers.has(peerId) || !isUint8Array(plaintext)) throw new BrowserTransportBoundaryError();
    const bytes = new Uint8Array(plaintext);
    if (bytes.byteLength === 0 || bytes.byteLength > CHAT_MESSAGE_MAX_BYTES) throw new BrowserTransportBoundaryError();
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (new TextEncoder().encode(decoded).byteLength !== bytes.byteLength) throw new BrowserTransportBoundaryError();
    } catch {
      throw new BrowserTransportBoundaryError();
    }
    await this.runOperation(session, 'send', (browser) => browser.sendMessage(peerId, bytes));
  }

  async disconnect(session: Pubky2PubkyTransportSession): Promise<void> {
    const entry = this.matchingEntry(session);
    if (!entry) return;
    const browser = await entry.browserReady.catch(() => null);
    if (browser && this.isCurrent(entry)) await browser.disconnect();
  }

  async reset(session: Pubky2PubkyTransportSession): Promise<void> {
    const entry = this.matchingEntry(session);
    if (!entry) return;
    this.entries.delete(session.epoch);
    entry.closing = true;
    entry.confirmedIdentity = null;
    this.clearPeerState(entry);
    entry.unsubscribe();
    const browser = await entry.browserReady.catch(() => null);
    if (browser) await browser.destroy();
  }

  private async runOperation(
    session: Pubky2PubkyTransportSession,
    operation: Operation,
    action: (browser: BrowserTransport) => Promise<unknown>,
  ): Promise<void> {
    const entry = this.requireAuthorizedEntry(session);
    const browser = await entry.browserReady;
    this.assertCurrentAndHealthy(entry);
    try {
      await action(browser);
      this.assertCurrentAndHealthy(entry);
    } catch (error) {
      if (this.isCurrent(entry) && entry.confirmedIdentity !== null) {
        this.emit({
          type: 'error',
          epoch: entry.session.epoch,
          ringGrantIssuer: entry.confirmedIdentity,
          operation,
        });
      }
      throw error;
    }
  }

  private consumeBrowserEvent(entry: BrowserSessionEntry, event: unknown): void {
    if (!this.isCurrent(entry) || entry.boundaryFailed) return;
    try {
      this.handleBrowserEvent(entry, event);
    } catch {
      this.failBoundary(entry);
    }
  }

  private handleBrowserEvent(entry: BrowserSessionEntry, event: unknown): void {
    if (!isRecord(event) || typeof event.type !== 'string') throw new BrowserTransportBoundaryError();

    if (event.type === 'unavailable') {
      if (!hasExactKeys(event, ['type', 'code']) || event.code !== 'transport-unavailable') {
        throw new BrowserTransportBoundaryError();
      }
      this.failBoundary(entry);
      return;
    }

    if (event.type === 'auth-required') {
      if (!hasExactKeys(event, ['type', 'authorizationUrl']) || entry.confirmedIdentity !== null) {
        throw new BrowserTransportBoundaryError();
      }
      this.emit({
        type: 'auth-required',
        epoch: entry.session.epoch,
        authorizationUrl: validateAuthorizationUrl(event.authorizationUrl, entry.config),
      });
      return;
    }

    if (event.type === 'identity') {
      if (
        !hasExactKeys(event, ['type', 'identity', 'restored']) ||
        typeof event.identity !== 'string' ||
        !isCanonicalPubky(event.identity) ||
        event.identity !== entry.session.accountId ||
        event.identity !== entry.session.expectedRingGrantIssuer ||
        typeof event.restored !== 'boolean' ||
        (entry.confirmedIdentity !== null && entry.confirmedIdentity !== event.identity)
      ) {
        throw new BrowserTransportBoundaryError();
      }
      entry.confirmedIdentity = event.identity;
      this.emit({
        type: 'identity',
        epoch: entry.session.epoch,
        identity: entry.confirmedIdentity,
        restored: event.restored,
      });
      return;
    }

    if (event.type === 'error') {
      if (
        !hasExactKeys(event, ['type', 'code']) ||
        typeof event.code !== 'string' ||
        !ERROR_CODES.has(event.code as BrowserErrorCode)
      ) {
        throw new BrowserTransportBoundaryError();
      }
      return;
    }

    const issuer = this.requireConfirmedIdentity(entry);

    if (event.type === 'connecting') {
      if (!hasExactKeys(event, event.peerId === undefined ? ['type'] : ['type', 'peerId'])) {
        throw new BrowserTransportBoundaryError();
      }
      if (event.peerId === undefined) {
        this.emit({ type: 'online-state', epoch: entry.session.epoch, ringGrantIssuer: issuer, state: 'publishing' });
        return;
      }
      if (!isCanonicalPubky(event.peerId) || event.peerId === issuer) {
        throw new BrowserTransportBoundaryError();
      }
      this.emit({ type: 'connecting', epoch: entry.session.epoch, ringGrantIssuer: issuer, peerId: event.peerId });
      return;
    }

    if (event.type === 'online-state') {
      if (
        !hasExactKeys(event, ['type', 'online', 'status']) ||
        typeof event.online !== 'boolean' ||
        (event.online && event.status !== 'online') ||
        (!event.online && event.status !== 'offline')
      ) {
        throw new BrowserTransportBoundaryError();
      }
      if (!event.online) this.clearPeerState(entry);
      this.emit({
        type: 'online-state',
        epoch: entry.session.epoch,
        ringGrantIssuer: issuer,
        state: event.online ? 'online' : 'offline',
      });
      return;
    }

    if (event.type === 'inbound-request') {
      if (
        !hasExactKeys(event, ['type', 'id', 'peerId', 'peerDeviceId', 'receivedAt']) ||
        typeof event.id !== 'string' ||
        !REQUEST_ID.test(event.id) ||
        !isCanonicalPubky(event.peerId) ||
        event.peerId === issuer ||
        !isBoundedIdentifier(event.peerDeviceId, 64) ||
        !isLocalTimestamp(event.receivedAt)
      ) {
        throw new BrowserTransportBoundaryError();
      }
      if (
        entry.inboundRequests.has(event.id) ||
        entry.acceptedInboundRequests.has(event.id) ||
        entry.inboundRequests.size + entry.acceptedInboundRequests.size >= MAX_INBOUND_REQUESTS
      ) {
        throw new BrowserTransportBoundaryError();
      }
      entry.inboundRequests.set(event.id, event.peerId);
      this.emit({
        type: 'inbound-request',
        epoch: entry.session.epoch,
        ringGrantIssuer: issuer,
        request: { requestId: event.id, peerId: event.peerId, receivedAt: event.receivedAt },
      });
      return;
    }

    if (event.type === 'inbound-request-expired') {
      if (!hasExactKeys(event, ['type', 'id']) || typeof event.id !== 'string' || !REQUEST_ID.test(event.id)) {
        throw new BrowserTransportBoundaryError();
      }
      entry.inboundRequests.delete(event.id);
      entry.acceptedInboundRequests.delete(event.id);
      entry.rejectingInboundRequests.delete(event.id);
      return;
    }

    if (event.type === 'peer-verified') {
      if (
        !hasExactKeys(event, [
          'type',
          'peerId',
          'peerDeviceId',
          'path',
          'route',
          'e2e',
          'irohQuicEncrypted',
          'pubkyIdentityVerified',
          'protocolVersion',
          'alpn',
        ]) ||
        !isCanonicalPubky(event.peerId) ||
        event.peerId === issuer ||
        !isBoundedIdentifier(event.peerDeviceId, 64) ||
        event.path !== 'relay' ||
        event.route !== 'relay' ||
        event.e2e !== true ||
        event.irohQuicEncrypted !== true ||
        event.pubkyIdentityVerified !== true ||
        event.protocolVersion !== 1 ||
        event.alpn !== V1_ALPN
      ) {
        throw new BrowserTransportBoundaryError();
      }
      if (entry.verifiedPeers.has(event.peerId)) return;
      const outboundAuthorized = entry.requestedOutboundPeers.delete(event.peerId);
      const acceptedRequestId = this.findAcceptedInboundRequest(entry, event.peerId);
      if (!outboundAuthorized && acceptedRequestId === null) throw new BrowserTransportBoundaryError();
      if (acceptedRequestId !== null) entry.acceptedInboundRequests.delete(acceptedRequestId);
      this.removeInboundRequestsForPeer(entry, event.peerId);
      entry.verifiedPeers.add(event.peerId);
      this.emit({
        type: 'peer-verified',
        epoch: entry.session.epoch,
        ringGrantIssuer: issuer,
        peerId: event.peerId,
        route: 'relay',
        protocolVersion: 1,
        irohQuicEncrypted: true,
        pubkyIdentityVerified: true,
      });
      return;
    }

    if (event.type === 'peer-disconnected') {
      if (!hasExactKeys(event, ['type', 'peerId']) || !isCanonicalPubky(event.peerId) || event.peerId === issuer) {
        throw new BrowserTransportBoundaryError();
      }
      entry.requestedOutboundPeers.delete(event.peerId);
      this.removeAcceptedInboundRequestsForPeer(entry, event.peerId);
      this.removeInboundRequestsForPeer(entry, event.peerId);
      entry.verifiedPeers.delete(event.peerId);
      this.emit({
        type: 'peer-disconnected',
        epoch: entry.session.epoch,
        ringGrantIssuer: issuer,
        peerId: event.peerId,
      });
      return;
    }

    if (event.type === 'message') {
      if (
        !hasExactKeys(event, ['type', 'peerId', 'body', 'receivedAt']) ||
        !isCanonicalPubky(event.peerId) ||
        !entry.verifiedPeers.has(event.peerId) ||
        !isUint8Array(event.body) ||
        event.body.byteLength === 0 ||
        event.body.byteLength > CHAT_MESSAGE_MAX_BYTES ||
        !isLocalTimestamp(event.receivedAt)
      ) {
        throw new BrowserTransportBoundaryError();
      }
      const messageId = crypto.randomUUID();
      if (!UUID_V4.test(messageId) || messageId.length > CHAT_MESSAGE_ID_MAX_LENGTH) {
        throw new BrowserTransportBoundaryError();
      }
      this.emit({
        type: 'message',
        epoch: entry.session.epoch,
        ringGrantIssuer: issuer,
        peerId: event.peerId,
        messageId,
        plaintext: new Uint8Array(event.body),
        receivedAt: event.receivedAt,
      });
      return;
    }

    throw new BrowserTransportBoundaryError();
  }

  private requireConfirmedIdentity(entry: BrowserSessionEntry): Pubky {
    this.assertCurrentAndHealthy(entry);
    if (entry.confirmedIdentity === null) throw new BrowserTransportBoundaryError();
    return entry.confirmedIdentity;
  }

  private requireAuthorizedEntry(session: Pubky2PubkyTransportSession): BrowserSessionEntry {
    validateSession(session);
    const entry = this.matchingEntry(session);
    if (!entry) throw new BrowserTransportBoundaryError();
    this.requireConfirmedIdentity(entry);
    return entry;
  }

  private matchingEntry(session: Pubky2PubkyTransportSession): BrowserSessionEntry | null {
    const entry = this.entries.get(session.epoch);
    if (
      !entry ||
      entry.session.accountId !== session.accountId ||
      entry.session.expectedRingGrantIssuer !== session.expectedRingGrantIssuer
    ) {
      return null;
    }
    return entry;
  }

  private isCurrent(entry: BrowserSessionEntry): boolean {
    return !entry.closing && this.entries.get(entry.session.epoch) === entry;
  }

  private assertCurrentAndHealthy(entry: BrowserSessionEntry): void {
    if (!this.isCurrent(entry) || entry.boundaryFailed) throw new BrowserTransportBoundaryError();
  }

  private failBoundary(entry: BrowserSessionEntry): void {
    if (!this.isCurrent(entry) || entry.boundaryFailed) return;
    entry.boundaryFailed = true;
    entry.confirmedIdentity = null;
    this.clearPeerState(entry);
    entry.unsubscribe();
    this.emit({ type: 'unavailable', epoch: entry.session.epoch, reason: 'browser-package-unavailable' });
    if (entry.browser) void entry.browser.destroy().catch(() => undefined);
  }

  private hasAcceptedInboundPeer(entry: BrowserSessionEntry, peerId: Pubky): boolean {
    for (const acceptedPeer of entry.acceptedInboundRequests.values()) {
      if (acceptedPeer === peerId) return true;
    }
    return false;
  }

  private findAcceptedInboundRequest(entry: BrowserSessionEntry, peerId: Pubky): string | null {
    for (const [requestId, acceptedPeer] of entry.acceptedInboundRequests) {
      if (acceptedPeer === peerId) return requestId;
    }
    return null;
  }

  private removeInboundRequestsForPeer(entry: BrowserSessionEntry, peerId: Pubky): void {
    for (const [requestId, pendingPeer] of entry.inboundRequests) {
      if (pendingPeer !== peerId) continue;
      entry.inboundRequests.delete(requestId);
      entry.rejectingInboundRequests.delete(requestId);
    }
  }

  private removeAcceptedInboundRequestsForPeer(entry: BrowserSessionEntry, peerId: Pubky): void {
    for (const [requestId, acceptedPeer] of entry.acceptedInboundRequests) {
      if (acceptedPeer === peerId) entry.acceptedInboundRequests.delete(requestId);
    }
  }

  private clearPeerState(entry: BrowserSessionEntry): void {
    entry.requestedOutboundPeers.clear();
    entry.inboundRequests.clear();
    entry.acceptedInboundRequests.clear();
    entry.rejectingInboundRequests.clear();
    entry.verifiedPeers.clear();
  }

  private emit(output: unknown): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(output);
      } catch {
        // App listener failures cannot alter authenticated transport state.
      }
    }
  }
}
