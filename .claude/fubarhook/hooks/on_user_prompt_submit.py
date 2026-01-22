#!/usr/bin/env python3
import json
import os
import subprocess
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

    out_dir = cfg.get("output_dir", "fubar")
    prefix = cfg.get("filename_prefix", "randomword_")
    content = cfg.get("content", "hello world")
    auto_run_jobs = cfg.get("auto_run_jobs", False)

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
        job_file = jobs_dir / f"job_{seq}.json"
        rule_file = rules_dir / "history_reading.md"
        output_path = root / out_dir
        out_file = output_path / f"{prefix}{seq}.md"

        # 1. Check if job already exists and is done (prevent regression)
        jobs_dir.mkdir(parents=True, exist_ok=True)
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
                "type": "history_reading",
                "status": "pending",
                "output": f"{out_dir}/{prefix}{seq}.md",
                "rule_file": ".librarian/rules/history_reading.md"
            }
            job_file.write_text(json.dumps(job_data, indent=2) + "\n")

        # 3. Create rule file if it does not exist
        rules_dir.mkdir(parents=True, exist_ok=True)
        if not rule_file.exists():
            rule_content = "Write exactly two sentences connecting the current work to a historical precedent in engineering or computing.\nNo fluff. No time references.\n"
            rule_file.write_text(rule_content)

        # 4. Write placeholder markdown output ONLY if job is not done
        # INVARIANT: Never overwrite fulfilled output with placeholder
        output_path.mkdir(parents=True, exist_ok=True)
        if not job_is_done:
            placeholder = f"# Pending\n\nJob {seq} created. Awaiting history reading generation.\n"
            out_file.write_text(placeholder)

        # 5. Optionally run job runner (best-effort, do not break hook on failure)
        if auto_run_jobs:
            try:
                runner_path = root / ".claude" / "fubarhook" / "run_jobs.py"
                subprocess.run(
                    [sys.executable, str(runner_path)],
                    cwd=str(root),
                    capture_output=True,
                    timeout=10
                )
            except Exception:
                pass  # Best-effort: ignore failures

if __name__ == "__main__":
    main()
