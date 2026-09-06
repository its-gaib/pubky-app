'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { CHAT_COMPOSER_DEFAULT_VALUES, chatComposerSchema, type ChatComposerValues } from './useChatComposer.types';

interface UseChatComposerOptions {
  onSend: (message: string) => Promise<boolean>;
}

export function useChatComposer({ onSend }: UseChatComposerOptions) {
  const form = useForm<ChatComposerValues>({
    resolver: zodResolver(chatComposerSchema),
    defaultValues: CHAT_COMPOSER_DEFAULT_VALUES,
    mode: 'onChange',
  });

  const submit = async (): Promise<boolean> => {
    const valid = await form.trigger();
    if (!valid) return false;

    const sent = await onSend(form.getValues('message'));
    if (sent) form.reset(CHAT_COMPOSER_DEFAULT_VALUES);
    return sent;
  };

  return { form, submit };
}
