import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_INITIAL_PEER_SESSION_KEY } from '@/config/chat';
import { useStartChat } from './useStartChat';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  requireAuth: vi.fn((action: () => void) => action()),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ isAuthenticated: true, requireAuth: mocks.requireAuth }),
}));

const PEER = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';

describe('useStartChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('auth-gates and transfers a canonical peer through sessionStorage without a URL parameter', () => {
    const { result } = renderHook(() => useStartChat());

    act(() => result.current.startChat(PEER));

    expect(mocks.requireAuth).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHAT_INITIAL_PEER_SESSION_KEY)).toBe(PEER);
    expect(mocks.push).toHaveBeenCalledWith('/chat');
  });

  it('ignores non-canonical identifiers before invoking auth', () => {
    const { result } = renderHook(() => useStartChat());

    act(() => result.current.startChat(`pubky${PEER}`));

    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(CHAT_INITIAL_PEER_SESSION_KEY)).toBeNull();
  });
});
