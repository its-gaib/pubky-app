'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CHAT_INITIAL_PEER_SESSION_KEY } from '@/config/chat';
import { ChatController } from '@/controllers/chat/chat';
import { clearChatInitialPeerSessionStorage } from '@/libs/chat/chat-session-storage';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import type { ChatConversationModelSchema, ChatMessageModelSchema } from '@/models/chat/chat.schema';
import type { Pubky } from '@/models/models.types';
import { toast } from '@/molecules/Toaster/toast';
import { isVerifiedPubky2PubkyEvent, type Pubky2PubkyRoute } from '@/services/pubky2pubky/pubky2pubky.transport';
import { useAuthStore } from '@/stores/auth/auth.store';
import type { ChatTransportState, UseChatResult } from './useChat.types';

const MAX_PENDING_REQUESTS = 10;

export function useChat(): UseChatResult {
  const accountId = useAuthStore((state) => state.currentUserPubky);
  const session = useAuthStore((state) => state.session);
  const currentAccountId = accountId && isPubkyIdentifier(accountId) ? accountId : null;
  const [selectedPeerId, setSelectedPeerId] = useState<Pubky | null>(null);
  const [pendingRequests, setPendingRequests] = useState<UseChatResult['pendingRequests']>([]);
  const [transportState, setTransportState] = useState<ChatTransportState>('unavailable');
  const [verifiedPeerId, setVerifiedPeerId] = useState<Pubky | null>(null);
  const [verifiedRoute, setVerifiedRoute] = useState<Pubky2PubkyRoute | null>(null);
  const [transportEpoch, setTransportEpoch] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<{
    accountId: Pubky;
    session: typeof session;
    url: string;
  } | null>(null);
  const authorizationRef = useRef<typeof authorization>(null);
  const [authorizationCopy, setAuthorizationCopy] = useState<{
    request: typeof authorization;
    status: UseChatResult['authorizationCopyStatus'];
  } | null>(null);
  const verifiedPeerRef = useRef<Pubky | null>(null);
  const activeAuthorization =
    authorization?.accountId === currentAccountId &&
    authorization?.session === session &&
    transportState === 'authorizing'
      ? authorization
      : null;

  const conversations = useLiveQuery(
    async () => (currentAccountId ? ChatController.getConversations() : []),
    [currentAccountId],
    [] as ChatConversationModelSchema[],
  );
  const messages = useLiveQuery(
    async () => (currentAccountId && selectedPeerId ? ChatController.getMessages(selectedPeerId) : []),
    [currentAccountId, selectedPeerId],
    [] as ChatMessageModelSchema[],
  );

  useEffect(() => {
    setSelectedPeerId(null);
    setPendingRequests([]);
    if (!currentAccountId) {
      clearChatInitialPeerSessionStorage();
      return;
    }

    let initialPeer: string | null = null;
    try {
      initialPeer = window.sessionStorage.getItem(CHAT_INITIAL_PEER_SESSION_KEY);
      clearChatInitialPeerSessionStorage();
    } catch {
      // Ephemeral storage can be blocked; users can still select a peer here.
    }

    if (initialPeer && isPubkyIdentifier(initialPeer) && initialPeer !== currentAccountId) {
      setSelectedPeerId(initialPeer);
      void ChatController.commitCreateConversation(initialPeer).catch(() => {
        toast({ variant: 'error', description: 'Could not open the local conversation.' });
      });
    }
    return clearChatInitialPeerSessionStorage;
  }, [currentAccountId]);

  useEffect(() => {
    setTransportEpoch(null);
    setAuthorization(null);
    authorizationRef.current = null;
    setAuthorizationCopy(null);
    setPendingRequests([]);
    setTransportState('unavailable');
    setVerifiedPeerId(null);
    verifiedPeerRef.current = null;
    setVerifiedRoute(null);
    if (!currentAccountId || !session) return clearChatInitialPeerSessionStorage;

    let active = true;
    let epoch: string;
    try {
      epoch = ChatController.startTransport((event) => {
        if (!active) return;
        if (event.type === 'unavailable') {
          setTransportState('unavailable');
          setAuthorization(null);
          authorizationRef.current = null;
          setAuthorizationCopy(null);
          setVerifiedPeerId(null);
          verifiedPeerRef.current = null;
          setVerifiedRoute(null);
          return;
        }
        if (event.type === 'auth-required') {
          const request = { accountId: currentAccountId, session, url: event.authorizationUrl };
          authorizationRef.current = request;
          setAuthorization(request);
          setAuthorizationCopy(null);
          setTransportState('authorizing');
          setVerifiedPeerId(null);
          verifiedPeerRef.current = null;
          setVerifiedRoute(null);
          return;
        }
        if (event.type === 'identity') {
          setAuthorization(null);
          authorizationRef.current = null;
          setAuthorizationCopy(null);
          setTransportState('offline');
          return;
        }
        if (event.type === 'online-state') {
          setTransportState(event.state);
          if (event.state !== 'online') {
            setVerifiedPeerId(null);
            verifiedPeerRef.current = null;
            setVerifiedRoute(null);
          }
          return;
        }
        if (event.type === 'connecting') {
          setTransportState('connecting');
          return;
        }
        if (event.type === 'inbound-request') {
          setPendingRequests((requests) => {
            const withoutDuplicate = requests.filter((request) => request.requestId !== event.request.requestId);
            return [...withoutDuplicate, event.request].slice(-MAX_PENDING_REQUESTS);
          });
          return;
        }
        if (isVerifiedPubky2PubkyEvent(event)) {
          setVerifiedPeerId(event.peerId);
          verifiedPeerRef.current = event.peerId;
          setVerifiedRoute(event.route);
          setTransportState('verified');
          return;
        }
        if (event.type === 'peer-disconnected' && verifiedPeerRef.current === event.peerId) {
          verifiedPeerRef.current = null;
          setVerifiedPeerId(null);
          setVerifiedRoute(null);
          setTransportState('online');
        }
      });
      setTransportEpoch(epoch);
    } catch {
      active = false;
      setAuthorization(null);
      authorizationRef.current = null;
      setAuthorizationCopy(null);
      setTransportState('unavailable');
      return clearChatInitialPeerSessionStorage;
    }

    return () => {
      active = false;
      authorizationRef.current = null;
      clearChatInitialPeerSessionStorage();
      void ChatController.stopTransport(epoch);
    };
  }, [currentAccountId, session]);

  const selectPeer = async (peerId: Pubky): Promise<void> => {
    if (!currentAccountId || peerId === currentAccountId || !isPubkyIdentifier(peerId)) return;
    await ChatController.commitCreateConversation(peerId);
    setSelectedPeerId(peerId);
  };

  const publishAndGoOnline = async (): Promise<void> => {
    if (!transportEpoch || transportState === 'unavailable' || transportState === 'authorizing') return;
    try {
      await ChatController.publishAndGoOnline(transportEpoch);
    } catch {
      toast({ variant: 'error', description: 'Could not publish the secure chat endpoint.' });
    }
  };

  const authorizeInRing = (): void => {
    if (!activeAuthorization || authorizationRef.current !== activeAuthorization) return;
    window.location.href = activeAuthorization.url;
  };

  const copyAuthorizationLink = async (): Promise<void> => {
    if (!activeAuthorization || authorizationRef.current !== activeAuthorization) return;
    const request = activeAuthorization;
    setAuthorizationCopy({ request, status: 'copying' });
    let status: UseChatResult['authorizationCopyStatus'] = 'failed';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(request.url);
        status = 'copied';
      }
    } catch {
      // Clipboard access may be denied. Never log the approval URI or browser error.
    }
    if (authorizationRef.current === request) {
      setAuthorizationCopy({ request, status });
    }
  };

  const connectSelectedPeer = async (): Promise<void> => {
    if (!transportEpoch || !selectedPeerId || transportState === 'unavailable' || transportState === 'authorizing') {
      return;
    }
    try {
      await ChatController.connect(transportEpoch, selectedPeerId);
    } catch {
      toast({ variant: 'error', description: 'Could not establish a verified peer connection.' });
    }
  };

  const acceptInbound = async (requestId: string, peerId: Pubky): Promise<void> => {
    if (!transportEpoch) return;
    try {
      await ChatController.acceptInbound(transportEpoch, requestId);
      await selectPeer(peerId);
      setPendingRequests((requests) => requests.filter((request) => request.requestId !== requestId));
    } catch {
      toast({ variant: 'error', description: 'Could not accept the connection request.' });
    }
  };

  const rejectInbound = async (requestId: string): Promise<void> => {
    if (!transportEpoch) return;
    try {
      await ChatController.rejectInbound(transportEpoch, requestId);
      setPendingRequests((requests) => requests.filter((request) => request.requestId !== requestId));
    } catch {
      toast({ variant: 'error', description: 'Could not reject the connection request.' });
    }
  };

  const sendMessage = async (body: string): Promise<boolean> => {
    if (!transportEpoch || !selectedPeerId || verifiedPeerId !== selectedPeerId || !verifiedRoute) return false;
    try {
      await ChatController.commitCreateOutgoingMessage(transportEpoch, selectedPeerId, body);
      return true;
    } catch {
      toast({ variant: 'error', description: 'The encrypted message could not be sent.' });
      return false;
    }
  };

  const deleteSelectedHistory = async (): Promise<void> => {
    if (!selectedPeerId) return;
    try {
      await ChatController.commitDeleteHistory(selectedPeerId);
      toast({ description: 'Local chat history deleted.' });
    } catch {
      toast({ variant: 'error', description: 'Could not delete the local chat history.' });
    }
  };

  return {
    currentAccountId,
    conversations,
    messages,
    selectedPeerId,
    pendingRequests,
    transportState,
    authorizationRequired: activeAuthorization !== null,
    authorizationUrl: activeAuthorization?.url ?? null,
    authorizationCopyStatus:
      activeAuthorization && authorizationCopy?.request === activeAuthorization ? authorizationCopy.status : 'idle',
    copyAuthorizationLink,
    authorizeInRing,
    verifiedRoute: verifiedPeerId === selectedPeerId ? verifiedRoute : null,
    selectPeer,
    publishAndGoOnline,
    connectSelectedPeer,
    acceptInbound,
    rejectInbound,
    sendMessage,
    deleteSelectedHistory,
  };
}
