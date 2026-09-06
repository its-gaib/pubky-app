import Dexie, { type Table } from 'dexie';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import {
  type ChatConversationModelSchema,
  chatConversationTableSchema,
  type ChatMessageModelSchema,
  chatMessageTableSchema,
} from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';

const CHAT_DATABASE_PREFIX = 'pubky-app-pubky2pubky-chat-v1';
const CHAT_DATABASE_CACHE_LIMIT = 4;

export class ChatDatabase extends Dexie {
  conversations!: Table<ChatConversationModelSchema, Pubky>;
  messages!: Table<ChatMessageModelSchema, string>;

  constructor(accountId: Pubky) {
    if (!isPubkyIdentifier(accountId)) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Chat database account identifier is invalid.', {
        service: ErrorService.Local,
        operation: 'createChatDatabase',
      });
    }

    super(`${CHAT_DATABASE_PREFIX}-${accountId}`);
    this.version(1).stores({
      conversations: chatConversationTableSchema,
      messages: chatMessageTableSchema,
    });
  }
}

const databases = new Map<Pubky, ChatDatabase>();

export function getAccountChatDatabase(accountId: Pubky): ChatDatabase {
  const cached = databases.get(accountId);
  if (cached) {
    databases.delete(accountId);
    databases.set(accountId, cached);
    return cached;
  }

  const database = new ChatDatabase(accountId);
  databases.set(accountId, database);

  if (databases.size > CHAT_DATABASE_CACHE_LIMIT) {
    const oldestAccountId = databases.keys().next().value;
    if (oldestAccountId) {
      databases.get(oldestAccountId)?.close();
      databases.delete(oldestAccountId);
    }
  }

  return database;
}

export function closeAccountChatDatabase(accountId: Pubky): void {
  databases.get(accountId)?.close();
  databases.delete(accountId);
}
