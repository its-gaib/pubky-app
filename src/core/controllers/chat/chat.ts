import { ChatApplication } from '@/application/chat/chat';
import type { ChatConversationModelSchema, ChatMessageModelSchema } from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';
import { ChatValidators } from '@/pipes/chat/chat.validators';
import type { Pubky2PubkyTransportListener } from '@/services/pubky2pubky/pubky2pubky.transport';
import { useAuthStore } from '@/stores/auth/auth.store';

function currentAccountId(): Pubky {
  return ChatValidators.validatePubky(useAuthStore.getState().selectCurrentUserPubky());
}

function currentTransportIdentity(): { accountId: Pubky; ringGrantIssuer: Pubky } {
  const auth = useAuthStore.getState();
  const accountId = ChatValidators.validatePubky(auth.selectCurrentUserPubky());
  const session = auth.selectSession();
  const ringGrantIssuer = ChatValidators.validatePubky(session?.info.publicKey.z32() ?? '');
  return { accountId, ringGrantIssuer };
}

export class ChatController {
  private constructor() {}

  static async getConversations(): Promise<ChatConversationModelSchema[]> {
    return ChatApplication.getConversations(currentAccountId());
  }

  static async getMessages(peerId: string): Promise<ChatMessageModelSchema[]> {
    return ChatApplication.getMessages(currentAccountId(), ChatValidators.validatePubky(peerId));
  }

  static async commitCreateConversation(peerId: string): Promise<void> {
    await ChatApplication.commitCreateConversation(currentAccountId(), ChatValidators.validatePubky(peerId));
  }

  static async commitDeleteHistory(peerId: string): Promise<void> {
    await ChatApplication.commitDeleteHistory(currentAccountId(), ChatValidators.validatePubky(peerId));
  }

  static async commitCreateOutgoingMessage(epoch: string, peerId: string, body: string): Promise<void> {
    const id = crypto.randomUUID();
    await ChatApplication.commitCreateOutgoingMessage(
      currentAccountId(),
      epoch,
      ChatValidators.validatePubky(peerId),
      ChatValidators.validateMessageId(id),
      ChatValidators.validateMessageBody(body),
    );
  }

  static startTransport(listener: Pubky2PubkyTransportListener): string {
    const identity = currentTransportIdentity();
    return ChatApplication.startTransport(identity.accountId, identity.ringGrantIssuer, listener);
  }

  static async stopTransport(epoch: string): Promise<void> {
    await ChatApplication.stopTransport(epoch);
  }

  static async publishAndGoOnline(epoch: string): Promise<void> {
    await ChatApplication.publishAndGoOnline(epoch);
  }

  static async connect(epoch: string, peerId: string): Promise<void> {
    await ChatApplication.connect(epoch, ChatValidators.validatePubky(peerId));
  }

  static async acceptInbound(epoch: string, requestId: string): Promise<void> {
    await ChatApplication.acceptInbound(epoch, ChatValidators.validateMessageId(requestId));
  }

  static async rejectInbound(epoch: string, requestId: string): Promise<void> {
    await ChatApplication.rejectInbound(epoch, ChatValidators.validateMessageId(requestId));
  }
}
