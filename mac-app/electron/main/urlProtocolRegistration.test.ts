import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  FIELD_THEORY_PROTOCOL_OPT_IN_ENV,
  fieldTheoryProtocolClientArgs,
  shouldRegisterFieldTheoryProtocol,
} from './urlProtocolRegistration';

describe('urlProtocolRegistration', () => {
  describe('shouldRegisterFieldTheoryProtocol', () => {
    it('registers the packaged production app', () => {
      expect(shouldRegisterFieldTheoryProtocol({
        appName: 'Field Theory',
        isDefaultApp: false,
        env: {},
      })).toBe(true);
    });

    it('does not register the development Electron app by default', () => {
      expect(shouldRegisterFieldTheoryProtocol({
        appName: 'fieldtheory-mac',
        isDefaultApp: true,
        env: {},
      })).toBe(false);
    });

    it('does not register the packaged experimental app by default', () => {
      expect(shouldRegisterFieldTheoryProtocol({
        appName: 'Field Theory Experimental',
        isDefaultApp: false,
        env: {},
      })).toBe(false);
    });

    it('registers any app when explicitly opted in', () => {
      expect(shouldRegisterFieldTheoryProtocol({
        appName: 'Field Theory Experimental',
        isDefaultApp: false,
        env: { [FIELD_THEORY_PROTOCOL_OPT_IN_ENV]: 'true' },
      })).toBe(true);
    });

    it('ignores non-true opt-in values', () => {
      expect(shouldRegisterFieldTheoryProtocol({
        appName: 'Field Theory Experimental',
        isDefaultApp: false,
        env: { [FIELD_THEORY_PROTOCOL_OPT_IN_ENV]: '1' },
      })).toBe(false);
    });
  });

  describe('fieldTheoryProtocolClientArgs', () => {
    it('returns the resolved app path for explicit development registration', () => {
      expect(fieldTheoryProtocolClientArgs({
        isDefaultApp: true,
        argv: ['electron', 'mac-app'],
      })).toEqual([path.resolve('mac-app')]);
    });

    it('does not add client args for packaged apps', () => {
      expect(fieldTheoryProtocolClientArgs({
        isDefaultApp: false,
        argv: ['/Applications/Field Theory.app/Contents/MacOS/Field Theory'],
      })).toBeUndefined();
    });

    it('does not add client args for incomplete development launches', () => {
      expect(fieldTheoryProtocolClientArgs({
        isDefaultApp: true,
        argv: ['electron'],
      })).toBeUndefined();
    });
  });
});
