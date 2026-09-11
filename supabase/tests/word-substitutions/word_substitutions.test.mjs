import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

test('account list merges edits, deletes explicitly, and isolates users', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-000000000002');
    `);
    await db.exec(await readFile(new URL('../../migrations/20260911100000_word_substitutions.sql', import.meta.url), 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'`);
    const sync = async changes => (await db.query('select public.sync_word_substitutions($1::jsonb) as pairs', [JSON.stringify(changes)])).rows[0].pairs;
    const maine = { from: 'Maine', to: 'main' };
    const codex = { from: 'codec', to: 'Codex' };
    assert.deepEqual(await sync([maine]), [maine]);
    assert.deepEqual(await sync([codex]), [maine, codex]);
    assert.deepEqual(await sync([]), [maine, codex]);
    assert.deepEqual(await sync([{ from: 'Maine', to: '' }]), [{ from: 'Maine', to: '' }, codex]);
    assert.deepEqual(await sync([{ from: 'Maine', to: null }]), [codex]);
    assert.deepEqual(await sync([{ from: 'codec', to: null }]), []);
    await sync([maine]);
    await assert.rejects(sync([{ from: '', to: 'invalid' }]), /Invalid word substitution/);
    await assert.rejects(sync([{ from: 'missing target' }]), /Invalid word substitution/);
    await db.exec(`set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'`);
    assert.deepEqual(await sync([]), []);
    assert.equal((await db.query('select * from public.user_word_substitutions')).rows.length, 1);
    assert.equal((await db.query("update public.user_word_substitutions set pairs = '[]' where user_id = '00000000-0000-0000-0000-000000000001' returning *")).rows.length, 0);
    await db.exec('reset role; set role anon');
    await assert.rejects(sync([]), /permission denied/);
  } finally { await db.close(); }
});
