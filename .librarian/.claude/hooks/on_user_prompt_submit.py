#!/usr/bin/env python3
"""
State-Enforced Librarian Hook
Creates job files when threshold is reached.
Outputs additionalContext to tell Claude to fulfill pending jobs.
"""
import json
import os
import sys
import fcntl
from pathlib import Path

def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    cfg_path = root / ".claude" / "fubarhook" / "config.json"
    state_dir = root / ".claude" / "fubarhook" / ".state"
    count_file = state_dir / "prompt_count"
    seq_file = state_dir / "seq"
    lock_file = state_dir / "lock"

    if not cfg_path.exists():
        return

    with open(cfg_path) as f:
        cfg = json.load(f)

    enabled = cfg.get("enabled", False)
    if not enabled:
        return

    threshold = cfg.get("threshold", 3)
    if not isinstance(threshold, int) or threshold <= 0:
        return

    state_dir.mkdir(parents=True, exist_ok=True)

    # Use fcntl for cross-platform file locking
    with open(lock_file, "w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)

        # Read and increment count
        count = 0
        if count_file.exists():
            try:
                count = int(count_file.read_text().strip())
            except:
                count = 0
        count += 1
        count_file.write_text(str(count))

        if count < threshold:
            return

        # Reset count, increment seq
        count_file.write_text("0")

        seq = 0
        if seq_file.exists():
            try:
                seq = int(seq_file.read_text().strip())
            except:
                seq = 0
        seq += 1
        seq_file.write_text(str(seq))

        # Paths for job artifact system
        jobs_dir = root / ".librarian" / "jobs"
        rules_dir = root / ".librarian" / "rules"
        artifacts_dir = root / ".librarian" / "artifacts"
        job_file = jobs_dir / f"job_{seq}.json"
        rule_file = rules_dir / "history_reading.md"
        out_file = artifacts_dir / f"artifact_{seq}.md"

        # 1. Check if job already exists and is done (prevent regression)
        jobs_dir.mkdir(parents=True, exist_ok=True)
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        job_is_done = False
        if job_file.exists():
            try:
                existing_job = json.loads(job_file.read_text(encoding="utf-8"))
                if existing_job.get("status") == "done":
                    job_is_done = True
            except (json.JSONDecodeError, OSError):
                pass  # Treat malformed as not-done

        # 2. Create job file if missing (idempotent per seq)
        if not job_file.exists():
            job_data = {
                "schema_version": 1,
                "id": seq,
                "type": "history_artifact",
                "status": "pending",
                "output": f".librarian/artifacts/artifact_{seq}.md",
                "rule_file": ".librarian/rules/history_reading.md"
            }
            job_file.write_text(json.dumps(job_data, indent=2) + "\n")

        # 3. Create rule file if it does not exist
        rules_dir.mkdir(parents=True, exist_ok=True)
        if not rule_file.exists():
            rule_content = '''Write 2-3 paragraphs connecting the current work to engineering history, physics, or systems theory.
Include at least one concrete technical or historical detail.
No time references. No fluff.'''
            rule_file.write_text(rule_content)

        # 4. Write placeholder markdown output ONLY if job is not done
        # INVARIANT: Never overwrite fulfilled output with placeholder
        if not job_is_done:
            placeholder = f"# Pending\n\nJob {seq} created. Awaiting artifact generation.\n"
            out_file.write_text(placeholder)

            # 5. Output additionalContext to tell Claude about pending job
            msg = f"[STATE-ENFORCED] Job {seq} created. Before responding: check .librarian/jobs/ for pending jobs. For each with status 'pending': read rule_file, create artifact at output path following the rule, then set status to 'done'. Use conversation since last fulfilled job as context."
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": msg
                }
            }))

if __name__ == "__main__":
    main()
