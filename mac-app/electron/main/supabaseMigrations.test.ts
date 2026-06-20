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

  it('adds River targets, defaults, source preferences, and invite preferences', () => {
    const sql = migrationSql('020_river_timeline_targets.sql');

    expect(sql).toContain('create table if not exists public.river_document_targets');
    expect(sql).toContain("target_kind text not null check (target_kind = any (array['person'::text, 'group'::text, 'public'::text]))");
    expect(sql).toContain("check (target_kind <> 'public' or target_id = 'public')");
    expect(sql).toContain('create table if not exists public.river_default_destinations');
    expect(sql).toContain('create table if not exists public.river_source_preferences');
    expect(sql).toContain('create table if not exists public.river_invite_preferences');
    expect(sql).toContain('create table if not exists public.river_share_group_invites');
    expect(sql).toContain("status = any (array['pending'::text, 'accepted'::text, 'declined'::text, 'revoked'::text, 'left'::text])");
    expect(sql).toContain('invited_email text');
  });

  it('uses security definer helpers for River target visibility policies', () => {
    const sql = migrationSql('020_river_timeline_targets.sql');

    expect(sql).toContain('create or replace function public.is_shared_team_beta_user');
    expect(sql).toContain('security definer');
    expect(sql).toContain('create or replace function public.river_document_visible_to_user');
    expect(sql).toContain('create or replace function public.river_target_visible_to_user');
    expect(sql).toContain('create or replace function public.river_group_owned_by_user');
    expect(sql).toContain('create or replace function public.river_group_member_can_respond');
    expect(sql).toContain('public.river_document_visible_to_user(river_documents.id, auth.uid())');
  });

  it('keeps private group access target-backed while preserving legacy grants', () => {
    const sql = migrationSql('020_river_timeline_targets.sql');

    expect(sql).toContain("or a.source_type = 'legacy_team'");
    expect(sql).toContain('a.source_id = t.id::text');
    expect(sql).toContain("t.target_kind = 'group'");
    expect(sql).toContain('t.revoked_at is null');
    expect(sql).toContain("source_type = 'legacy_team'");
    expect(sql).toContain("target_kind = 'group'");
  });

  it('puts River target and group membership tables in realtime', () => {
    const sql = migrationSql('020_river_timeline_targets.sql');

    expect(sql).toContain("tablename = 'river_document_targets'");
    expect(sql).toContain('alter publication supabase_realtime add table public.river_document_targets');
    expect(sql).toContain("tablename = 'river_share_group_members'");
    expect(sql).toContain('alter publication supabase_realtime add table public.river_share_group_members');
    expect(sql).toContain("tablename = 'river_default_destinations'");
    expect(sql).toContain('alter publication supabase_realtime add table public.river_default_destinations');
    expect(sql).toContain("tablename = 'river_source_preferences'");
    expect(sql).toContain('alter publication supabase_realtime add table public.river_source_preferences');
  });
});
