import { json } from "~/lib/server";
export function loader() {
  return json({ ok: true, service: "pylon", time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
