import {
  Globe, Plug, Network, HeartPulse, Gamepad2, Pickaxe, Blocks, Crosshair, Car, SquareTerminal, Wrench, Server, MessageCircle, Activity,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

/** Explicit map so only the icons we use end up in the bundle. */
const PROBE_ICONS: Record<string, ComponentType<LucideProps>> = {
  Globe, Plug, Network, HeartPulse, Gamepad2, Pickaxe, Blocks, Crosshair, Car, SquareTerminal, TerminalSquare: SquareTerminal, Wrench, Server, MessageCircle,
};

export function ProbeIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = PROBE_ICONS[name] ?? Activity;
  return <Icon {...props} />;
}

/** Brand mark: a pylon crystal. */
export function Logo({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <path d="M16 2 26 10v12L16 30 6 22V10L16 2Z" fill="currentColor" opacity="0.15" />
      <path d="M16 2 26 10v12L16 30 6 22V10L16 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 8 21 12v8l-5 4-5-4v-8l5-4Z" fill="var(--accent)" />
    </svg>
  );
}
