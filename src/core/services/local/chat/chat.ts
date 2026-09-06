import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import { ChatModel } from '@/models/chat/chat';
import type { ChatConversationModelSchema, ChatMessageModelSchema } from '@/models/chat/chat.schema';
import { isStoredChatMessage } from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';

export class LocalChatService {
  private constructor() {}

  private static validateParticipants(accountId: Pubky, peerId: Pubky): void {
    if (!isPubkyIdentifier(accountId) || !isPubkyIdentifier(peerId) || accountId === peerId) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Invalid local chat participants.', {
        service: ErrorService.Local,
        operation: 'validateLocalChatParticipants',
      });
    }
  }

  static async upsertConversation(accountId: Pubky, peerId: Pubky, timestamp: number): Promise<void> {
    this.validateParticipants(accountId, peerId);
    await ChatModel.upsertConversation(accountId, peerId, timestamp);
  }

  static async readConversations(accountId: Pubky): Promise<ChatConversationModelSchema[]> {
    return ChatModel.findConversations(accountId);
  }

  static async createMessage(accountId: Pubky, message: ChatMessageModelSchema): Promise<void> {
    this.validateParticipants(accountId, message.peerId);
    if (!isStoredChatMessage(message)) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Invalid local chat message record.', {
        service: ErrorService.Local,
        operation: 'validateLocalChatMessage',
      });
    }
    await ChatModel.createMessage(accountId, message);
  }

  static async updateMessageDelivery(
    accountId: Pubky,
    messageId: string,
    delivery: ChatMessageModelSchema['delivery'],
  ): Promise<void> {
    await ChatModel.updateMessageDelivery(accountId, messageId, delivery);
  }

  static async readMessages(accountId: Pubky, peerId: Pubky): Promise<ChatMessageModelSchema[]> {
    this.validateParticipants(accountId, peerId);
    return ChatModel.findMessages(accountId, peerId);
  }

  static async deleteMessages(accountId: Pubky, peerId: Pubky): Promise<void> {
    this.validateParticipants(accountId, peerId);
    await ChatModel.deleteMessages(accountId, peerId);
  }
}
