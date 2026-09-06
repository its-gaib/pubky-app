import { describe, expect, it } from 'vitest';
import { CHAT_MESSAGE_MAX_BYTES } from '@/config/chat';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { ChatValidators } from './chat.validators';

const VALID_PUBKY = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';

describe('ChatValidators', () => {
  it('accepts only canonical 52-character peer identifiers', () => {
    expect(ChatValidators.validatePubky(VALID_PUBKY)).toBe(VALID_PUBKY);
    expect(() => ChatValidators.validatePubky(`pubky${VALID_PUBKY}`)).toThrow();
    expect(() => ChatValidators.validatePubky(VALID_PUBKY.toUpperCase())).toThrow();
    expect(() => ChatValidators.validatePubky('short')).toThrow();
  });

  it('measures composer limits as UTF-8 bytes', () => {
    expect(ChatValidators.validateMessageBody('a'.repeat(CHAT_MESSAGE_MAX_BYTES))).toHaveLength(CHAT_MESSAGE_MAX_BYTES);
    expect(() => ChatValidators.validateMessageBody('🌴'.repeat(CHAT_MESSAGE_MAX_BYTES / 4 + 1))).toThrowError(
      expect.objectContaining({ code: ValidationErrorCode.INVALID_INPUT }),
    );
  });

  it('rejects empty messages', () => {
    expect(() => ChatValidators.validateMessageBody('   ')).toThrowError(
      expect.objectContaining({ code: ValidationErrorCode.INVALID_INPUT }),
    );
  });
});
