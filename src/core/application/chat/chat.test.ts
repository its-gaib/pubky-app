import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pubky } from '@/models/models.types';
import { LocalChatService } from '@/services/local/chat/chat';
import { pubky2PubkyService } from '@/services/pubky2pubky/pubky2pubky';
import type { Pubky2PubkyTransportListener } from '@/services/pubky2pubky/pubky2pubky.transport';
import { ChatApplication } from './chat';

vi.mock('@/services/pubky2pubky/pubky2pubky', () => ({
  pubky2PubkyService: {
    startSession: vi.fn(),
    isActiveSession: vi.fn(),
    assertActiveSession: vi.fn(),
    stopSession: vi.fn(),
    resetActiveSession: vi.fn(),
    publishAndGoOnline: vi.fn(),
    connect: vi.fn(),
    acceptInbound: vi.fn(),
    rejectInbound: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

const ACCOUNT = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy' as Pubky;
const PEER = 'gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo' as Pubky;
const EPOCH = 'epoch_1';

describe('ChatApplication inbound persistence', () => {
  let transportListener: Pubky2PubkyTransportListener = () => undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pubky2PubkyService.startSession).mockImplementation((_input, listener) => {
      transportListener = listener;
      return EPOCH;
    });
    vi.mocked(pubky2PubkyService.isActiveSession).mockReturnValue(true);
  });

  it('persists a validated inbound event to its bound account before surfacing it', async () => {
    const createMessage = vi.spyOn(LocalChatService, 'createMessage').mockResolvedValue(undefined);
    const uiListener = vi.fn();
    ChatApplication.startTransport(ACCOUNT, ACCOUNT, uiListener);

    transportListener({
      type: 'message',
      epoch: EPOCH,
      ringGrantIssuer: ACCOUNT,
      peerId: PEER,
      messageId: 'message_1',
      body: 'secret text',
      receivedAt: 123,
    });

    await vi.waitFor(() => expect(uiListener).toHaveBeenCalledOnce());
    expect(createMessage).toHaveBeenCalledWith(ACCOUNT, {
      id: 'message_1',
      peerId: PEER,
      body: 'secret text',
      direction: 'incoming',
      delivery: 'received',
      createdAt: 123,
    });
    expect(createMessage.mock.invocationCallOrder[0]).toBeLessThan(uiListener.mock.invocationCallOrder[0]!);
  });

  it('does not persist an inbound event after its account epoch is no longer active', async () => {
    const createMessage = vi.spyOn(LocalChatService, 'createMessage').mockResolvedValue(undefined);
    vi.mocked(pubky2PubkyService.isActiveSession).mockReturnValue(false);
    ChatApplication.startTransport(ACCOUNT, ACCOUNT, vi.fn());

    transportListener({
      type: 'message',
      epoch: EPOCH,
      ringGrantIssuer: ACCOUNT,
      peerId: PEER,
      messageId: 'stale_message',
      body: 'must not cross accounts',
      receivedAt: 123,
    });
    await Promise.resolve();

    expect(createMessage).not.toHaveBeenCalled();
  });
});
