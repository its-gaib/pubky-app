import { CHAT_INITIAL_PEER_SESSION_KEY } from '@/config/chat';

export function clearChatInitialPeerSessionStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHAT_INITIAL_PEER_SESSION_KEY);
  } catch {
    // Ephemeral browser storage may be unavailable; there is nothing else to clear.
  }
}
