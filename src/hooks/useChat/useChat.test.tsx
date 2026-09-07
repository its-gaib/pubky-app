import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Pubky2PubkyTransportEvent,
  Pubky2PubkyTransportListener,
} from '@/services/pubky2pubky/pubky2pubky.transport';
import type { AuthStore } from '@/stores/auth/auth.types';
import { mockSession } from '@/test-utils/pubky';
import { mockAuthStore } from '@/test-utils/stores';
import { useChat } from './useChat';

const mocks = vi.hoisted(() => ({
  startTransport: vi.fn<(listener: Pubky2PubkyTransportListener) => string>(),
  stopTransport: vi.fn().mockResolvedValue(undefined),
  writeText: vi.fn<(value: string) => Promise<void>>(),
}));

let auth = mockAuthStore();
const listeners: Pubky2PubkyTransportListener[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: AuthStore) => unknown) => selector(auth),
}));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));

vi.mock('@/controllers/chat/chat', () => ({
  ChatController: {
    startTransport: mocks.startTransport,
    stopTransport: mocks.stopTransport,
  },
}));

const ACCOUNT = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
const OTHER_ACCOUNT = 'gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo';
const APPROVAL_URL = 'pubkyauth://signin_grant?token=test-secret&caps=%2Fpub%2Fpubky2pubky%2F';
const NEXT_APPROVAL_URL = 'pubkyauth://signin_grant?token=next-test-secret&caps=%2Fpub%2Fpubky2pubky%2F';

function emit(event: Pubky2PubkyTransportEvent): void {
  const listener = listeners.at(-1);
  expect(listener).toBeDefined();
  act(() => listener?.(event));
}

describe('useChat Ring approval', () => {
  beforeEach(() => {
    auth = mockAuthStore({ currentUserPubky: ACCOUNT, session: mockSession() });
    listeners.length = 0;
    mocks.startTransport.mockImplementation((listener) => {
      listeners.push(listener);
      return `epoch-${listeners.length}`;
    });
    mocks.writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.writeText } });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('exposes and copies the exact validated URI only during a pending request and on explicit action', async () => {
    const { result } = renderHook(() => useChat());
    expect(result.current.authorizationUrl).toBeNull();
    await act(() => result.current.copyAuthorizationLink());
    expect(mocks.writeText).not.toHaveBeenCalled();

    emit({ type: 'auth-required', epoch: 'epoch-1', authorizationUrl: APPROVAL_URL });
    expect(result.current.authorizationUrl).toBe(APPROVAL_URL);
    expect(result.current.authorizationRequired).toBe(true);
    expect(mocks.writeText).not.toHaveBeenCalled();

    await act(() => result.current.copyAuthorizationLink());
    expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith(APPROVAL_URL);
    expect(result.current.authorizationCopyStatus).toBe('copied');

    emit({ type: 'identity', epoch: 'epoch-1', identity: ACCOUNT, restored: false });
    expect(result.current.authorizationUrl).toBeNull();
    expect(result.current.authorizationRequired).toBe(false);
    expect(result.current.authorizationCopyStatus).toBe('idle');
    await act(() => result.current.copyAuthorizationLink());
    expect(mocks.writeText).toHaveBeenCalledTimes(1);
  });

  it.each(['unavailable', 'denied'] as const)(
    'handles clipboard %s with a generic failure status',
    async (condition) => {
      if (condition === 'unavailable') {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      } else {
        mocks.writeText.mockRejectedValueOnce(new DOMException('Clipboard denied', 'NotAllowedError'));
      }
      const { result } = renderHook(() => useChat());
      emit({ type: 'auth-required', epoch: 'epoch-1', authorizationUrl: APPROVAL_URL });

      await act(() => result.current.copyAuthorizationLink());

      expect(result.current.authorizationCopyStatus).toBe('failed');
      expect(result.current.authorizationUrl).toBe(APPROVAL_URL);
    },
  );

  it('clears approval data and copy feedback when the transport becomes unavailable', async () => {
    const { result } = renderHook(() => useChat());
    emit({ type: 'auth-required', epoch: 'epoch-1', authorizationUrl: APPROVAL_URL });
    await act(() => result.current.copyAuthorizationLink());

    emit({ type: 'unavailable', epoch: 'epoch-1', reason: 'browser-package-unavailable' });

    expect(result.current.authorizationUrl).toBeNull();
    expect(result.current.authorizationRequired).toBe(false);
    expect(result.current.authorizationCopyStatus).toBe('idle');
  });

  it.each(['account', 'session', 'logout'] as const)(
    'hides the previous URI immediately on a %s change and ignores its old listener',
    (change) => {
      const observedUrls: Array<string | null> = [];
      const { result, rerender } = renderHook(() => {
        const chat = useChat();
        observedUrls.push(chat.authorizationUrl);
        return chat;
      });
      emit({ type: 'auth-required', epoch: 'epoch-1', authorizationUrl: APPROVAL_URL });
      const oldListener = listeners[0];
      if (change === 'account') auth.currentUserPubky = OTHER_ACCOUNT;
      if (change === 'session') auth.session = mockSession();
      if (change === 'logout') auth.session = null;
      observedUrls.length = 0;

      rerender();
      act(() => oldListener({ type: 'auth-required', epoch: 'epoch-1', authorizationUrl: APPROVAL_URL }));

      expect(observedUrls.length).toBeGreaterThan(0);
      expect(observedUrls.every((url) => url === null)).toBe(true);
      expect(result.current.authorizationCopyStatus).toBe('idle');
      expect(mocks.stopTransport).toHaveBeenCalledWith('epoch-1');
    },
  );

  it.each(['request', 'account', 'terminal', 'unmount'] as const)(
    'ignores a pending clipboard completion after the %s changes',
    async (change) => {
      let completeCopy = () => {};
      mocks.writeText.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeCopy = resolve;
          }),
      );
      const { result, rerender, unmount } = renderHook(() => useChat());
      emit({ type: 'auth-required', epoch: 'epoch-1', authorizationUrl: APPROVAL_URL });
      let pendingCopy: Promise<void> | undefined;
      act(() => {
        pendingCopy = result.current.copyAuthorizationLink();
      });
      expect(result.current.authorizationCopyStatus).toBe('copying');

      if (change === 'account') {
        auth.currentUserPubky = OTHER_ACCOUNT;
        rerender();
      }
      if (change === 'request' || change === 'account') {
        emit({
          type: 'auth-required',
          epoch: change === 'account' ? 'epoch-2' : 'epoch-1',
          authorizationUrl: NEXT_APPROVAL_URL,
        });
        mocks.writeText.mockRejectedValueOnce(new DOMException('Clipboard denied', 'NotAllowedError'));
        await act(() => result.current.copyAuthorizationLink());
        expect(result.current.authorizationCopyStatus).toBe('failed');
      } else if (change === 'terminal') {
        emit({ type: 'identity', epoch: 'epoch-1', identity: ACCOUNT, restored: false });
      } else {
        unmount();
      }
      const statusBeforeCompletion = result.current.authorizationCopyStatus;

      await act(async () => {
        completeCopy();
        await pendingCopy;
      });

      expect(result.current.authorizationCopyStatus).toBe(statusBeforeCompletion);
      if (change === 'unmount') expect(mocks.stopTransport).toHaveBeenCalledWith('epoch-1');
    },
  );
});
