# droplets

# Codex Runbook: SSH Into Hatchery Droplets

  ## Goal
  Get SSH access to `control-1`, `runtime-1`, `runtime-2`, verify services, and auto-recover unreachable hosts.

  ## Rules
  1. Do not print secrets/tokens in output.
  2. Use SSH key: `~/.ssh/hatchery_agent_ed25519`.
  3. Use user: `root`.
  4. Prefer public IPs first, then Tailscale IPs as fallback.

  ## Hosts
  - `control-1` public: `137.184.184.210` private: `10.124.0.6` tailscale: `100.94.10.26`
  - `runtime-1` public: `24.144.81.161` private: `10.124.0.5` tailscale: `100.78.129.9`
  - `runtime-2` public: `164.92.106.17` private: `10.124.0.2` tailscale: `100.103.255.25`

  ## 1) Connectivity check
  Run:
  ```bash
  KEY=~/.ssh/hatchery_agent_ed25519
  for H in 137.184.184.210 24.144.81.161 164.92.106.17; do
    echo "== $H ==";
    ssh -o BatchMode=yes -o ConnectTimeout=8 -o IdentitiesOnly=yes \
        -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i "$KEY" root@$H 'hostname && whoami && date -u +%FT%TZ' || true
  done

  ## 2) Service checks

  Control plane:

  ssh -o BatchMode=yes -o ConnectTimeout=8 -o IdentitiesOnly=yes \
      -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -i ~/.ssh/hatchery_agent_ed25519 root@137.184.184.210 '
  systemctl status hatchery-control-plane --no-pager;
  journalctl -u hatchery-control-plane -n 120 --no-pager'

  Each runtime:

  ssh -o BatchMode=yes -o ConnectTimeout=8 -o IdentitiesOnly=yes \
      -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -i ~/.ssh/hatchery_agent_ed25519 root@<RUNTIME_PUBLIC_IP> '
  systemctl status hatchery-droplet-runtime --no-pager;
  journalctl -u hatchery-droplet-runtime -n 200 --no-pager;
  ssh -i ~/.ssh/hatchery_agent_ed25519 root@<HOST_PUBLIC_IP> '
  git -C /opt/hatchery branch --show-current;
  git -C /opt/hatchery rev-parse --short HEAD;
  git -C /opt/hatchery rev-parse --short origin/main'

  ## 4) Auto-recover unreachable host

  If SSH times out/resets:

  doctl compute droplet-action power-cycle <DROPLET_ID> --wait

  Droplet IDs:

  - control-1: 554509458
  - runtime-1: 554502867
  - runtime-2: 554501868

  Then retry SSH 8 times:

  for i in 1 2 3 4 5 6 7 8; do
    ssh -o BatchMode=yes -o ConnectTimeout=8 -o IdentitiesOnly=yes \
        -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -i ~/.ssh/hatchery_agent_ed25519 root@<HOST_PUBLIC_IP> 'hostname' && break
    sleep 4
  done

  ## 5) Safety for scheduling

  If runtime-1 is unstable, keep it drained from control-plane:

  ssh -i ~/.ssh/hatchery_agent_ed25519 root@137.184.184.210 '
  API=http://127.0.0.1:8787
  TOKEN=$(tr -d "\n" </root/hatchery-secrets/control_admin.token)
  curl -sS -X POST "$API/hatchery/pool/runtime-1/drain" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"evict\":false}"'

  Un-drain only after runtime health is consistently good.