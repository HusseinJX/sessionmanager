# Contributor Mode — operator notes

Let a trusted, product-minded teammate contribute working code by talking to a
restricted Claude in plain language. The bar is modest and specific: **no
convenient way to bulk-download the repo, no shell, no direct push.** Seeing
code as Claude works is fine — this is not a "never sees a line of source" wall.
Every change lands as a PR you review.

## Threat model (what this actually protects)

The teammate is trusted; you just don't want to hand them a copy of the whole
codebase or server access. The design does **not** rely on reading their prompts
(per-prompt approval is off). Protection is structural, so it holds no matter
what they type:

| Threat | Control |
|---|---|
| Bulk-download the repo (clone/tar/scp/curl) | Claude runs with `Bash` and `WebFetch` **denied** — no shell and no arbitrary-host socket, so there's no one-command way to pull the tree down. Plus a VPS egress allowlist (below). |
| Poke the server / read other projects | Isolated git worktree — Claude sees one branch of one repo only. |
| Push code / bypass review | No push from the session; code lands only via **Submit → PR**, which you review. |

Seeing code/diffs in the chat as Claude works is expected and allowed. The
output filter is only a readability pass over the terminal stream, **not** a
redaction layer — the denied tools + worktree + no-push are the real walls.

## Enable it

On the prod server, set a second token beside `SM_TOKEN`:

```sh
export SM_TOKEN=<your admin token>
export SM_CONTRIBUTOR_TOKEN=<a different random token>   # unset = feature off
export SM_REPOS_DIR=/opt/repos                            # where cloned repos live
export SM_WORKTREES=on                                    # keep worktrees enabled
# gh auth login   # so Submit can open the PR
```

Give the teammate:

```
https://<host>:7543/contributor?token=<SM_CONTRIBUTOR_TOKEN>
```

Start their session (admin):

```sh
curl -sk -X POST https://<host>:7543/api/contributor/session \
  -H "Authorization: Bearer $SM_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"project":"community-marketplace"}'
```

Tear it down when done: `DELETE /api/contributor/session` (admin).

## Egress allowlist (defense in depth)

The denied `Bash`/`WebFetch` tools already remove Claude's ability to open a
socket to an arbitrary host. The firewall is the belt to that suspenders — even
a bug or a clever approved prompt can't move source off the box. **Allowlist,
not on/off** — a blanket block would also kill web search, npm, git.

Allow only what Claude legitimately needs:

| Destination | Why |
|---|---|
| `api.anthropic.com` | Claude itself + server-side WebSearch |
| your git remote (`github.com`) | Submit → push + PR |
| npm / pip / apt registries (optional) | installing deps |
| **everything else** | dropped |

Example (nftables sketch — adapt to your host; do not blanket-drop a box that
serves other things without scoping to the session's user/uid):

```sh
# Resolve + allow Anthropic and GitHub, drop the rest of egress for the
# contributor's uid. Prefer a dedicated system user for contributor sessions
# and match on `meta skuid <that-uid>` so the rest of the VPS is unaffected.
nft add table inet contrib
nft add chain inet contrib out '{ type filter hook output priority 0; }'
nft add rule inet contrib out meta skuid <contrib-uid> ip daddr @anthropic accept
nft add rule inet contrib out meta skuid <contrib-uid> ip daddr @github accept
nft add rule inet contrib out meta skuid <contrib-uid> tcp dport {53,443} ct state established accept
nft add rule inet contrib out meta skuid <contrib-uid> drop
```

Note: `WebSearch` runs server-side on Anthropic's infrastructure (the query
goes to `api.anthropic.com`), so allowlisting Anthropic keeps search working.
`WebFetch` — the arbitrary-URL fetch — is the leaky one, and it's already denied
at the tool layer.

## Loosening later

- **Let them run tests:** allow `Bash` but scope it (e.g. `Bash(npm test)`,
  `Bash(git *)`) in `buildContributorCommand()` / the worktree
  `.claude/settings.local.json`. Keep `WebFetch` denied and the egress
  allowlist in place.
- **Self-serve session:** today an admin pre-creates the one session. To let the
  contributor token provision its own, have `GET /api/contributor/session`
  create-on-first-connect instead of 404.
