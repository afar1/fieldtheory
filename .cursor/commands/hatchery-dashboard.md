# hatchery-dashboard

---
description: Port-forward the hatchery dashboard from K8s and open it in Chrome.
---

Port-forward the hatchery dashboard service from the K8s cluster to localhost and open it in Google Chrome.

Steps:
1. Kill any existing port-forward on port 3457 (`lsof -ti:3457 | xargs kill` if needed).
2. Run `kubectl port-forward -n hatchery svc/dashboard 3457:80` in the background.
3. Wait for the port-forward to be ready by polling `curl -s http://localhost:3457/` (retry up to 5 times with 1s sleep).
4. Once responding, open the dashboard with `open -a "Google Chrome" http://localhost:3457`.
5. Tell the user the dashboard is open and that the port-forward is running in the background. Remind them to kill it when done (`lsof -ti:3457 | xargs kill`).
