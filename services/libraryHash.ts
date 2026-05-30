type Sha256Digest = (algorithm: 'SHA-256', value: string) => Promise<string>;
declare const require: (moduleName: string) => typeof import('expo-crypto');

let testDigest: Sha256Digest | null = null;

export const setSha256DigestForTests = (digest: Sha256Digest | null) => {
  testDigest = digest;
};

export const sha256Hex = async (value: string) => {
  if (testDigest) {
    return testDigest('SHA-256', value);
  }

  const Crypto = require('expo-crypto');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
};
