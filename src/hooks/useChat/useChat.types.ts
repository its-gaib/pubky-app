import type { ChatConversationModelSchema, ChatMessageModelSchema } from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';
import type { Pubky2PubkyInboundRequest, Pubky2PubkyRoute } from '@/services/pubky2pubky/pubky2pubky.transport';

export type ChatTransportState =
  | 'unavailable'
  | 'authorizing'
  | 'offline'
  | 'publishing'
  | 'online'
  | 'connecting'
  | 'verified';

export interface UseChatResult {
  currentAccountId: Pubky | null;
  conversations: ChatConversationModelSchema[];
  messages: ChatMessageModelSchema[];
  selectedPeerId: Pubky | null;
  pendingRequests: Pubky2PubkyInboundRequest[];
  transportState: ChatTransportState;
  /** The validated URL remains private to the hook and is never rendered into a DOM attribute. */
  authorizationRequired: boolean;
  authorizeInRing: () => void;
  verifiedRoute: Pubky2PubkyRoute | null;
  selectPeer: (peerId: Pubky) => Promise<void>;
  publishAndGoOnline: () => Promise<void>;
  connectSelectedPeer: () => Promise<void>;
  acceptInbound: (requestId: string, peerId: Pubky) => Promise<void>;
  rejectInbound: (requestId: string) => Promise<void>;
  sendMessage: (body: string) => Promise<boolean>;
  deleteSelectedHistory: () => Promise<void>;
}
