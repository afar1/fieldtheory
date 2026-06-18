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

  it('puts River documents, grants, and pins in the realtime publication', () => {
    const sql = migrationSql('019_river_document_grants.sql');

    expect(sql).toContain("tablename = 'river_documents'");
    expect(sql).toContain('alter publication supabase_realtime add table public.river_documents');
    expect(sql).toContain("tablename = 'river_document_audience'");
    expect(sql).toContain('alter publication supabase_realtime add table public.river_document_audience');
    expect(sql).toContain("tablename = 'river_document_pins'");
    expect(sql).toContain('alter publication supabase_realtime add table public.river_document_pins');
  });

  it('stores River documents separately from recipient grants', () => {
    const sql = migrationSql('019_river_document_grants.sql');

    expect(sql).toContain('create table if not exists public.river_documents');
    expect(sql).toContain('constraint river_documents_created_client_unique unique (created_by, client_id)');
    expect(sql).toContain('create table if not exists public.river_document_audience');
    expect(sql).toContain('primary key (document_id, recipient_user_id, source_type, source_id)');
  });

  it('keeps author ownership separate from recipient grants', () => {
    const sql = migrationSql('019_river_document_grants.sql');

    expect(sql).toMatch(/created_by = auth\.uid\(\)[\s\S]*river_document_audience/);
    expect(sql).toContain('recipient_user_id = auth.uid()');
    expect(sql).toContain('granted_by_user_id = auth.uid()');
  });

  it('stores River pins per user and only for visible documents', () => {
    const sql = migrationSql('019_river_document_grants.sql');

    expect(sql).toContain('create table if not exists public.river_document_pins');
    expect(sql).toContain('primary key (user_id, document_id)');
    expect(sql).toMatch(/for all[\s\S]*user_id = auth\.uid\(\)[\s\S]*d\.deleted_at is null/);
  });

  it('backfills legacy team documents into River documents and audience grants', () => {
    const sql = migrationSql('019_river_document_grants.sql');

    expect(sql).toContain('from public.team_documents td');
    expect(sql).toContain('from public.contacts c');
    expect(sql).toContain('from public.team_document_pins');
  });
});
