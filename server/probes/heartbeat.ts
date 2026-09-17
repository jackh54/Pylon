import { z } from "zod";
import type { ProbeDefinition } from "./types";

const schema = z.object({
  /** how long after the expected interval we wait before flagging the monitor down */
  graceSec: z.coerce.number().int().min(10).max(86400).default(60),
});
export type HeartbeatConfig = z.infer<typeof schema>;

/**
 * Push / heartbeat monitor. Nothing is probed from the edge: the server (a plugin, a cron job, a
 * systemd timer, a Discord bot, a Go agent…) calls the push URL on a schedule and can attach any
 * JSON payload (players, tps, memory…). If a ping is not received within interval + grace, it goes down.
 */
export const heartbeatProbe: ProbeDefinition<HeartbeatConfig> = {
  id: "heartbeat",
  name: "Heartbeat (push)",
  description: "Your server pings Pylon. Works for anything: plugins, cron jobs, bots, agents behind NAT. Attach metrics as JSON.",
  category: "push",
  icon: "HeartPulse",
  runsOn: ["push"],
  schema,
  defaults: { graceSec: 60 },
  defaultIntervalSec: 60,
  fields: [
    { key: "graceSec", label: "Grace period (seconds)", type: "number", placeholder: "60", help: "Extra time after the expected interval before the monitor is marked down." },
  ],
  dataFields: [{ key: "players", label: "Players", format: "players" }, { key: "tps", label: "TPS", format: "number" }],
  docs: `Send a request to the push URL at least every *interval* seconds:

\`\`\`bash
curl -fsS "https://<your-pylon>/api/push/<token>?status=up&msg=OK&latency=12"
\`\`\`

POST a JSON body to attach live metrics that show on your status page:

\`\`\`bash
curl -X POST "https://<your-pylon>/api/push/<token>" -H 'content-type: application/json' \\
  -d '{"status":"up","players":42,"maxPlayers":100,"tps":19.9}'
\`\`\`

Use \`status=down\` to actively report a failure.`,
  address: () => "push",
};
