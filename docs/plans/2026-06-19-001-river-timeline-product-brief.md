# River Timeline Product Brief

Project path: `/Users/afar/dev/fieldtheory-oss`

Figure reference: `/Users/afar/Library/Application Support/Field Theory/users/5eb98f90-7ccf-465d-b3f7-0b6f15b4dbf4/figures/figure-1-hhfn3.png`

Related implementation docs:
- `docs/plans/2026-06-17-001-feat-team-river-entitlement-plan.md`
- `docs/plans/2026-06-18-001-feat-river-share-destinations-plan.md`

## Raw Transcript Distillation

The thing we are really trying to build is not just "teams" as a settings feature.
It is River as a timeline.

River should feel closer to Twitter/X than to a file folder.
It is a stream of shared documents, commands, context, and useful work.
People should be able to move quickly between different views of that stream: everything, public, contacts, groups, specific teams, or specific people.

The current language of "teams" is useful but too narrow.
The deeper product primitive is probably "groups."
A group can be a company team, a team within a team, a friend group, a collaborator set, or a small set of people someone shares with repeatedly.

The ideal sharing model is:
- share publicly to the public River
- share to all contacts/friends
- share to one group
- share to many groups
- share to one person
- share to many people
- change the audience later without friction

The ideal reading model is:
- one River per person
- one timeline/feed UI
- fast filters for what sources are included
- an "All" view that can include everything the user is allowed to see
- source controls that let the user include or exclude groups and people
- a collapsible source list for people, because the people list can get large

The ideal default workflow is:
- a user sets a default River destination, such as "public," "my team," a close collaborators group, or a person
- when they hit the River/share button, the default destination is already selected
- pressing Enter immediately shares to the default
- the same modal lets them search/select another person or group
- the same modal lets them change the default destination

The system should also support broadening or narrowing scope later.
Example: someone says, "you should make that public" or "share that with the broader team."
The user should be able to reopen the share controls for the document and toggle destinations on/off.

Invites and consent matter.
If someone adds a person to a group, the recipient probably needs some accept/approval path.
There may also be preferences, such as:
- automatically approve anyone adding me to a group
- automatically approve known contacts
- require approval for all groups
- allow people to add me to groups by default
- block or mute a group/source

## Product Goal

Make River a core collaborative surface in Field Theory.

River should answer two questions:
- "What useful context has been shared with me?"
- "Where should this document/context go?"

It should not feel like a database or a file tree.
It should feel like a living timeline with source filters and an effortless share composer.

## Design Reference

The attached figure shows Twitter/X with:
- top feed tabs such as "For you," "Following," and custom lists
- a composer at the top
- rich timeline cards below
- lightweight source/account identity on each post
- actions on each timeline item

Field Theory should borrow the timeline/source-switching idea, not copy Twitter literally.
Twitter's feed switching is visible and fast, but the design should be quieter, denser, and more work-focused.

## Core Concepts

### River

The user's River is the unified timeline of shareable context.
It contains documents shared by the user, documents shared with the user, public River documents, and group/contact-scoped documents.

River should remain one surface.
The user should not have to mentally switch between separate "team rivers."
Instead, they filter the one River by source.

### Source

A source is anything that can contribute items to the River timeline.

Source types:
- Public
- All contacts
- A group
- A person/contact
- My own shared items
- Possibly "Pinned" or "Saved" later

### Group

A group is a named audience and source.
It replaces the too-narrow mental model of "one team."

Groups may include:
- work teams
- project teams
- friends
- small collaboration circles
- temporary rooms
- teams within teams

Groups need membership and consent.
A person can belong to many groups.

### Contact

A contact is an individual share target and River source.
Contacts should eventually be independent from "team membership."
Today the code mostly uses `contacts.relationship_type = 'team'`, but the product direction is broader.

### Audience

Audience is who can see a shared River item.

A document can have many audiences:
- public
- one person
- many people
- one group
- many groups

Audience can change after the item is shared.

### Default Share Destination

Each user should have a default River destination.
That default could be public, a group, a person, or a "last used" destination.

The share modal should open with the default already selected.
Enter should confirm.
Changing the default should be easy from the modal.

## Desired User Experience

### Reading River

The user opens River and sees a timeline.

At the top there is fast source navigation:
- All
- Public
- Contacts
- Groups
- perhaps the user's most-used groups as pinned pills/tabs

There should be an expandable source/filter control.
This is important because people can belong to many groups and have many contacts.

Potential layout:
- top horizontal source pills for common filters
- a left-side collapsible source rail when River is active
- source groups in the rail:
  - Public
  - Contacts
  - Groups
  - People
  - Mine
  - Muted/Hidden

The default should not be noisy.
The user should be able to get to "All" quickly, then refine.

### Sharing To River

The user opens a markdown document and clicks the River button.

Expected modal behavior:
- search input focused
- default destination already selected
- Enter shares immediately to the default
- user can search people/groups
- user can select multiple destinations
- user can toggle public/private scope
- user can set the selected destination as default
- user can see whether the document is already shared and with whom

The modal should not require the user to know whether something is a contact, team, or group.
Search should return all shareable destinations in one list.

### Editing Share Scope Later

When a document is already shared:
- clicking River opens the same modal
- existing audiences are checked
- user can add/remove destinations
- user can make it public
- user can remove public access
- user can revoke access for a person/group

This should feel like editing a document's visibility, not like reposting.

### Invites And Acceptance

If Alice adds Bob to a group:
- Bob should receive an invite or pending membership
- Bob can accept or decline
- group membership should not become fully active until accepted, unless Bob has a preference that auto-approves it

Potential preferences:
- auto-approve groups from existing contacts
- auto-approve all group invitations
- require approval for all groups
- allow contacts to share directly into my River
- require approval before new contacts can share into my River

### Noise Control

The River can become noisy.
Noise control is central, not optional.

Users need:
- mute source
- hide source from All
- pin source
- default include/exclude settings
- possibly "show more" for left-nav River previews

## Current Implementation Snapshot

Current branch: `codex/release-0.3.14-startup-library`

Current build artifact:
- `mac-app/release/Field.Theory-0.3.16-arm64.dmg`

Current code supports:
- entitlement-gated River/Teams UI through `public.shared_team_beta_users`
- contacts-backed team invites through `public.contacts`
- explicit River recipient grants through `public.river_document_audience`
- River share modal with destination search
- River toolbar button for entitled markdown documents
- offline entitlement cache after a successful entitlement read

Current database concepts:
- `shared_team_beta_users`: app-level entitlement gate
- `contacts`: current team/contact membership table
- `river_documents`: canonical shared documents
- `river_document_audience`: explicit recipient grants
- `river_document_pins`: per-user pin state
- `river_share_groups`: schema exists in migration, but there is not yet a full product UI around named groups
- `river_share_group_members`: schema exists in migration, but there is not yet a full product UI around named group membership

Current limitation:
The product still mostly treats "team" as accepted rows in `contacts` where `relationship_type = 'team'`.
That is enough for the beta, but it is not the final product model.

## Design Problem To Solve

Design River as:
- a timeline
- a source-filtered workspace
- a sharing destination picker
- a group/contact/public visibility editor

The design should make groups feel natural without exposing database concepts.

Avoid making this feel like:
- a settings-only feature
- a file folder
- a Slack channel list clone
- a complex access-control admin panel

It should feel like:
- "I saw useful context in River"
- "I shared this to the right people"
- "I can quickly tune what River is showing me"

## Key Design Questions

1. What is the default River view?
   - All
   - For you
   - Contacts
   - Last-used source filter

2. Where do source filters live?
   - top tabs/pills
   - collapsible left source rail
   - command-launcher style popover
   - some combination

3. How does the share modal represent audience?
   - checklist
   - searchable command palette
   - segmented public/groups/people sections
   - compact selected chips

4. How does the user set a default share destination?
   - star in modal
   - "make default" action on selected destination
   - setting under Teams/River
   - infer from last successful share

5. How visible should Public River be?
   - top-level source
   - optional destination
   - profile-like posting surface
   - off by default until intentional

6. How do invites appear?
   - in Teams/River settings
   - inline in River
   - notification badge
   - source rail pending section

7. How do users prevent noise?
   - mute source
   - hide source from All
   - approve sources manually
   - default source inclusion preferences

## Suggested MVP Direction

Do not build full public Twitter yet.

First strong version:
- one River timeline
- source filter pills: All, Mine, Contacts, Groups
- collapsible source drawer for groups and people
- share modal with searchable destinations
- default destination support
- editable audience checklist for already-shared documents
- pending invite state for groups/contacts
- simple settings for invite approval preferences

This gets the product shape right while staying close to the current implementation.

## Claude Design Handoff

Please design the interaction model for River as a timeline.

Use the Twitter/X figure as a loose reference for:
- fast source switching
- timeline mental model
- composer/share affordance
- rich feed cards

Do not copy Twitter visually.
Field Theory should feel calm, local-first, text-forward, and work-focused.

Design deliverables requested:
- River timeline first-screen layout
- source filter/navigation model
- collapsed and expanded source rail
- share-to-River modal
- already-shared audience editing state
- group invite/accept states
- empty states for no contacts, no groups, and pending invites
- mobile/narrow-window behavior if relevant

Important product stance:
The primitive is "groups and contacts," not just "one team."
Teams are one kind of group.
