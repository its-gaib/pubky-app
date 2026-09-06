import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_MAX_MESSAGES_PER_CONVERSATION, CHAT_MESSAGE_MAX_BYTES } from '@/config/chat';
import { closeAccountChatDatabase, getAccountChatDatabase } from '@/database/chat/chat';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import type { Pubky } from '@/models/models.types';
import { LocalChatService } from './chat';

const ACCOUNT_A = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy' as Pubky;
const ACCOUNT_B = 'gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo' as Pubky;
const PEER = '1234567890123456789012345678901234567890123456789012' as Pubky;

async function deleteAccountDatabase(accountId: Pubky): Promise<void> {
  const database = getAccountChatDatabase(accountId);
  await database.delete();
  closeAccountChatDatabase(accountId);
}

describe('LocalChatService', () => {
  beforeEach(async () => {
    globalThis.indexedDB = indexedDB;
    globalThis.IDBKeyRange = IDBKeyRange;
    await Promise.all([deleteAccountDatabase(ACCOUNT_A), deleteAccountDatabase(ACCOUNT_B)]);
  });

  afterEach(async () => {
    await Promise.all([deleteAccountDatabase(ACCOUNT_A), deleteAccountDatabase(ACCOUNT_B)]);
  });

  it('partitions conversations and messages by signed-in account', async () => {
    await LocalChatService.upsertConversation(ACCOUNT_A, PEER, 1);
    await LocalChatService.createMessage(ACCOUNT_A, {
      id: 'message-a',
      peerId: PEER,
      body: 'Only account A can read this',
      direction: 'outgoing',
      delivery: 'sent',
      createdAt: 2,
    });

    expect(await LocalChatService.readConversations(ACCOUNT_A)).toHaveLength(1);
    expect(await LocalChatService.readMessages(ACCOUNT_A, PEER)).toHaveLength(1);
    expect(await LocalChatService.readConversations(ACCOUNT_B)).toEqual([]);
    expect(await LocalChatService.readMessages(ACCOUNT_B, PEER)).toEqual([]);
  });

  it('keeps only the newest bounded number of messages per conversation', async () => {
    for (let index = 0; index <= CHAT_MAX_MESSAGES_PER_CONVERSATION; index += 1) {
      await LocalChatService.createMessage(ACCOUNT_A, {
        id: `message-${index}`,
        peerId: PEER,
        body: `message ${index}`,
        direction: 'outgoing',
        delivery: 'sent',
        createdAt: index + 1,
      });
    }

    const messages = await LocalChatService.readMessages(ACCOUNT_A, PEER);
    expect(messages).toHaveLength(CHAT_MAX_MESSAGES_PER_CONVERSATION);
    expect(messages[0]?.id).toBe('message-1');
    expect(messages.at(-1)?.id).toBe(`message-${CHAT_MAX_MESSAGES_PER_CONVERSATION}`);
  });

  it('rejects oversized plaintext before it reaches IndexedDB', async () => {
    await expect(
      LocalChatService.createMessage(ACCOUNT_A, {
        id: 'oversized-message',
        peerId: PEER,
        body: 'a'.repeat(CHAT_MESSAGE_MAX_BYTES + 1),
        direction: 'outgoing',
        delivery: 'sent',
        createdAt: 1,
      }),
    ).rejects.toMatchObject({ code: ValidationErrorCode.INVALID_INPUT });

    expect(await LocalChatService.readMessages(ACCOUNT_A, PEER)).toEqual([]);
  });
});
