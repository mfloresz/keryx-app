/**
 * useAgentColor
 *
 * Deterministic header color for agent cards / previews.
 * Mirrors the reference screenshots where each agent has a solid header
 * (red, orange, muted) with a centered pixel icon.
 */

const PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#eab308", // yellow (accent)
  "#14b8a6", // teal
] as const

const MUTED_PALETTE = [
  "#f1f5f9", // slate-100
  "#f5f5f4", // stone-100
  "#faf5ff", // purple-50
  "#eff6ff", // blue-50
] as const

function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

export function getAgentHeaderColor(id: string, source?: string): string {
  // Catalog / global customs get vivid colors, user customs rotate palette,
  // muted fallbacks used for empty/icon cases.
  if (!id) return MUTED_PALETTE[0] as string
  // Keep palette stable: same id always same color.
  const idx = hashString(id) % PALETTE.length
  // For muted-like sources we could alternate but keep vivid for now to match screenshots
  // where even light cards have a solid header color.
  void source
  return PALETTE[idx] as string
}

export function getAgentMutedColor(id: string): string {
  const idx = hashString(id) % MUTED_PALETTE.length
  return MUTED_PALETTE[idx] as string
}

export function getAgentInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  return trimmed.charAt(0).toUpperCase()
}
