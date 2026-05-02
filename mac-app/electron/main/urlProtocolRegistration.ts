import path from 'path';

export const FIELD_THEORY_URL_SCHEME = 'fieldtheory';
export const FIELD_THEORY_PRODUCTION_APP_NAME = 'Field Theory';
export const FIELD_THEORY_PROTOCOL_OPT_IN_ENV = 'FT_REGISTER_FIELD_THEORY_PROTOCOL';

interface FieldTheoryProtocolRegistrationInput {
  appName: string;
  isDefaultApp?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function shouldRegisterFieldTheoryProtocol({
  appName,
  isDefaultApp,
  env,
}: FieldTheoryProtocolRegistrationInput): boolean {
  if (env?.[FIELD_THEORY_PROTOCOL_OPT_IN_ENV] === 'true') {
    return true;
  }

  if (isDefaultApp) {
    return false;
  }

  return appName === FIELD_THEORY_PRODUCTION_APP_NAME;
}

interface FieldTheoryProtocolClientArgsInput {
  isDefaultApp?: boolean;
  argv: string[];
}

export function fieldTheoryProtocolClientArgs({
  isDefaultApp,
  argv,
}: FieldTheoryProtocolClientArgsInput): string[] | undefined {
  if (!isDefaultApp || argv.length < 2) {
    return undefined;
  }

  return [path.resolve(argv[1])];
}
