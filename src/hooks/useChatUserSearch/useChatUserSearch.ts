'use client';

import { useEffect, useState } from 'react';
import { CHAT_SEARCH_DEBOUNCE_MS, CHAT_SEARCH_RESULT_LIMIT } from '@/config/chat';
import { FileController } from '@/controllers/file/file';
import { SearchController } from '@/controllers/search/search';
import { UserController } from '@/controllers/user/user';
import { formatPublicKey, isPubkyIdentifier } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';
import { ChatValidators } from '@/pipes/chat/chat.validators';
import type { ChatUserSearchResult, UseChatUserSearchResult } from './useChatUserSearch.types';

function fallbackResult(id: Pubky): ChatUserSearchResult {
  return {
    id,
    name: formatPublicKey({ key: id }),
    hasIndexedProfile: false,
  };
}

export function useChatUserSearch(query: string, currentAccountId: string | null): UseChatUserSearchResult {
  const [results, setResults] = useState<ChatUserSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalizedQuery = ChatValidators.normalizeSearchQuery(query);
    if (!normalizedQuery) {
      setResults([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const directPeer =
      isPubkyIdentifier(normalizedQuery) && normalizedQuery !== currentAccountId ? normalizedQuery : null;
    if (directPeer) setResults([fallbackResult(directPeer)]);
    setIsLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        const [byName, byId] = await Promise.all([
          SearchController.getUsersByName({ prefix: normalizedQuery, limit: CHAT_SEARCH_RESULT_LIMIT }),
          SearchController.fetchUsersById({ prefix: normalizedQuery, limit: CHAT_SEARCH_RESULT_LIMIT }),
        ]);
        if (cancelled) return;

        const uniqueIds = Array.from(new Set([...(directPeer ? [directPeer] : []), ...byName, ...byId]))
          .filter((id): id is Pubky => isPubkyIdentifier(id) && id !== currentAccountId)
          .slice(0, CHAT_SEARCH_RESULT_LIMIT);

        const resolved = await Promise.all(
          uniqueIds.map(async (id): Promise<ChatUserSearchResult> => {
            try {
              const details = await UserController.getOrFetchDetails({ userId: id });
              if (!details) return fallbackResult(id);
              return {
                id,
                name: details.name || formatPublicKey({ key: id }),
                avatarUrl: details.image ? FileController.getAvatarUrl(id, details.indexed_at) : undefined,
                hasIndexedProfile: true,
              };
            } catch {
              return fallbackResult(id);
            }
          }),
        );

        if (!cancelled) setResults(resolved);
      } catch {
        if (!cancelled) {
          setResults(directPeer ? [fallbackResult(directPeer)] : []);
          setError('User search is temporarily unavailable. You can still enter a complete Pubky ID.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, CHAT_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentAccountId, query]);

  return { results, isLoading, error };
}
