import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { setSha256DigestForTests, sha256Hex } from '../services/libraryHash.ts';

test('hashes Library content through a SHA-256 digest engine', async () => {
  setSha256DigestForTests(async (algorithm, value) => {
    assert.equal(algorithm, 'SHA-256');
    return crypto.createHash('sha256').update(value).digest('hex');
  });

  try {
    assert.equal(
      await sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.equal(
      await sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    assert.equal(
      await sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    assert.equal(
      await sha256Hex('Field Theory cafe'),
      '1cbf49d8971c8af9dbab3f7dfb24458483fdaf64aac015ac3bd31c3b155a2e86',
    );
  } finally {
    setSha256DigestForTests(null);
  }
});
