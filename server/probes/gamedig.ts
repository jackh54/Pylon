import { z } from "zod";
import type { ProbeDefinition } from "./types";

const schema = z.object({
  game: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).optional(),
});
export type GamedigConfig = z.infer<typeof schema>;

/** Popular GameDig type ids, shown in the picker. Any other id may be typed manually. */
export const GAMEDIG_GAMES: { value: string; label: string }[] = [
  { value: "minecraftbedrock", label: "Minecraft: Bedrock" },
  { value: "rust", label: "Rust" },
  { value: "csgo", label: "Counter-Strike 2 / CS:GO" },
  { value: "valheim", label: "Valheim" },
  { value: "palworld", label: "Palworld" },
  { value: "ark", label: "ARK: Survival Evolved" },
  { value: "asa", label: "ARK: Survival Ascended" },
  { value: "garrysmod", label: "Garry's Mod" },
  { value: "tf2", label: "Team Fortress 2" },
  { value: "l4d2", label: "Left 4 Dead 2" },
  { value: "7d2d", label: "7 Days to Die" },
  { value: "dayz", label: "DayZ" },
  { value: "squad", label: "Squad" },
  { value: "projectzomboid", label: "Project Zomboid" },
  { value: "satisfactory", label: "Satisfactory" },
  { value: "terraria", label: "Terraria (TShock)" },
  { value: "unturned", label: "Unturned" },
  { value: "arma3", label: "Arma 3" },
  { value: "enshrouded", label: "Enshrouded" },
  { value: "conanexiles", label: "Conan Exiles" },
  { value: "scum", label: "SCUM" },
  { value: "hll", label: "Hell Let Loose" },
  { value: "insurgencysandstorm", label: "Insurgency: Sandstorm" },
  { value: "mordhau", label: "Mordhau" },
  { value: "vrising", label: "V Rising" },
  { value: "soulmask", label: "Soulmask" },
  { value: "eco", label: "Eco" },
  { value: "factorio", label: "Factorio" },
  { value: "teamspeak3", label: "TeamSpeak 3" },
  { value: "mumble", label: "Mumble" },
  { value: "samp", label: "SA-MP" },
  { value: "mtasa", label: "MTA:SA" },
  { value: "quake3", label: "Quake 3" },
  { value: "cod4", label: "Call of Duty 4" },
  { value: "bf4", label: "Battlefield 4" },
  { value: "beammp", label: "BeamMP" },
];

/**
 * Relay-only catch-all backed by GameDig (300+ games, UDP included). The relay runs it; the edge
 * only tracks freshness.
 */
export const gamedigProbe: ProbeDefinition<GamedigConfig> = {
  id: "gamedig",
  name: "Any game (GameDig via relay)",
  description: "300+ games through GameDig, including UDP-only protocols (A2S, RakNet, GameSpy). Requires a relay.",
  category: "game",
  badge: "Any game",
  icon: "Gamepad2",
  runsOn: ["relay"],
  schema,
  defaults: {},
  fields: [
    { key: "game", label: "Game", type: "select", options: GAMEDIG_GAMES, required: true, help: "GameDig type id. See the GameDig game list for the full set." },
    { key: "host", label: "Host", type: "text", placeholder: "play.example.com", required: true },
    { key: "port", label: "Query port", type: "number", placeholder: "default", half: true },
  ],
  dataFields: [
    { key: "players", label: "Players", format: "players" },
    { key: "map", label: "Map" },
    { key: "name", label: "Server name" },
  ],
  docs: `Runs on a relay you host (a tiny Node service). Create one under **Relays**, then start it on any box that can reach the game server:

\`\`\`bash
docker run -d --restart=always -e PYLON_URL=https://<your-pylon> -e PYLON_TOKEN=<relay token> ghcr.io/jackh54/pylon-relay:latest
\`\`\``,
  address: (c) => c.port ? `${c.host}:${c.port}` : c.host,
};
