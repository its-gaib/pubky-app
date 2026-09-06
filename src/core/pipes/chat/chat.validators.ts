import { CHAT_MESSAGE_ID_MAX_LENGTH, CHAT_MESSAGE_MAX_BYTES, CHAT_SEARCH_QUERY_MAX_LENGTH } from '@/config/chat';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isPubkyIdentifier } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isBoundedMessageBody(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    new TextEncoder().encode(value).byteLength <= CHAT_MESSAGE_MAX_BYTES
  );
}

function isMessageId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= CHAT_MESSAGE_ID_MAX_LENGTH &&
    MESSAGE_ID_PATTERN.test(value)
  );
}

export class ChatValidators {
  private constructor() {}

  static validatePubky(value: string): Pubky {
    if (!isPubkyIdentifier(value)) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Enter a canonical 52-character Pubky identifier.', {
        service: ErrorService.Local,
        operation: 'validateChatPubky',
      });
    }
    return value;
  }

  static validateMessageBody(value: string): string {
    if (!isBoundedMessageBody(value)) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Messages must contain text and be at most ${CHAT_MESSAGE_MAX_BYTES} UTF-8 bytes.`,
        {
          service: ErrorService.Local,
          operation: 'validateChatMessageBody',
        },
      );
    }
    return value;
  }

  static validateMessageId(value: string): string {
    if (!isMessageId(value)) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Invalid chat message identifier.', {
        service: ErrorService.Local,
        operation: 'validateChatMessageId',
      });
    }
    return value;
  }

  static normalizeSearchQuery(value: string): string {
    return value.trim().slice(0, CHAT_SEARCH_QUERY_MAX_LENGTH);
  }
}
