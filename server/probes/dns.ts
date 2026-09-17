import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";
import { resolveDns } from "../lib/net";

const schema = z.object({
  hostname: z.string().min(1),
  recordType: z.enum(["A", "AAAA", "CNAME", "SRV", "TXT", "MX"]).default("A"),
  expected: z.string().optional(),
});
export type DnsConfig = z.infer<typeof schema>;

export const dnsProbe: ProbeDefinition<DnsConfig> = {
  id: "dns",
  name: "DNS Record",
  description: "Resolve a DNS record via 1.1.1.1 and optionally assert on its value. Catches expired domains and broken SRV records.",
  category: "generic",
  icon: "Network",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { recordType: "A" },
  fields: [
    { key: "hostname", label: "Hostname", type: "text", placeholder: "_minecraft._tcp.play.example.com", required: true },
    { key: "recordType", label: "Type", type: "select", half: true, options: ["A", "AAAA", "CNAME", "SRV", "TXT", "MX"].map((v) => ({ value: v, label: v })) },
    { key: "expected", label: "Expected value contains", type: "text", placeholder: "optional", half: true },
  ],
  dataFields: [{ key: "records", label: "Records" }],
  address: (c) => `${c.recordType} ${c.hostname}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      const answers = await resolveDns(config.hostname, config.recordType, ctx.signal);
      const latencyMs = Date.now() - started;
      const values = answers.map((a) => a.data);
      const data = { records: values.join(", ") };
      if (!values.length) return fail(`No ${config.recordType} record found`, { latencyMs, data });
      if (config.expected && !values.some((v) => v.includes(config.expected!))) return fail(`No record contains "${config.expected}"`, { latencyMs, data });
      return { ok: true, latencyMs, message: values[0], data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
