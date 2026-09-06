import type { ChatConversationModelSchema, ChatMessageModelSchema } from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';
import { LocalChatService } from '@/services/local/chat/chat';
import { pubky2PubkyService } from '@/services/pubky2pubky/pubky2pubky';
import type {
  Pubky2PubkyTransportEvent,
  Pubky2PubkyTransportListener,
} from '@/services/pubky2pubky/pubky2pubky.transport';

export class ChatApplication {
  private constructor() {}

  static async getConversations(accountId: Pubky): Promise<ChatConversationModelSchema[]> {
    return LocalChatService.readConversations(accountId);
  }

  static async getMessages(accountId: Pubky, peerId: Pubky): Promise<ChatMessageModelSchema[]> {
    return LocalChatService.readMessages(accountId, peerId);
  }

  static async commitCreateConversation(accountId: Pubky, peerId: Pubky): Promise<void> {
    await LocalChatService.upsertConversation(accountId, peerId, Date.now());
  }

  static async commitDeleteHistory(accountId: Pubky, peerId: Pubky): Promise<void> {
    await LocalChatService.deleteMessages(accountId, peerId);
  }

  static async commitCreateOutgoingMessage(
    accountId: Pubky,
    epoch: string,
    peerId: Pubky,
    id: string,
    body: string,
  ): Promise<void> {
    pubky2PubkyService.assertActiveSession(epoch, accountId);
    const message: ChatMessageModelSchema = {
      id,
      peerId,
      body,
      direction: 'outgoing',
      delivery: 'sending',
      createdAt: Date.now(),
    };

    await LocalChatService.createMessage(accountId, message);
    try {
      await pubky2PubkyService.sendMessage(epoch, peerId, new TextEncoder().encode(body));
      await LocalChatService.updateMessageDelivery(accountId, id, 'sent');
    } catch (error) {
      await LocalChatService.updateMessageDelivery(accountId, id, 'failed');
      throw error;
    }
  }

  static startTransport(accountId: Pubky, ringGrantIssuer: Pubky, listener: Pubky2PubkyTransportListener): string {
    return pubky2PubkyService.startSession({ accountId, ringGrantIssuer }, (event) => {
      if (event.type !== 'message') {
        listener(event);
        return;
      }
      void this.persistInboundMessage(accountId, event, listener).catch(() => {
        // Local persistence errors are reported by the model; never expose message content here.
      });
    });
  }

  static stopTransport(epoch: string): Promise<void> {
    return pubky2PubkyService.stopSession(epoch);
  }

  static resetTransport(): Promise<void> {
    return pubky2PubkyService.resetActiveSession();
  }

  static publishAndGoOnline(epoch: string): Promise<void> {
    return pubky2PubkyService.publishAndGoOnline(epoch);
  }

  static connect(epoch: string, peerId: Pubky): Promise<void> {
    return pubky2PubkyService.connect(epoch, peerId);
  }

  static acceptInbound(epoch: string, requestId: string): Promise<void> {
    return pubky2PubkyService.acceptInbound(epoch, requestId);
  }

  static rejectInbound(epoch: string, requestId: string): Promise<void> {
    return pubky2PubkyService.rejectInbound(epoch, requestId);
  }

  private static async persistInboundMessage(
    accountId: Pubky,
    event: Extract<Pubky2PubkyTransportEvent, { type: 'message' }>,
    listener: Pubky2PubkyTransportListener,
  ): Promise<void> {
    if (!pubky2PubkyService.isActiveSession(event.epoch, accountId)) return;
    await LocalChatService.createMessage(accountId, {
      id: event.messageId,
      peerId: event.peerId,
      body: event.body,
      direction: 'incoming',
      delivery: 'received',
      createdAt: event.receivedAt,
    });
    if (pubky2PubkyService.isActiveSession(event.epoch, accountId)) listener(event);
  }
}
