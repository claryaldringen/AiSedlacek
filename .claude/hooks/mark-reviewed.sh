#!/usr/bin/env bash
# Zapíše, že aktuální HEAD prošel projektovým review (/ais-review). Volá se jen
# ze skillu ais-review, když nezbývá žádný otevřený Critical/High nález.
# Použití: .claude/hooks/mark-reviewed.sh "C=0 H=0 M=2 L=3, 2 kola"
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Necommitnuté změny – review platí pro commit, nejdřív commitni opravy." >&2
  exit 1
fi

marker=$(git rev-parse --git-path ais-review/passed)
mkdir -p "$(dirname "$marker")"
printf '%s %s %s\n' "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${1:-}" >"$marker"
echo "Review zapsáno pro $(git rev-parse --short HEAD)."
