// Keybinding definitions, matching, and formatting

export interface KeybindingDef {
  id: string
  label: string
  category: 'Navigation' | 'Terminal' | 'App'
  description: string
  defaultKeys: string
  context?: 'grid' | 'fullterm' | 'global'
}

export const KEYBINDING_DEFS: KeybindingDef[] = [
  // ── Navigation ────────────────────────────────────────────────────────
  { id: 'nav.prevProject',  label: 'Previous project',   category: 'Navigation', description: 'Switch to the previous project tab',        defaultKeys: 'Command+ArrowLeft',  context: 'grid' },
  { id: 'nav.nextProject',  label: 'Next project',       category: 'Navigation', description: 'Switch to the next project tab',            defaultKeys: 'Command+ArrowRight', context: 'grid' },
  { id: 'nav.cardLeft',     label: 'Card left',          category: 'Navigation', description: 'Move focus to the previous card in grid',   defaultKeys: 'ArrowLeft',          context: 'grid' },
  { id: 'nav.cardRight',    label: 'Card right',         category: 'Navigation', description: 'Move focus to the next card in grid',       defaultKeys: 'ArrowRight',         context: 'grid' },
  { id: 'nav.cardUp',       label: 'Card up',            category: 'Navigation', description: 'Move focus up one row in grid',             defaultKeys: 'ArrowUp',            context: 'grid' },
  { id: 'nav.cardDown',     label: 'Card down',          category: 'Navigation', description: 'Move focus down one row in grid',           defaultKeys: 'ArrowDown',          context: 'grid' },
  { id: 'nav.expandCard',   label: 'Expand card',        category: 'Navigation', description: 'Open the focused terminal card full-screen', defaultKeys: 'Enter',             context: 'grid' },
  { id: 'nav.collapse',     label: 'Back / Collapse',    category: 'Navigation', description: 'Go back or collapse expanded view',         defaultKeys: 'Escape',             context: 'global' },

  // ── Terminal (expanded view) ──────────────────────────────────────────
  { id: 'term.backOrRunners', label: 'Runners / Back',   category: 'Terminal', description: 'Focus runners sidebar, or back to grid',      defaultKeys: 'Command+ArrowLeft',  context: 'fullterm' },
  { id: 'term.backToTerminal', label: 'Back to terminal', category: 'Terminal', description: 'Return focus from sidebar to terminal',      defaultKeys: 'Command+ArrowRight', context: 'fullterm' },
  { id: 'term.prevRunner',  label: 'Previous runner',    category: 'Terminal', description: 'Switch to the previous runner',               defaultKeys: 'Command+ArrowUp',    context: 'fullterm' },
  { id: 'term.nextRunner',  label: 'Next runner',        category: 'Terminal', description: 'Switch to the next runner',                   defaultKeys: 'Command+ArrowDown',  context: 'fullterm' },
  { id: 'term.addRunner',   label: 'Add runner',         category: 'Terminal', description: 'Spawn a new runner terminal',                 defaultKeys: 'Command+Shift+R',    context: 'fullterm' },
  { id: 'term.wordLeft',    label: 'Word left',          category: 'Terminal', description: 'Move cursor back one word',                   defaultKeys: 'Alt+ArrowLeft',      context: 'fullterm' },
  { id: 'term.wordRight',   label: 'Word right',         category: 'Terminal', description: 'Move cursor forward one word',                defaultKeys: 'Alt+ArrowRight',     context: 'fullterm' },

  // ── App-wide ──────────────────────────────────────────────────────────
  { id: 'app.newTerminal',  label: 'New terminal',       category: 'App', description: 'Add a terminal to the active project',             defaultKeys: 'Command+T',          context: 'global' },
  { id: 'app.newProject',   label: 'New project',        category: 'App', description: 'Create a new project',                             defaultKeys: 'Command+Shift+N',    context: 'global' },
  { id: 'app.settings',     label: 'Settings',           category: 'App', description: 'Open settings / keybindings panel',                defaultKeys: 'Command+,',          context: 'global' },
  { id: 'app.toggleView',   label: 'Toggle view',        category: 'App', description: 'Switch between Terminals and Planner view',        defaultKeys: 'Command+Shift+P',    context: 'global' },
]

// ── Matching helpers ────────────────────────────────────────────────────

/** Convert a live KeyboardEvent to our canonical key string. */
export function eventToKeys(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey) parts.push('Command')
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const key = e.key
  // Skip bare modifier presses
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return parts.join('+')

  // Normalise single chars to upper-case so "t" matches "T"
  if (key.length === 1) {
    parts.push(key.toUpperCase())
  } else {
    parts.push(key) // ArrowLeft, Enter, Escape, etc.
  }
  return parts.join('+')
}

/** Does the live event match the given key string? */
export function matchesKeys(e: KeyboardEvent, keys: string): boolean {
  return eventToKeys(e) === keys
}

/** Resolve the effective key combo for a binding (override wins). */
export function getEffectiveKeys(id: string, overrides: Record<string, string>): string {
  if (overrides[id]) return overrides[id]
  return KEYBINDING_DEFS.find((b) => b.id === id)?.defaultKeys ?? ''
}

/** Does the live event match the given binding id? */
export function matchesBinding(
  e: KeyboardEvent,
  id: string,
  overrides: Record<string, string>
): boolean {
  const keys = getEffectiveKeys(id, overrides)
  return keys ? matchesKeys(e, keys) : false
}

// ── Display formatting ──────────────────────────────────────────────────

const SYMBOL_MAP: Record<string, string> = {
  Command: '\u2318',
  Control: '\u2303',
  Alt: '\u2325',
  Shift: '\u21E7',
  ArrowLeft: '\u2190',
  ArrowRight: '\u2192',
  ArrowUp: '\u2191',
  ArrowDown: '\u2193',
  Enter: '\u21A9',
  Escape: 'Esc',
  Backspace: '\u232B',
  Tab: '\u21E5',
  Space: '\u2423',
}

/** Pretty-print a key string for the UI.  "Command+ArrowLeft" → "\u2318 \u2190" */
export function formatKeys(keys: string): string {
  return keys
    .split('+')
    .map((part) => SYMBOL_MAP[part] ?? part)
    .join(' ')
}
