import { CHAT_MESSAGE_ID_MAX_LENGTH, CHAT_MESSAGE_MAX_BYTES } from '@/config/chat';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';

export type ChatMessageDirection = 'incoming' | 'outgoing';
export type ChatMessageDelivery = 'received' | 'sending' | 'sent' | 'failed';

export interface ChatConversationModelSchema {
  peerId: Pubky;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageModelSchema {
  id: string;
  peerId: Pubky;
  direction: ChatMessageDirection;
  delivery: ChatMessageDelivery;
  body: string;
  createdAt: number;
}

export const chatConversationTableSchema = '&peerId, updatedAt';
export const chatMessageTableSchema = '&id, peerId, createdAt, [peerId+createdAt]';

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isMessageId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= CHAT_MESSAGE_ID_MAX_LENGTH &&
    MESSAGE_ID_PATTERN.test(value)
  );
}

function isMessageBody(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    new TextEncoder().encode(value).byteLength <= CHAT_MESSAGE_MAX_BYTES
  );
}

export function isStoredChatConversation(value: unknown): value is ChatConversationModelSchema {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ChatConversationModelSchema>;
  return (
    typeof record.peerId === 'string' &&
    isPubkyIdentifier(record.peerId) &&
    isTimestamp(record.createdAt) &&
    isTimestamp(record.updatedAt) &&
    record.updatedAt >= record.createdAt
  );
}

export function isStoredChatMessage(value: unknown): value is ChatMessageModelSchema {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ChatMessageModelSchema>;
  if (
    !isMessageId(record.id) ||
    typeof record.peerId !== 'string' ||
    !isPubkyIdentifier(record.peerId) ||
    (record.direction !== 'incoming' && record.direction !== 'outgoing') ||
    !['received', 'sending', 'sent', 'failed'].includes(record.delivery ?? '') ||
    !isMessageBody(record.body) ||
    !isTimestamp(record.createdAt)
  ) {
    return false;
  }

  return record.direction === 'incoming' ? record.delivery === 'received' : record.delivery !== 'received';
}
