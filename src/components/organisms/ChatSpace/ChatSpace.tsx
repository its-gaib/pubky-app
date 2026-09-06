'use client';

import { useState } from 'react';
import { Check, Loader2, MessageCircle, Radio, Search, Send, ShieldCheck, Trash2, UserRoundPlus } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/atoms/Dialog/Dialog';
import { Input } from '@/atoms/Input/Input';
import { Textarea } from '@/atoms/Textarea/Textarea';
import { Typography } from '@/atoms/Typography/Typography';
import { CHAT_MESSAGE_MAX_BYTES, CHAT_SEARCH_QUERY_MAX_LENGTH } from '@/config/chat';
import { useChat } from '@/hooks/useChat/useChat';
import { useChatComposer } from '@/hooks/useChatComposer/useChatComposer';
import { useChatUserSearch } from '@/hooks/useChatUserSearch/useChatUserSearch';
import { cn, formatPublicKey } from '@/libs/utils/utils';

function connectionLabel(
  state: ReturnType<typeof useChat>['transportState'],
  verifiedRoute: 'direct' | 'relay' | null,
) {
  if (state === 'verified' && verifiedRoute === 'relay') return 'Relayed · E2E encrypted';
  if (state === 'verified' && verifiedRoute === 'direct') return 'Direct · E2E encrypted';
  if (state === 'authorizing') return 'Authorize chat in Pubky Ring';
  if (state === 'publishing') return 'Publishing endpoint…';
  if (state === 'online') return 'Online · waiting for a peer';
  if (state === 'connecting') return 'Verifying peer…';
  if (state === 'offline') return 'Offline';
  return 'Transport unavailable';
}

export function ChatSpace() {
  const chat = useChat();
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const search = useChatUserSearch(searchQuery, chat.currentAccountId);
  const composer = useChatComposer({ onSend: chat.sendMessage });
  const draft = composer.form.watch('message');
  const draftBytes = new TextEncoder().encode(draft).byteLength;
  const isVerified = chat.transportState === 'verified' && chat.verifiedRoute !== null;
  const canSend = Boolean(chat.selectedPeerId && isVerified && draft.trim());

  const confirmDelete = async () => {
    await chat.deleteSelectedHistory();
    setDeleteDialogOpen(false);
  };

  return (
    <Container
      overrideDefaults
      className="grid min-h-[calc(100dvh-12rem)] overflow-hidden rounded-xl border bg-card lg:grid-cols-[20rem_minmax(0,1fr)]"
    >
      <Container overrideDefaults className="border-b border-border lg:border-r lg:border-b-0">
        <Container overrideDefaults className="flex flex-col gap-4 border-b border-border p-4">
          <Container overrideDefaults className="flex items-center justify-between gap-3">
            <Typography as="h1" size="lg">
              Messages
            </Typography>
            {chat.authorizationRequired ? (
              <Button size="sm" variant="secondary" type="button" data-sentry-block onClick={chat.authorizeInRing}>
                Authorize in Ring
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={chat.transportState === 'unavailable' || chat.transportState === 'authorizing'}
                onClick={() => void chat.publishAndGoOnline()}
              >
                <Radio className="size-4" />
                {'Publish & go online'}
              </Button>
            )}
          </Container>
          <Container overrideDefaults className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Find a person by name or Pubky ID"
              value={searchQuery}
              maxLength={CHAT_SEARCH_QUERY_MAX_LENGTH}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Name or 52-character Pubky ID"
              className="pl-9"
              autoComplete="off"
            />
          </Container>
          {search.error && (
            <Typography size="xs" className="text-muted-foreground">
              {search.error}
            </Typography>
          )}
          {searchQuery && (
            <Container
              overrideDefaults
              className="flex max-h-52 flex-col gap-1 overflow-y-auto"
              role="listbox"
              aria-label="People"
            >
              {search.isLoading && search.results.length === 0 ? (
                <Typography className="flex items-center gap-2 text-muted-foreground" size="sm">
                  <Loader2 className="size-4 animate-spin" /> {'Searching…'}
                </Typography>
              ) : (
                search.results.map((result) => (
                  <Button
                    overrideDefaults
                    type="button"
                    role="option"
                    aria-selected={chat.selectedPeerId === result.id}
                    key={result.id}
                    className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      void chat.selectPeer(result.id);
                      setSearchQuery('');
                    }}
                  >
                    <UserRoundPlus className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{result.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{result.id}</span>
                    </span>
                  </Button>
                ))
              )}
            </Container>
          )}
        </Container>

        <Container overrideDefaults className="flex flex-col gap-1 p-2" aria-label="Local conversations">
          {chat.conversations.length === 0 ? (
            <Typography className="p-4 text-sm text-muted-foreground">
              Search for someone to start a local conversation.
            </Typography>
          ) : (
            chat.conversations.map((conversation) => (
              <Button
                overrideDefaults
                type="button"
                key={conversation.peerId}
                onClick={() => void chat.selectPeer(conversation.peerId)}
                className={cn(
                  'flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-accent',
                  chat.selectedPeerId === conversation.peerId && 'bg-secondary',
                )}
              >
                <MessageCircle className="size-5 shrink-0" />
                <span className="truncate text-sm font-semibold">{formatPublicKey({ key: conversation.peerId })}</span>
              </Button>
            ))
          )}
        </Container>
      </Container>

      <Container overrideDefaults className="flex min-h-[32rem] min-w-0 flex-col">
        <Container
          overrideDefaults
          className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"
        >
          <Container overrideDefaults className="min-w-0">
            <Typography as="h2" className="truncate font-semibold">
              {chat.selectedPeerId ? formatPublicKey({ key: chat.selectedPeerId }) : 'Select a conversation'}
            </Typography>
            <Typography
              size="xs"
              className={cn('flex items-center gap-1.5 text-muted-foreground', isVerified && 'text-emerald-400')}
              data-testid="chat-connection-status"
            >
              {isVerified ? <ShieldCheck className="size-3.5" /> : <Radio className="size-3.5" />}
              {connectionLabel(chat.transportState, chat.verifiedRoute)}
            </Typography>
          </Container>
          <Container overrideDefaults className="flex w-auto flex-row gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={
                !chat.selectedPeerId ||
                chat.transportState === 'unavailable' ||
                chat.transportState === 'authorizing' ||
                isVerified
              }
              onClick={() => void chat.connectSelectedPeer()}
            >
              <ShieldCheck className="size-4" /> {'Connect'}
            </Button>
            <Button
              size="icon"
              variant="secondary"
              aria-label="Delete local history"
              disabled={!chat.selectedPeerId || chat.messages.length === 0}
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          </Container>
        </Container>

        <Container overrideDefaults className="border-b border-border bg-secondary/20 p-4">
          <Typography size="xs" className="mb-2 tracking-wider text-muted-foreground uppercase">
            Inbound requests
          </Typography>
          {chat.pendingRequests.length === 0 ? (
            <Typography size="sm" className="text-muted-foreground">
              No pending requests. Incoming Hellos are checked offline; Accept authorizes mutual live Pubky checks and
              messaging.
            </Typography>
          ) : (
            chat.pendingRequests.map((request) => (
              <Container
                key={request.requestId}
                overrideDefaults
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <Typography size="sm">{`Connection request from ${formatPublicKey({ key: request.peerId })}`}</Typography>
                <Container overrideDefaults className="flex w-auto flex-row gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void chat.rejectInbound(request.requestId)}>
                    Decline
                  </Button>
                  <Button size="sm" onClick={() => void chat.acceptInbound(request.requestId, request.peerId)}>
                    <Check className="size-4" /> Accept
                  </Button>
                </Container>
              </Container>
            ))
          )}
        </Container>

        <Container overrideDefaults className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
          {!chat.selectedPeerId ? (
            <Container overrideDefaults className="m-auto max-w-md items-center text-center">
              <MessageCircle className="mb-3 size-10 text-muted-foreground" />
              <Typography className="font-semibold">Private browser-to-browser chat</Typography>
              <Typography size="sm" className="mt-1 text-muted-foreground">
                Messages stay in this browser. Pubky homeservers only carry signed connection metadata.
              </Typography>
              <Typography size="xs" className="mt-2 text-muted-foreground">
                When relayed, the relay can observe endpoint IDs, IP addresses, timing, and traffic shape—not message
                contents.
              </Typography>
            </Container>
          ) : chat.messages.length === 0 ? (
            <Typography className="m-auto text-center text-muted-foreground" size="sm">
              Connect and verify this peer before sending a message.
            </Typography>
          ) : (
            chat.messages.map((message) => (
              <Container
                key={message.id}
                overrideDefaults
                className={cn(
                  'max-w-[85%] rounded-xl px-3 py-2',
                  message.direction === 'outgoing' ? 'ml-auto bg-brand/20' : 'mr-auto bg-secondary',
                )}
              >
                <Typography className="font-normal wrap-anywhere whitespace-pre-wrap">{message.body}</Typography>
                <Typography size="xs" className="mt-1 text-muted-foreground">
                  {message.delivery}
                </Typography>
              </Container>
            ))
          )}
        </Container>

        <form
          className="border-t border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void composer.submit();
          }}
        >
          <Container overrideDefaults className="flex items-end gap-2">
            <Controller
              control={composer.form.control}
              name="message"
              render={({ field, fieldState }) => (
                <Container overrideDefaults className="min-w-0 flex-1">
                  <Textarea
                    {...field}
                    aria-label="Message"
                    aria-invalid={fieldState.invalid}
                    disabled={!isVerified}
                    rows={2}
                    placeholder={isVerified ? 'Write a message' : 'Connect to a verified peer to send messages'}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void composer.submit();
                      }
                    }}
                  />
                  <Typography
                    size="xs"
                    className={cn(
                      'mt-1 text-right text-muted-foreground',
                      draftBytes > CHAT_MESSAGE_MAX_BYTES && 'text-destructive',
                    )}
                  >
                    {`${draftBytes} / ${CHAT_MESSAGE_MAX_BYTES} bytes`}
                  </Typography>
                  {fieldState.error && (
                    <Typography size="xs" className="text-destructive">
                      {fieldState.error.message}
                    </Typography>
                  )}
                </Container>
              )}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              disabled={!canSend || composer.form.formState.isSubmitting}
            >
              <Send className="size-4" />
            </Button>
          </Container>
        </form>
      </Container>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md" hiddenTitle="Delete local history">
          <DialogHeader>
            <DialogTitle>Delete local history?</DialogTitle>
            <DialogDescription>{"This removes this conversation's messages from this browser only."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              <Trash2 className="size-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Container>
  );
}
