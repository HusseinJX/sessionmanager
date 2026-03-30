# Issue: Option+Right and Option+Delete not working in FullTerminal

## Status: UNRESOLVED

## Problem
In expanded terminal view (FullTerminal.tsx):
- **Option+Left**: WORKS (moves cursor back one word)
- **Option+Right**: DOES NOT WORK (should move cursor forward one word)
- **Option+Delete (Backspace)**: DOES NOT WORK (should delete previous word)
- After pressing Option+Delete, regular Backspace also breaks

## Confirmed Facts
1. **Bytes are correct**: Debug logging confirmed the handler sends the right escape sequences:
   - Option+Left: `[27, 98]` = ESC+b (backward-word)
   - Option+Right: `[27, 102]` = ESC+f (forward-word)
   - Option+Delete: `[27, 127]` = ESC+DEL (backward-kill-word)
2. **Shell bindings exist**: `zsh -ic 'bindkey -lL main'` confirms emacs mode. `bindkey` shows `^[b`=backward-word, `^[f`=forward-word, `^[^?`=backward-kill-word all bound.
3. **node-pty test passes**: Direct node-pty test with `pty.write('\x1bf')` and `pty.write('\x1b\x7f')` both work correctly — cursor moves forward, word gets deleted.
4. **Session ID is correct**: All sends go to the same session ID.
5. **TERM=xterm-256color**, shell is `/bin/zsh -l` with custom ZDOTDIR (sources user's .zshrc).

## The Mystery
ESC+b works end-to-end but ESC+f and ESC+DEL do not, despite using the identical code path. The pty receives the bytes, the shell has the bindings, and direct pty tests work.

## Attempts (all failed for Option+Right and Option+Delete)

### Attempt 1: Custom xterm key handler (original approach)
- `attachCustomKeyEventHandler` intercepts alt+arrow, sends escape sequences via `window.api.sendInput`
- Result: Option+Left works, Option+Right and Option+Delete do not

### Attempt 2: macOptionIsMeta: true (no custom handler)
- Set `macOptionIsMeta: true` on Terminal constructor, removed custom alt handler
- Result: Option+Left and Option+Right both "delete one letter at a time" (moved cursor one char instead of one word). Option+Delete did nothing.
- Why arrows fail: macOptionIsMeta prepends ESC to the full arrow escape sequence (`\x1b\x1b[D`), shell interprets as ESC then left-arrow = one char movement

### Attempt 3: Split writes
- Send `\x1b` and `f` as two separate `sendInput` calls
- Result: Same — Option+Left works, Option+Right doesn't
- Likely timing issue: two IPC round-trips may cause shell to see them as separate keystrokes

### Attempt 4: Move to window-level capture handler
- Handle Option combos in the `window.addEventListener('keydown', handler, true)` capture phase handler with `preventDefault()` + `stopPropagation()`
- Result: Nothing registered at all — xterm's hidden textarea is `document.activeElement`, and the input guard `if (tag === 'TEXTAREA') { if (!e.metaKey && !e.ctrlKey) return }` bailed out before reaching alt handling

### Attempt 5: Fix input guard + capture handler
- Added `!e.altKey` to the input guard: `if (!e.metaKey && !e.ctrlKey && !e.altKey) return`
- All Option handling in capture phase with preventDefault+stopPropagation
- Also blocked Alt keyup events
- Result: Option+Left works, Option+Right still doesn't, Option+Delete still breaks regular delete

### Attempt 6: Block all alt keydown AND keyup in capture phase
- Added separate keyup handler blocking all Alt-related keyup events
- Result: Same as attempt 5

### Attempt 7: Hybrid — macOptionIsMeta + manual arrows only
- `macOptionIsMeta: true` for Option+letter and Option+Backspace (xterm handles natively)
- Manual capture handler only for Option+Arrow (sends `\x1bb`/`\x1bf`)
- xterm custom handler returns false only for Alt+Arrow, true for all other Alt combos
- Result: UNTESTED at context clear time, but previous macOptionIsMeta test showed Option+Delete didn't work even natively

## Key Files
- `/src/renderer/src/components/FullTerminal.tsx` — terminal view, keyboard handlers (lines ~150-320)
- `/src/renderer/src/keybindings.ts` — keybinding definitions
- `/src/main/ipc-handlers.ts` — IPC handler for `terminal:input`
- `/src/main/session-manager.ts` — `writeToSession()` writes to pty

## Hypotheses to Investigate
1. **xterm.js rendering issue**: Maybe the pty IS processing ESC+f correctly, but xterm.js doesn't render the cursor movement. The shell output (cursor forward CSI sequence) might not reach `term.write()` or xterm might not re-render. Test: add logging to the `onOutput` handler to see if output arrives after sending ESC+f.
2. **Multiple output listeners**: Both App.tsx and FullTerminal.tsx subscribe to `onOutput`. Could there be interference?
3. **Output batching**: SessionManager batches output at 16ms intervals. Could the cursor-forward response be batched/lost differently than cursor-backward?
4. **xterm.js version bug**: Could be a bug in the specific xterm.js version where certain CSI sequences from `term.write()` don't update the display.
5. **The shell inside the app behaves differently**: Even though `bindkey` shows bindings in a standalone zsh, the shell spawned by sessionmanager (with custom ZDOTDIR) might have different bindings. Test: type `bindkey | grep "\\^\\[f"` inside the app's terminal.

## Current State of Code
- `macOptionIsMeta: true` is set on Terminal constructor
- Capture handler intercepts Option+Arrow only (sends ESC+b / ESC+f manually)
- xterm custom handler blocks Cmd and Alt+Arrow, lets other Alt through
- Keybinding defs updated: `term.backToGrid` (Cmd+Left), `term.focusRunners` (Cmd+Right)
- `activeSessionIdRef` added for stable session ID in closures

## Other Changes Made This Session (working)
- Cmd+Left in expanded terminal → back to project grid view
- Cmd+Right in expanded terminal → focus runners sidebar
- Up/Down in runners sidebar → navigate runners
