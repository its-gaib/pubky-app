import type { Pubky } from '@/models/models.types';

export interface ChatUserSearchResult {
  id: Pubky;
  name: string;
  avatarUrl?: string;
  hasIndexedProfile: boolean;
}

export interface UseChatUserSearchResult {
  results: ChatUserSearchResult[];
  isLoading: boolean;
  error: string | null;
}
