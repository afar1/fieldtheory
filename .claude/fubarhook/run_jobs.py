#!/usr/bin/env python3
"""
Job runner for fubarhook.
Scans .librarian/jobs/ for pending jobs and fulfills them.
No LLM calls - just writes static content for now.
"""
import json
import os
import tempfile
from pathlib import Path

def make_fulfilled_content(job_id: int) -> str:
    """Generate fulfilled output content with proof-of-fulfillment marker."""
    content = f"""# Done
(fulfilled job {job_id})

This work echoes early automation in computing, where repeatable hooks produced consistent artifacts.
It also reflects the Unix tradition of small, reliable programs that turn state into files.
"""
    # Invariant: output must contain proof-of-fulfillment marker
    assert "(fulfilled job" in content
    return content


def get_repo_root() -> Path:
    """Find repo root (prefer git root, else cwd)."""
    import subprocess
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL
        )
        return Path(out.decode().strip())
    except Exception:
        return Path.cwd()


def atomic_write(path: Path, content: str) -> None:
    """Write content to path atomically via temp file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        os.write(fd, content.encode("utf-8"))
        os.close(fd)
        os.replace(tmp_path, path)
    except Exception:
        os.close(fd) if fd else None
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def run_jobs(root: Path) -> int:
    """Process all pending jobs. Returns count of jobs processed."""
    jobs_dir = root / ".librarian" / "jobs"
    if not jobs_dir.exists():
        return 0

    # Sort for determinism
    job_files = sorted(jobs_dir.glob("job_*.json"))
    processed = 0

    for job_file in job_files:
        # Read job JSON, skip if invalid
        try:
            job = json.loads(job_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # Skip malformed or unreadable job files
            continue

        # Skip if not pending or not history_reading
        if job.get("status") != "pending":
            continue
        if job.get("type") != "history_reading":
            continue

        # Get output path from job (not hardcoded)
        output_rel = job.get("output")
        if not output_rel:
            # Skip job with no output path
            continue

        output_path = root / output_rel
        job_id = job.get("id", 0)

        # Generate content with proof-of-fulfillment marker
        content = make_fulfilled_content(job_id)

        # INVARIANT: Write output BEFORE marking done.
        # If output write fails, status stays pending.
        try:
            atomic_write(output_path, content)
        except Exception:
            # Output write failed - leave job pending, skip to next
            continue

        # Only now mark job as done and write back
        job["status"] = "done"
        job_file.write_text(json.dumps(job, indent=2) + "\n", encoding="utf-8")

        processed += 1

    return processed


def main() -> None:
    root = get_repo_root()
    count = run_jobs(root)
    if count > 0:
        print(f"Processed {count} job(s).")


if __name__ == "__main__":
    main()
