import { z } from 'zod';
import { CHAT_MESSAGE_MAX_BYTES } from '@/config/chat';

export const chatComposerSchema = z.object({
  message: z
    .string()
    .refine((value) => value.trim().length > 0, 'Enter a message.')
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= CHAT_MESSAGE_MAX_BYTES,
      `Messages can be at most ${CHAT_MESSAGE_MAX_BYTES} UTF-8 bytes.`,
    ),
});

export type ChatComposerValues = z.infer<typeof chatComposerSchema>;

export const CHAT_COMPOSER_DEFAULT_VALUES: ChatComposerValues = { message: '' };
