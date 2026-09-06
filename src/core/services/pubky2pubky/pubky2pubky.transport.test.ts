import { describe, expect, it } from 'vitest';
import type { Pubky } from '@/models/models.types';
import {
  isVerifiedPubky2PubkyEvent,
  type Pubky2PubkyTransportSession,
  validatePubky2PubkyAdapterOutput,
} from './pubky2pubky.transport';

const ACCOUNT = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy' as Pubky;
const PEER = 'gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo' as Pubky;
const OTHER = 'o4dksfbqk85ogzdb5osziw6befigbuxmuxkuxq8434q89uj56uyy' as Pubky;
const NOW = 1_800_000_000_000;
const SESSION: Pubky2PubkyTransportSession = {
  epoch: 'epoch_1',
  accountId: ACCOUNT,
  expectedRingGrantIssuer: ACCOUNT,
};

const authorized = { epoch: SESSION.epoch, ringGrantIssuer: ACCOUNT };

describe('validatePubky2PubkyAdapterOutput', () => {
  it('surfaces only bounded Pubky Ring auth URLs for the active epoch', () => {
    expect(
      validatePubky2PubkyAdapterOutput(
        { type: 'auth-required', epoch: SESSION.epoch, authorizationUrl: 'pubkyauth://signin_grant?token=test' },
        SESSION,
        NOW,
      ),
    ).toEqual({
      type: 'auth-required',
      epoch: SESSION.epoch,
      authorizationUrl: 'pubkyauth://signin_grant?token=test',
    });

    for (const authorizationUrl of [
      'https://evil.example/authorize',
      'javascript:alert(1)',
      'pubkyauth://signin_grant',
      'pubkyauth://authorize?token=test',
      'pubkyauth://signin_grant/path?token=test',
      'pubkyauth://user:password@signin_grant',
      `pubkyauth://signin_grant#${'a'.repeat(10)}`,
      `pubkyauth://signin_grant?token=${'a'.repeat(2048)}`,
    ]) {
      expect(
        validatePubky2PubkyAdapterOutput(
          { type: 'auth-required', epoch: SESSION.epoch, authorizationUrl },
          SESSION,
          NOW,
        ),
      ).toBeNull();
    }
  });

  it('accepts identity only when it exactly matches the app account and has a real boolean restoration flag', () => {
    expect(
      validatePubky2PubkyAdapterOutput(
        { type: 'identity', epoch: SESSION.epoch, identity: ACCOUNT, restored: false },
        SESSION,
        NOW,
      ),
    ).toEqual({ type: 'identity', epoch: SESSION.epoch, identity: ACCOUNT, restored: false });
    expect(
      validatePubky2PubkyAdapterOutput(
        { type: 'identity', epoch: SESSION.epoch, identity: OTHER, restored: false },
        SESSION,
        NOW,
      ),
    ).toBeNull();
    expect(
      validatePubky2PubkyAdapterOutput(
        { type: 'identity', epoch: SESSION.epoch, identity: ACCOUNT, restored: 'false' },
        SESSION,
        NOW,
      ),
    ).toBeNull();
  });

  it('accepts the complete post-accept v4 identity and Iroh encryption event', () => {
    const event = validatePubky2PubkyAdapterOutput(
      {
        type: 'peer-verified',
        ...authorized,
        peerId: PEER,
        route: 'relay',
        protocolVersion: 4,
        irohQuicEncrypted: true,
        pubkyIdentityVerified: true,
      },
      SESSION,
      NOW,
    );

    expect(event).not.toBeNull();
    expect(event && isVerifiedPubky2PubkyEvent(event)).toBe(true);
  });

  it('rejects wrong epochs, Ring issuers, protocol invariants, fields, IDs, and timestamps', () => {
    const valid = {
      type: 'peer-verified',
      ...authorized,
      peerId: PEER,
      route: 'relay',
      protocolVersion: 4,
      irohQuicEncrypted: true,
      pubkyIdentityVerified: true,
    };
    const invalid = [
      { ...valid, epoch: 'stale_epoch' },
      { ...valid, ringGrantIssuer: OTHER },
      { ...valid, peerId: 'not-a-pubky' },
      { ...valid, route: 'unknown' },
      { ...valid, protocolVersion: 3 },
      { ...valid, irohQuicEncrypted: false },
      { ...valid, pubkyIdentityVerified: false },
      { ...valid, extra: true },
      { type: 'inbound-request', ...authorized, request: { requestId: '', peerId: PEER, receivedAt: NOW } },
      {
        type: 'inbound-request',
        ...authorized,
        request: { requestId: 'request_1', peerId: PEER, receivedAt: NOW + 5 * 60 * 1000 + 1 },
      },
      { type: 'error', ...authorized, operation: 'unknown' },
      { type: 'made-up', ...authorized },
    ];

    for (const output of invalid) {
      expect(validatePubky2PubkyAdapterOutput(output, SESSION, NOW)).toBeNull();
    }
  });

  it('decodes only strict, bounded, non-empty UTF-8 message bytes', () => {
    const valid = {
      type: 'message',
      ...authorized,
      peerId: PEER,
      messageId: 'message_1',
      plaintext: new TextEncoder().encode('hello'),
      receivedAt: NOW,
    };
    expect(validatePubky2PubkyAdapterOutput(valid, SESSION, NOW)).toMatchObject({ body: 'hello' });

    for (const plaintext of [
      new Uint8Array(),
      new Uint8Array([0xc3, 0x28]),
      new TextEncoder().encode('   '),
      new Uint8Array(4097),
      'hello',
    ]) {
      expect(validatePubky2PubkyAdapterOutput({ ...valid, plaintext }, SESSION, NOW)).toBeNull();
    }
  });
});
