Review the codebase for security vulnerabilities, memory leaks, and bad engineering. Focus on:

1. Security: injection risks (SQL, FTS5, prompt), credential exposure, secrets on disk, file permissions, input validation
2. Memory: unclosed connections, large datasets held unnecessarily, streams not cleaned up
3. Engineering: missing error handling, race conditions, non-atomic writes, missing edge cases, resource cleanup

Report findings as a prioritized list: critical → high → medium → low. Include file paths and line numbers. Be specific about what's wrong and how to fix it. Don't flag style preferences — only real issues.

Fix anything critical or high. Ask before fixing medium/low.
