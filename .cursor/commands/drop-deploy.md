# drop-deploy

Review the latest changes in the routines-hatchery repo. Check if any of the control-plane or runtime projects have changes.
If any Docker images have changed, build the updated images locally and push them to our Digital Ocean Container Registry under the OpenClaw image. Use doctl to look up container names and registry details.

If the control plane has changes, deploy them to our Digital Ocean control-plane droplet. If the runtime has changes, deploy them to both the runtime-1 and runtime-2 droplets. Use doctl to get the IP addresses of the relevant droplets. To deploy, SSH into each droplet, pull the latest changes, and restart the service.