# Density Room Monitor → Slack

A simple tool that monitors room occupancy via the [Density.io](https://density.io) API and sends Slack notifications when thresholds are met.

## Quick Start

```bash
# No dependencies needed - pure Node.js
node server.js
```

Then open http://localhost:3847 in your browser.

## Setup

### 1. Get Your Density API Token

1. Log into your [Density dashboard](https://dashboard.density.io)
2. Go to **Settings → API**
3. Copy your API token

See the [Density API documentation](https://developers.density.io/docs/) for more details.

### 2. Create a Slack Incoming Webhook

1. Go to [Slack API: Incoming Webhooks](https://api.slack.com/messaging/webhooks)
2. Click **Create your Slack app** (or use an existing app)
3. Enable **Incoming Webhooks**
4. Click **Add New Webhook to Workspace**
5. Select the channel where you want notifications
6. Copy the webhook URL (looks like `https://hooks.slack.com/services/...`)

### 3. Configure and Run

1. Start the server: `node server.js`
2. Open http://localhost:3847
3. Enter your Density API token and Slack webhook URL
4. Click **Connect & Load Spaces**
5. Select a space, set your threshold (e.g., "3 or more people")
6. Set the duration (e.g., "for 1 minute") and cooldown
7. Click **Add Rule**
8. Click **Start Monitoring**

## How It Works

- The server polls the Density API every 30 seconds
- When a room's occupancy meets or exceeds your threshold for the specified duration, it sends a Slack notification
- A cooldown period prevents notification spam (default: 30 minutes)
- Monitoring runs on the server, so you can close the browser tab

## Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| **Threshold** | Number of people that triggers an alert | 3 |
| **Duration** | How long threshold must be met before alerting (minutes) | 1 |
| **Cooldown** | Minimum time between notifications (minutes) | 30 |
| **Custom Message** | Optional custom notification text | Auto-generated |

## Example Notification

> 🚨 Alert: "Conference Room A" has 5 people (threshold: 3). It's been over 10 minute(s).

## Running in Production

For production use, consider:

1. **Process Manager**: Use PM2 or systemd to keep the server running
   ```bash
   npm install -g pm2
   pm2 start server.js --name density-monitor
   ```

2. **Persistence**: The current implementation stores state in memory. For persistence across restarts, you could add file-based or database storage.

3. **Security**: If exposing to the internet, add authentication and use HTTPS.

## API Endpoints

The server exposes these endpoints for programmatic use:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | POST | Set Density token and Slack webhook |
| `/api/spaces` | GET | List available Density spaces |
| `/api/spaces/:id/count` | GET | Get current count for a space |
| `/api/rules` | GET | List all monitoring rules |
| `/api/rules` | POST | Add a new rule |
| `/api/rules/:id` | DELETE | Remove a rule |
| `/api/monitor/start` | POST | Start monitoring |
| `/api/monitor/stop` | POST | Stop monitoring |
| `/api/monitor/status` | GET | Get current monitoring status |
| `/api/slack/test` | POST | Send a test Slack message |

## Troubleshooting

**"No spaces found"**
- Check that your Density API token has the correct permissions
- Ensure you have access to at least one space in Density

**Slack notifications not working**
- Verify the webhook URL is correct
- Use the "Test Slack" button to verify connectivity
- Check the server console for error messages

**Monitoring stops when I close the browser**
- This is expected if running without a server. Use `node server.js` to keep monitoring running.
