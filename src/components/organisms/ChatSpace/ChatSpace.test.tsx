import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseChatResult } from '@/hooks/useChat/useChat.types';
import { ChatSpace } from './ChatSpace';

const mocks = vi.hoisted(() => ({
  useChat: vi.fn(),
}));

vi.mock('@/hooks/useChat/useChat', () => ({
  useChat: () => mocks.useChat(),
}));

vi.mock('@/hooks/useChatUserSearch/useChatUserSearch', () => ({
  useChatUserSearch: () => ({ results: [], isLoading: false, error: null }),
}));

const ACCOUNT = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
const PEER = 'gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo';

function chatResult(overrides: Partial<UseChatResult> = {}): UseChatResult {
  return {
    currentAccountId: ACCOUNT,
    conversations: [{ peerId: PEER, createdAt: 1, updatedAt: 1 }],
    messages: [],
    selectedPeerId: PEER,
    pendingRequests: [],
    transportState: 'unavailable',
    authorizationRequired: false,
    authorizationUrl: null,
    authorizationCopyStatus: 'idle',
    copyAuthorizationLink: vi.fn().mockResolvedValue(undefined),
    authorizeInRing: vi.fn(),
    verifiedRoute: null,
    selectPeer: vi.fn().mockResolvedValue(undefined),
    publishAndGoOnline: vi.fn().mockResolvedValue(undefined),
    connectSelectedPeer: vi.fn().mockResolvedValue(undefined),
    acceptInbound: vi.fn().mockResolvedValue(undefined),
    rejectInbound: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(true),
    deleteSelectedHistory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ChatSpace', () => {
  beforeEach(() => {
    mocks.useChat.mockReturnValue(chatResult());
  });

  it('keeps message sending disabled before an explicit verified adapter event', () => {
    mocks.useChat.mockReturnValue(chatResult({ transportState: 'online', verifiedRoute: null }));

    render(<ChatSpace />);

    expect(screen.getByTestId('chat-connection-status')).toHaveTextContent('Online · waiting for a peer');
    expect(screen.queryByText('Relayed · E2E encrypted')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('shows the unavailable transport honestly and disables network actions', () => {
    render(<ChatSpace />);

    expect(screen.getByTestId('chat-connection-status')).toHaveTextContent('Transport unavailable');
    expect(screen.getByRole('button', { name: 'Publish & go online' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('opens the scoped Ring flow imperatively without putting its secret URL in the DOM', () => {
    const authorizeInRing = vi.fn();
    mocks.useChat.mockReturnValue(
      chatResult({
        transportState: 'authorizing',
        authorizationRequired: true,
        authorizationUrl: 'pubkyauth://signin_grant?token=test-secret',
        authorizeInRing,
      }),
    );

    const { container } = render(<ChatSpace />);

    const authorize = screen.getByRole('button', { name: 'Open Ring on this device' });
    const panel = screen.getByLabelText('Approve chat in Pubky Ring');
    expect(panel).toHaveAttribute('data-sentry-block');
    expect(panel).toContainElement(authorize);
    const qr = screen.getByRole('img', { name: 'Pubky Ring approval QR code' });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(panel).toContainElement(qr);
    expect(qr.querySelectorAll('path')).toHaveLength(2);
    expect(container.innerHTML).not.toContain('pubkyauth:');
    expect(container.querySelector('[href^="pubkyauth:"]')).not.toBeInTheDocument();
    fireEvent.click(authorize);
    expect(authorizeInRing).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Publish & go online' })).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-connection-status')).toHaveTextContent('Authorize chat in Pubky Ring');
  });

  it('copies only on an explicit click and keeps generic clipboard feedback inside the replay boundary', () => {
    const copyAuthorizationLink = vi.fn().mockResolvedValue(undefined);
    const pending = chatResult({
      transportState: 'authorizing',
      authorizationRequired: true,
      authorizationUrl: 'pubkyauth://signin_grant?token=test-secret',
      copyAuthorizationLink,
    });
    mocks.useChat.mockReturnValue(pending);
    const { rerender } = render(<ChatSpace />);

    const copy = screen.getByRole('button', { name: 'Copy approval link' });
    expect(screen.getByLabelText('Approve chat in Pubky Ring')).toContainElement(copy);
    expect(copyAuthorizationLink).not.toHaveBeenCalled();
    fireEvent.click(copy);
    expect(copyAuthorizationLink).toHaveBeenCalledOnce();

    mocks.useChat.mockReturnValue({ ...pending, authorizationCopyStatus: 'copying' });
    rerender(<ChatSpace />);
    expect(copy).toBeDisabled();
    mocks.useChat.mockReturnValue({ ...pending, authorizationCopyStatus: 'copied' });
    rerender(<ChatSpace />);
    expect(copy).toBeEnabled();
    const feedback = screen.getByRole('status');
    expect(feedback).toHaveTextContent('Approval link copied.');
    expect(screen.getByLabelText('Approve chat in Pubky Ring')).toContainElement(feedback);

    mocks.useChat.mockReturnValue({ ...pending, authorizationCopyStatus: 'failed' });
    rerender(<ChatSpace />);
    expect(feedback).toHaveTextContent('Could not copy the approval link. Scan the QR code instead.');
  });

  it('removes the QR and approval controls when the pending authorization ends', () => {
    mocks.useChat.mockReturnValue(
      chatResult({
        transportState: 'authorizing',
        authorizationRequired: true,
        authorizationUrl: 'pubkyauth://signin_grant?token=test-secret',
      }),
    );
    const { rerender } = render(<ChatSpace />);
    expect(screen.getByRole('img', { name: 'Pubky Ring approval QR code' })).toBeInTheDocument();

    mocks.useChat.mockReturnValue(chatResult({ transportState: 'offline' }));
    rerender(<ChatSpace />);

    expect(screen.queryByLabelText('Approve chat in Pubky Ring')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy approval link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Ring on this device' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish & go online' })).toBeEnabled();
  });

  it('shows the encrypted relay badge and enables composing only after verification', () => {
    mocks.useChat.mockReturnValue(chatResult({ transportState: 'verified', verifiedRoute: 'relay' }));

    render(<ChatSpace />);

    expect(screen.getByTestId('chat-connection-status')).toHaveTextContent('Relayed · E2E encrypted');
    const composer = screen.getByRole('textbox', { name: 'Message' });
    expect(composer).toBeEnabled();
    fireEvent.change(composer, { target: { value: 'hello' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('renders manual accept and decline controls for inbound requests', () => {
    mocks.useChat.mockReturnValue(
      chatResult({
        pendingRequests: [{ requestId: 'request-1', peerId: PEER, receivedAt: 1 }],
      }),
    );

    render(<ChatSpace />);

    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });
});
