'use client';

import { useRouter } from 'next/navigation';
import { APP_ROUTES } from '@/app/routes';
import { CHAT_INITIAL_PEER_SESSION_KEY } from '@/config/chat';
import { useRequireAuth } from '@/hooks/useRequireAuth/useRequireAuth';
import { isPubkyIdentifier } from '@/libs/utils/utils';

export function useStartChat() {
  const router = useRouter();
  const { requireAuth } = useRequireAuth();

  const startChat = (peerId: string): void => {
    if (!isPubkyIdentifier(peerId)) return;

    requireAuth(() => {
      try {
        window.sessionStorage.setItem(CHAT_INITIAL_PEER_SESSION_KEY, peerId);
      } catch {
        // The chat page remains usable if ephemeral storage is unavailable.
      }
      router.push(APP_ROUTES.CHAT);
    });
  };

  return { startChat };
}
