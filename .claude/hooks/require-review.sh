#!/usr/bin/env bash
# PreToolUse (Bash): `gh pr create` projde jen nad commitem, který prošel
# projektovým review (skill /ais-review). Marker zapisuje mark-reviewed.sh.
set -euo pipefail

input=$(cat)
# Rychlá cesta bez jq – ostatní Bash příkazy hook nezajímají.
grep -Eq 'gh[[:space:]]+pr[[:space:]]+create' <<<"$input" || exit 0
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
# Jen `gh pr create` v pozici příkazu (začátek řádku, za ; & | nebo závorkou,
# případně s VAR=… před ním) – ne zmínka v commit zprávě, echo nebo grepu.
cmd_re='(^|[;&|(])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+create([^[:alnum:]_-]|$)'
grep -Eq "$cmd_re" <<<"$cmd" || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
head_sha=$(git rev-parse HEAD)
marker=$(git rev-parse --git-path ais-review/passed)
reviewed_sha=""
[ -f "$marker" ] && reviewed_sha=$(cut -d' ' -f1 "$marker" | head -n1)

[ "$reviewed_sha" = "$head_sha" ] && exit 0

if [ -n "$reviewed_sha" ] && git merge-base --is-ancestor "$reviewed_sha" HEAD 2>/dev/null; then
  reason="PR zatím nejde otevřít: poslední projektové review je pro ${reviewed_sha:0:7}, od té doby přibyly commity (HEAD ${head_sha:0:7}). Spusť /ais-review – stačí inkrementálně nad ${reviewed_sha:0:7}..HEAD – a teprve pak gh pr create."
else
  reason="PR zatím nejde otevřít: HEAD ${head_sha:0:7} neprošel projektovým review. Spusť /ais-review (skill ais-review) nad diffem větve, vyřeš Critical/High nálezy a teprve pak gh pr create. /bookbot:code-review se v AiSedlacku nepoužívá."
fi
jq -n --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
