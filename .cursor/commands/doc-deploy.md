# doc-deploy

Sync mcp-hatchery code to the hatchery Docker image, build, push, and deploy to
  runtime droplets.

  Prerequisite: The PR command should have already been run — this deploys whatever is
  on routines main.

  Steps

  1. Validate before syncing

  - Run npx vitest run --config apps/mcp-hatchery/vitest.config.ts — abort if tests fail
  - Run npx turbo check-types --filter=mcp-hatchery — abort if types fail

  2. Compile and sync mcp-hatchery

  - Use npx tsc --project apps/mcp-hatchery/tsconfig.json --outDir
  /tmp/mcp-hatchery-dist to emit JS (do NOT hand-strip types)
  - Copy emitted JS files to
  /Users/afar/dev/routines-all/hatchery/docker/mcp-hatchery/src/
  - Do NOT copy test files (*.test.js)
  - Sync package.json dependencies only (not devDependencies, not scripts) to
  /Users/afar/dev/routines-all/hatchery/docker/mcp-hatchery/package.json
  - Show a diff summary of what changed in the hatchery repo before committing

  3. Commit and push hatchery repo

  - cd /Users/afar/dev/routines-all/hatchery
  - git add docker/mcp-hatchery/
  - Commit with a message describing what changed (hatchery repo pushes directly to
  main, no PR)
  - git push origin main

  4. Build and push Docker image

  - doctl registry login
  - cd /Users/afar/dev/routines-all/hatchery/docker
  - docker build --platform linux/amd64 -t
  registry.digitalocean.com/hatchery/openclaw:latest -t
  - docker push registry.digitalocean.com/hatchery/openclaw

  5. Deploy to runtime droplets

  SSH config: key ~/.ssh/hatchery_agent_ed25519, user root
  - runtime-1: 24.144.81.161
  - runtime-2: 164.92.106.17

  On each runtime:
  - docker pull registry.digitalocean.com/hatchery/openclaw:latest
  - Delete and recreate each running container via the control-plane API (SSH to
  control-1 at 137.184.184.210) — do NOT manually docker rm/restart containers, as the
  droplet-runtime tracks state
  - A container delete+create picks up the new image and re-hydrates workspace files
  from the database — this is the correct way to deploy, not docker restart

  6. Verify

  - Check container health on each runtime (docker ps, then curl each container's
  /health)
  - Report which containers were updated and their status

  Safety

  - Conversation history in Supabase is safe — only in-memory LLM context resets on
  container recreation
  - Always show a diff summary before committing to hatchery repo
  - To rollback: re-tag the previous image as :latest and re-pull on runtimes
