import Dexie from 'dexie';
import { CHAT_MAX_CONVERSATIONS, CHAT_MAX_MESSAGES_PER_CONVERSATION } from '@/config/chat';
import { getAccountChatDatabase } from '@/database/chat/chat';
import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  type ChatConversationModelSchema,
  type ChatMessageModelSchema,
  isStoredChatConversation,
  isStoredChatMessage,
} from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';

export class ChatModel {
  private constructor() {}

  static async upsertConversation(accountId: Pubky, peerId: Pubky, timestamp: number): Promise<void> {
    const database = getAccountChatDatabase(accountId);
    try {
      await database.transaction('rw', database.conversations, database.messages, async () => {
        const existing = await database.conversations.get(peerId);
        await database.conversations.put({
          peerId,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
        await this.pruneConversations(database);
      });
    } catch (error) {
      throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Failed to save the local chat conversation.', {
        service: ErrorService.Local,
        operation: 'upsertChatConversation',
        context: { table: 'conversations' },
        cause: error,
      });
    }
  }

  static async findConversations(accountId: Pubky): Promise<ChatConversationModelSchema[]> {
    const database = getAccountChatDatabase(accountId);
    try {
      const rows = await database.conversations.orderBy('updatedAt').reverse().toArray();
      return rows.filter(isStoredChatConversation);
    } catch (error) {
      throw Err.database(DatabaseErrorCode.QUERY_FAILED, 'Failed to read local chat conversations.', {
        service: ErrorService.Local,
        operation: 'findChatConversations',
        context: { table: 'conversations' },
        cause: error,
      });
    }
  }

  static async createMessage(accountId: Pubky, message: ChatMessageModelSchema): Promise<void> {
    const database = getAccountChatDatabase(accountId);
    try {
      await database.transaction('rw', database.conversations, database.messages, async () => {
        const existing = await database.conversations.get(message.peerId);
        await database.conversations.put({
          peerId: message.peerId,
          createdAt: existing?.createdAt ?? message.createdAt,
          updatedAt: message.createdAt,
        });
        await database.messages.add(message);

        const messages = await database.messages
          .where('[peerId+createdAt]')
          .between([message.peerId, Dexie.minKey], [message.peerId, Dexie.maxKey])
          .toArray();
        const overflow = messages.length - CHAT_MAX_MESSAGES_PER_CONVERSATION;
        if (overflow > 0) {
          await database.messages.bulkDelete(messages.slice(0, overflow).map((row) => row.id));
        }

        await this.pruneConversations(database);
      });
    } catch (error) {
      throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Failed to save the local chat message.', {
        service: ErrorService.Local,
        operation: 'createChatMessage',
        context: { table: 'messages' },
        cause: error,
      });
    }
  }

  static async updateMessageDelivery(
    accountId: Pubky,
    messageId: string,
    delivery: ChatMessageModelSchema['delivery'],
  ): Promise<void> {
    const database = getAccountChatDatabase(accountId);
    try {
      await database.messages.update(messageId, { delivery });
    } catch (error) {
      throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Failed to update the local chat message.', {
        service: ErrorService.Local,
        operation: 'updateChatMessageDelivery',
        context: { table: 'messages' },
        cause: error,
      });
    }
  }

  static async findMessages(accountId: Pubky, peerId: Pubky): Promise<ChatMessageModelSchema[]> {
    const database = getAccountChatDatabase(accountId);
    try {
      const rows = await database.messages
        .where('[peerId+createdAt]')
        .between([peerId, Dexie.minKey], [peerId, Dexie.maxKey])
        .toArray();
      return rows.filter(isStoredChatMessage);
    } catch (error) {
      throw Err.database(DatabaseErrorCode.QUERY_FAILED, 'Failed to read local chat messages.', {
        service: ErrorService.Local,
        operation: 'findChatMessages',
        context: { table: 'messages' },
        cause: error,
      });
    }
  }

  static async deleteMessages(accountId: Pubky, peerId: Pubky): Promise<void> {
    const database = getAccountChatDatabase(accountId);
    try {
      await database.messages.where('peerId').equals(peerId).delete();
    } catch (error) {
      throw Err.database(DatabaseErrorCode.DELETE_FAILED, 'Failed to delete the local chat history.', {
        service: ErrorService.Local,
        operation: 'deleteChatMessages',
        context: { table: 'messages' },
        cause: error,
      });
    }
  }

  private static async pruneConversations(database: ReturnType<typeof getAccountChatDatabase>): Promise<void> {
    const conversations = await database.conversations.orderBy('updatedAt').toArray();
    const overflow = conversations.length - CHAT_MAX_CONVERSATIONS;
    if (overflow <= 0) return;

    const expiredPeers = conversations.slice(0, overflow).map((conversation) => conversation.peerId);
    await database.conversations.bulkDelete(expiredPeers);
    for (const peerId of expiredPeers) {
      await database.messages.where('peerId').equals(peerId).delete();
    }
  }
}
