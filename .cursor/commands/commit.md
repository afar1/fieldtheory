# Commit current work
Commit all current work and push to origin. But if we are working on a web app of any kind (this does not apply to dmg or ios apps) before you do, try to build this locally using npm run build. Once we confirm that it built properly locally since it takes such a short time, we can then commit and push to origin. If it fails to build locally, identify and fix those issues first, then commit and push to origin.

## Important
- Always commit ALL modified and staged files (use `git add -A` to stage everything)
- If you can't get information from git diff, use your working memory to determine what has changed
- Review the staged files to write an accurate commit message

## Instructions
1. Stage all changes: `git add -A` (or `git add .` to include untracked files)
2. Review what will be committed using `git status` and `git diff --staged`
3. Write a brief commit message in the following format:
   - Short title description (< 80 characters)
   - 2~3 bullet points (< 80 characters) with a quick description
4. Commit and push: `git commit -m "..." && git push origin main`

## Notes
- You should only commit work when instructed. Do not keep committing subsequent work unless explicitly told so
- If there are unrelated changes mixed in, mention them in the commit message or ask the user if they should be split into separate commits