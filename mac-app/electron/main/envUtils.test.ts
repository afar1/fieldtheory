import { describe, expect, it } from 'vitest';
import { parseEnvContent } from './envUtils';

describe('parseEnvContent', () => {
  it('strips matching wrapping quotes while preserving embedded spaces', () => {
    const parsed = parseEnvContent([
      'EMAIL_DEBATE_SMTP_PASS="abcd efgh ijkl mnop"',
      "SINGLE_QUOTED='quoted value'",
    ].join('\n'));

    expect(parsed.EMAIL_DEBATE_SMTP_PASS).toBe('abcd efgh ijkl mnop');
    expect(parsed.SINGLE_QUOTED).toBe('quoted value');
  });

  it('keeps unquoted values and values containing equals signs', () => {
    const parsed = parseEnvContent([
      'EMAIL_DEBATE_ENABLED=true',
      'TOKEN=abc=123',
    ].join('\n'));

    expect(parsed.EMAIL_DEBATE_ENABLED).toBe('true');
    expect(parsed.TOKEN).toBe('abc=123');
  });
});
