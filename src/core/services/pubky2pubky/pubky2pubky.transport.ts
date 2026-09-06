'use client';

import {
  CHAT_AUTHORIZATION_URL_MAX_LENGTH,
  CHAT_MESSAGE_ID_MAX_LENGTH,
  CHAT_MESSAGE_MAX_BYTES,
  CHAT_TRANSPORT_EPOCH_MAX_LENGTH,
  CHAT_TRANSPORT_MAX_FUTURE_SKEW_MS,
} from '@/config/chat';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';

export type Pubky2PubkyRoute = 'direct' | 'relay';

export interface Pubky2PubkyTransportSession {
  epoch: string;
  accountId: Pubky;
  expectedRingGrantIssuer: Pubky;
}

export interface Pubky2PubkyInboundRequest {
  requestId: string;
  peerId: Pubky;
  receivedAt: number;
}

interface AuthorizedEvent {
  epoch: string;
  ringGrantIssuer: Pubky;
}

export type Pubky2PubkyTransportEvent =
  | { type: 'unavailable'; epoch: string; reason: 'browser-package-unavailable' }
  | { type: 'auth-required'; epoch: string; authorizationUrl: string }
  | { type: 'identity'; epoch: string; identity: Pubky; restored: boolean }
  | (AuthorizedEvent & { type: 'online-state'; state: 'offline' | 'publishing' | 'online' })
  | (AuthorizedEvent & { type: 'connecting'; peerId: Pubky })
  | (AuthorizedEvent & { type: 'inbound-request'; request: Pubky2PubkyInboundRequest })
  | (AuthorizedEvent & {
      type: 'peer-verified';
      peerId: Pubky;
      route: Pubky2PubkyRoute;
      protocolVersion: 1;
      irohQuicEncrypted: true;
      pubkyIdentityVerified: true;
    })
  | (AuthorizedEvent & { type: 'peer-disconnected'; peerId: Pubky })
  | (AuthorizedEvent & { type: 'message'; peerId: Pubky; messageId: string; body: string; receivedAt: number })
  | (AuthorizedEvent & { type: 'error'; operation: 'publish' | 'connect' | 'accept' | 'reject' | 'send' });

export type Pubky2PubkyTransportListener = (event: Pubky2PubkyTransportEvent) => void;
export type Pubky2PubkyAdapterListener = (output: unknown) => void;

/**
 * Client-only boundary for the immutable pubky2pubky v1 browser artifact.
 *
 * Every call is scoped to one account epoch. An adapter MUST derive
 * `ringGrantIssuer` from the signature-verified Ring grant for that epoch; it
 * must never copy the expected issuer into an event without verifying the
 * grant. The app rejects any output whose epoch or issuer does not exactly
 * match the active session.
 *
 * The recipient may receive Iroh QUIC and verify the signed inbound Hello
 * offline before consent. An adapter MUST emit `peer-verified` only after
 * manual acceptance and the v1 mutual live Pubky-authority checks. Only then
 * may application messages flow. Message bytes must never be placed in
 * homeserver resources, URLs, logs, or analytics.
 */
export interface Pubky2PubkyTransport {
  initialize(session: Pubky2PubkyTransportSession): Promise<void>;
  subscribe(listener: Pubky2PubkyAdapterListener): () => void;
  publishAndGoOnline(session: Pubky2PubkyTransportSession): Promise<void>;
  connect(session: Pubky2PubkyTransportSession, peerId: Pubky): Promise<void>;
  acceptInbound(session: Pubky2PubkyTransportSession, requestId: string): Promise<void>;
  rejectInbound(session: Pubky2PubkyTransportSession, requestId: string): Promise<void>;
  sendMessage(session: Pubky2PubkyTransportSession, peerId: Pubky, plaintext: Uint8Array): Promise<void>;
  disconnect(session: Pubky2PubkyTransportSession): Promise<void>;
  reset(session: Pubky2PubkyTransportSession): Promise<void>;
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

function isTimestamp(value: unknown, now: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= now + CHAT_TRANSPORT_MAX_FUTURE_SKEW_MS
  );
}

function decodeMessageBody(value: unknown): string | null {
  if (
    !ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) !== '[object Uint8Array]' ||
    value.byteLength === 0 ||
    value.byteLength > CHAT_MESSAGE_MAX_BYTES
  ) {
    return null;
  }

  try {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return body.trim().length > 0 ? body : null;
  } catch {
    return null;
  }
}

function isSafeRingAuthorizationUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('pubkyauth://') ||
    new TextEncoder().encode(value).byteLength > CHAT_AUTHORIZATION_URL_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'pubkyauth:' &&
      parsed.hostname === 'signin_grant' &&
      parsed.pathname === '' &&
      parsed.port === '' &&
      parsed.search.length > 1 &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

function hasValidEnvelope(
  value: Record<string, unknown>,
  session: Pubky2PubkyTransportSession,
  keys: readonly string[],
): boolean {
  return (
    hasExactKeys(value, keys) &&
    isBoundedIdentifier(value.epoch, CHAT_TRANSPORT_EPOCH_MAX_LENGTH) &&
    value.epoch === session.epoch &&
    typeof value.ringGrantIssuer === 'string' &&
    isPubkyIdentifier(value.ringGrantIssuer) &&
    value.ringGrantIssuer === session.accountId &&
    value.ringGrantIssuer === session.expectedRingGrantIssuer
  );
}

/** Treat adapter output as untrusted until this exhaustive boundary succeeds. */
export function validatePubky2PubkyAdapterOutput(
  output: unknown,
  session: Pubky2PubkyTransportSession,
  now = Date.now(),
): Pubky2PubkyTransportEvent | null {
  if (!isRecord(output) || typeof output.type !== 'string') return null;

  if (output.type === 'unavailable') {
    if (
      !hasExactKeys(output, ['type', 'epoch', 'reason']) ||
      !isBoundedIdentifier(output.epoch, CHAT_TRANSPORT_EPOCH_MAX_LENGTH) ||
      output.epoch !== session.epoch ||
      output.reason !== 'browser-package-unavailable'
    ) {
      return null;
    }
    return { type: 'unavailable', epoch: output.epoch, reason: output.reason };
  }

  if (output.type === 'auth-required') {
    if (
      !hasExactKeys(output, ['type', 'epoch', 'authorizationUrl']) ||
      !isBoundedIdentifier(output.epoch, CHAT_TRANSPORT_EPOCH_MAX_LENGTH) ||
      output.epoch !== session.epoch ||
      !isSafeRingAuthorizationUrl(output.authorizationUrl)
    ) {
      return null;
    }
    return { type: output.type, epoch: output.epoch, authorizationUrl: output.authorizationUrl };
  }

  if (output.type === 'identity') {
    if (
      !hasExactKeys(output, ['type', 'epoch', 'identity', 'restored']) ||
      !isBoundedIdentifier(output.epoch, CHAT_TRANSPORT_EPOCH_MAX_LENGTH) ||
      output.epoch !== session.epoch ||
      typeof output.identity !== 'string' ||
      !isPubkyIdentifier(output.identity) ||
      output.identity !== session.accountId ||
      output.identity !== session.expectedRingGrantIssuer ||
      typeof output.restored !== 'boolean'
    ) {
      return null;
    }
    return { type: output.type, epoch: output.epoch, identity: output.identity, restored: output.restored };
  }

  if (output.type === 'online-state') {
    if (
      !hasValidEnvelope(output, session, ['type', 'epoch', 'ringGrantIssuer', 'state']) ||
      (output.state !== 'offline' && output.state !== 'publishing' && output.state !== 'online')
    ) {
      return null;
    }
    return {
      type: output.type,
      epoch: output.epoch as string,
      ringGrantIssuer: output.ringGrantIssuer as Pubky,
      state: output.state,
    };
  }

  if (output.type === 'connecting' || output.type === 'peer-disconnected') {
    if (
      !hasValidEnvelope(output, session, ['type', 'epoch', 'ringGrantIssuer', 'peerId']) ||
      typeof output.peerId !== 'string' ||
      !isPubkyIdentifier(output.peerId) ||
      output.peerId === session.accountId
    ) {
      return null;
    }
    return {
      type: output.type,
      epoch: output.epoch as string,
      ringGrantIssuer: output.ringGrantIssuer as Pubky,
      peerId: output.peerId,
    };
  }

  if (output.type === 'inbound-request') {
    if (
      !hasValidEnvelope(output, session, ['type', 'epoch', 'ringGrantIssuer', 'request']) ||
      !isRecord(output.request) ||
      !hasExactKeys(output.request, ['requestId', 'peerId', 'receivedAt']) ||
      !isBoundedIdentifier(output.request.requestId, CHAT_MESSAGE_ID_MAX_LENGTH) ||
      typeof output.request.peerId !== 'string' ||
      !isPubkyIdentifier(output.request.peerId) ||
      output.request.peerId === session.accountId ||
      !isTimestamp(output.request.receivedAt, now)
    ) {
      return null;
    }
    return {
      type: output.type,
      epoch: output.epoch as string,
      ringGrantIssuer: output.ringGrantIssuer as Pubky,
      request: {
        requestId: output.request.requestId,
        peerId: output.request.peerId,
        receivedAt: output.request.receivedAt,
      },
    };
  }

  if (output.type === 'peer-verified') {
    if (
      !hasValidEnvelope(output, session, [
        'type',
        'epoch',
        'ringGrantIssuer',
        'peerId',
        'route',
        'protocolVersion',
        'irohQuicEncrypted',
        'pubkyIdentityVerified',
      ]) ||
      typeof output.peerId !== 'string' ||
      !isPubkyIdentifier(output.peerId) ||
      output.peerId === session.accountId ||
      (output.route !== 'direct' && output.route !== 'relay') ||
      output.protocolVersion !== 1 ||
      output.irohQuicEncrypted !== true ||
      output.pubkyIdentityVerified !== true
    ) {
      return null;
    }
    return {
      type: output.type,
      epoch: output.epoch as string,
      ringGrantIssuer: output.ringGrantIssuer as Pubky,
      peerId: output.peerId,
      route: output.route,
      protocolVersion: 1,
      irohQuicEncrypted: true,
      pubkyIdentityVerified: true,
    };
  }

  if (output.type === 'message') {
    if (
      !hasValidEnvelope(output, session, [
        'type',
        'epoch',
        'ringGrantIssuer',
        'peerId',
        'messageId',
        'plaintext',
        'receivedAt',
      ]) ||
      typeof output.peerId !== 'string' ||
      !isPubkyIdentifier(output.peerId) ||
      output.peerId === session.accountId ||
      !isBoundedIdentifier(output.messageId, CHAT_MESSAGE_ID_MAX_LENGTH) ||
      !isTimestamp(output.receivedAt, now)
    ) {
      return null;
    }
    const body = decodeMessageBody(output.plaintext);
    if (body === null) return null;
    return {
      type: output.type,
      epoch: output.epoch as string,
      ringGrantIssuer: output.ringGrantIssuer as Pubky,
      peerId: output.peerId,
      messageId: output.messageId,
      body,
      receivedAt: output.receivedAt,
    };
  }

  if (output.type === 'error') {
    if (
      !hasValidEnvelope(output, session, ['type', 'epoch', 'ringGrantIssuer', 'operation']) ||
      (output.operation !== 'publish' &&
        output.operation !== 'connect' &&
        output.operation !== 'accept' &&
        output.operation !== 'reject' &&
        output.operation !== 'send')
    ) {
      return null;
    }
    return {
      type: output.type,
      epoch: output.epoch as string,
      ringGrantIssuer: output.ringGrantIssuer as Pubky,
      operation: output.operation,
    };
  }

  return null;
}

export function isVerifiedPubky2PubkyEvent(
  event: Pubky2PubkyTransportEvent,
): event is Extract<Pubky2PubkyTransportEvent, { type: 'peer-verified' }> {
  return event.type === 'peer-verified';
}
