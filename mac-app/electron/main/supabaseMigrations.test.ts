import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(process.cwd(), '..', 'supabase', 'migrations');
const describeSupabaseMigrations = fs.existsSync(migrationsDir) ? describe : describe.skip;

function migrationSql(fileName: string): string {
  return fs.readFileSync(path.resolve(migrationsDir, fileName), 'utf-8');
}

function migrationFiles(): string[] {
  return fs.readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}

describeSupabaseMigrations('Supabase River migrations', () => {
  it('keeps migration numeric prefixes unique', () => {
    const prefixes = migrationFiles().map((fileName) => fileName.split('_')[0]);
    expect(prefixes).toHaveLength(new Set(prefixes).size);
  });

  it('puts River documents and shared pins in the realtime publication', () => {
    const sql = migrationSql('018_team_document_pins.sql');

    expect(sql).toContain("tablename = 'team_documents'");
    expect(sql).toContain('alter publication supabase_realtime add table public.team_documents');
    expect(sql).toContain("tablename = 'team_document_pins'");
    expect(sql).toContain('alter publication supabase_realtime add table public.team_document_pins');
  });

  it('stores River pins as one team-wide row per shared document', () => {
    const sql = migrationSql('018_team_document_pins.sql');

    expect(sql).toContain('create table if not exists public.team_document_pins');
    expect(sql).toContain('document_id uuid not null references public.team_documents (id) on delete cascade');
    expect(sql).toContain('primary key (team_scope_user_id, document_id)');
  });

  it('keeps River pin reads broader than writes', () => {
    const sql = migrationSql('018_team_document_pins.sql');

    expect(sql).toContain('using (public.is_team_document_scope_reader(team_scope_user_id))');
    expect(sql).toContain('public.is_team_document_scope_participant(team_scope_user_id)');
    expect(sql).toContain('and pinned_by = auth.uid()');
  });

  it('requires inserted and updated River pins to target undeleted documents in the same team scope', () => {
    const sql = migrationSql('018_team_document_pins.sql');

    expect(sql).toMatch(/for insert[\s\S]*d\.team_scope_user_id = team_document_pins\.team_scope_user_id[\s\S]*d\.deleted_at is null/);
    expect(sql).toMatch(/for update[\s\S]*d\.team_scope_user_id = team_document_pins\.team_scope_user_id[\s\S]*d\.deleted_at is null/);
  });
});
