'use client';

import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';
import { BrowserPubky2PubkyTransport } from '@/services/pubky2pubky/pubky2pubky.browser';
import {
  type Pubky2PubkyTransport,
  type Pubky2PubkyTransportListener,
  type Pubky2PubkyTransportSession,
  validatePubky2PubkyAdapterOutput,
} from '@/services/pubky2pubky/pubky2pubky.transport';

function inactiveSessionError(operation: string) {
  return Err.auth(AuthErrorCode.SESSION_EXPIRED, 'The secure chat session is no longer active.', {
    service: ErrorService.Local,
    operation,
  });
}

interface ActiveSession {
  session: Pubky2PubkyTransportSession;
  listener: Pubky2PubkyTransportListener;
  unsubscribe: () => void;
  verifiedPeers: Set<Pubky>;
  identityVerified: boolean;
}

export interface StartPubky2PubkySessionInput {
  accountId: Pubky;
  ringGrantIssuer: Pubky;
}

/** Owns the one browser transport session and rejects all stale adapter output. */
export class Pubky2PubkyService {
  private active: ActiveSession | null = null;

  constructor(private readonly transport: Pubky2PubkyTransport = new BrowserPubky2PubkyTransport()) {}

  startSession(input: StartPubky2PubkySessionInput, listener: Pubky2PubkyTransportListener): string {
    if (
      !isPubkyIdentifier(input.accountId) ||
      !isPubkyIdentifier(input.ringGrantIssuer) ||
      input.accountId !== input.ringGrantIssuer
    ) {
      throw Err.auth(AuthErrorCode.UNAUTHORIZED, 'The Ring grant issuer does not match the active account.', {
        service: ErrorService.Local,
        operation: 'startPubky2PubkySession',
      });
    }

    const previous = this.detachActive();
    if (previous) void this.teardown(previous.session);

    const session: Pubky2PubkyTransportSession = {
      epoch: crypto.randomUUID(),
      accountId: input.accountId,
      expectedRingGrantIssuer: input.ringGrantIssuer,
    };
    const active: ActiveSession = {
      session,
      listener,
      unsubscribe: () => undefined,
      verifiedPeers: new Set(),
      identityVerified: false,
    };
    this.active = active;
    active.unsubscribe = this.transport.subscribe((output) => this.consumeAdapterOutput(session.epoch, output));

    void this.transport.initialize(session).catch(() => {
      if (!this.isActiveSession(session.epoch, session.accountId)) return;
      listener({ type: 'unavailable', epoch: session.epoch, reason: 'browser-package-unavailable' });
    });
    return session.epoch;
  }

  isActiveSession(epoch: string, accountId: Pubky): boolean {
    return this.active?.session.epoch === epoch && this.active.session.accountId === accountId;
  }

  assertActiveSession(epoch: string, accountId: Pubky): void {
    if (!this.isActiveSession(epoch, accountId) || !this.active?.identityVerified) {
      throw inactiveSessionError('assertPubky2PubkySession');
    }
  }

  async stopSession(epoch: string): Promise<void> {
    if (this.active?.session.epoch !== epoch) return;
    const detached = this.detachActive();
    if (detached) await this.teardown(detached.session);
  }

  async resetActiveSession(): Promise<void> {
    const detached = this.detachActive();
    if (detached) await this.teardown(detached.session);
  }

  async publishAndGoOnline(epoch: string): Promise<void> {
    await this.transport.publishAndGoOnline(this.requireActive(epoch, 'publishPubky2PubkyDirectory'));
  }

  async connect(epoch: string, peerId: Pubky): Promise<void> {
    await this.transport.connect(this.requireActive(epoch, 'connectPubky2PubkyPeer'), peerId);
  }

  async acceptInbound(epoch: string, requestId: string): Promise<void> {
    await this.transport.acceptInbound(this.requireActive(epoch, 'acceptPubky2PubkyInbound'), requestId);
  }

  async rejectInbound(epoch: string, requestId: string): Promise<void> {
    await this.transport.rejectInbound(this.requireActive(epoch, 'rejectPubky2PubkyInbound'), requestId);
  }

  async sendMessage(epoch: string, peerId: Pubky, plaintext: Uint8Array): Promise<void> {
    const active = this.active;
    const session = this.requireActive(epoch, 'sendPubky2PubkyMessage');
    if (!active?.verifiedPeers.has(peerId)) {
      throw Err.auth(AuthErrorCode.FORBIDDEN, 'The peer has not completed v1 identity verification.', {
        service: ErrorService.Local,
        operation: 'sendPubky2PubkyMessage',
      });
    }
    await this.transport.sendMessage(session, peerId, plaintext);
  }

  private consumeAdapterOutput(epoch: string, output: unknown): void {
    const active = this.active;
    if (!active || active.session.epoch !== epoch) return;
    const event = validatePubky2PubkyAdapterOutput(output, active.session);
    if (!event || this.active !== active) return;
    if (event.type === 'unavailable') {
      active.identityVerified = false;
      active.verifiedPeers.clear();
      active.listener(event);
      return;
    }
    if (event.type === 'auth-required') {
      active.identityVerified = false;
      active.verifiedPeers.clear();
      active.listener(event);
      return;
    }
    if (event.type === 'identity') {
      active.identityVerified = true;
      active.listener(event);
      return;
    }
    if (!active.identityVerified) return;
    if (event.type === 'peer-verified') active.verifiedPeers.add(event.peerId);
    if (event.type === 'peer-disconnected') active.verifiedPeers.delete(event.peerId);
    if (event.type === 'online-state' && event.state !== 'online') active.verifiedPeers.clear();
    if (event.type === 'message' && !active.verifiedPeers.has(event.peerId)) return;
    active.listener(event);
  }

  private requireActive(epoch: string, operation: string): Pubky2PubkyTransportSession {
    if (!this.active || this.active.session.epoch !== epoch || !this.active.identityVerified) {
      throw inactiveSessionError(operation);
    }
    return this.active.session;
  }

  private detachActive(): ActiveSession | null {
    const active = this.active;
    this.active = null;
    active?.unsubscribe();
    return active;
  }

  private async teardown(session: Pubky2PubkyTransportSession): Promise<void> {
    try {
      await this.transport.disconnect(session);
    } catch {
      // The epoch is already invalidated locally; cleanup must continue.
    }
    try {
      await this.transport.reset(session);
    } catch {
      // Never allow an adapter cleanup failure to retain app listeners/state.
    }
  }
}

export const pubky2PubkyService = new Pubky2PubkyService();
