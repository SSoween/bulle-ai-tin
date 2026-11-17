#!/usr/bin/env bash
# Chaîne quotidienne Bulle-AI-tin : relevés scriptés (HF, GitHub, YouTube) -> instantané des sources -> génération locale -> validation -> publication.
# crontab : 40 5 * * * . $HOME/.config/bulle/env && cd $HOME/bulle-ai-tin && git pull -q && cd janus && ./run.sh >> run.log 2>&1
# Principe : un relevé en échec ou périmé n'est JAMAIS caché. Il est transmis à generate.py (--hf-status) qui le consigne comme contradiction.
set -uo pipefail
cd "$(dirname "$0")"
TODAY=$(date +%F); KEEP_DAYS="${KEEP_DAYS:-30}"
mkdir -p out snapshots "snapshots/$TODAY"

PREV=""
for f in $(ls ../data/[0-9]*.json 2>/dev/null | sort); do [[ "$(basename "$f" .json)" < "$TODAY" ]] && PREV="$f"; done

rm -f out/hf.json out/github.json; HF_STATUS=""
python3 hf_snapshot.py --out out/hf.json ${PREV:+--prev "$PREV"}; rc=$?
[[ $rc -eq 3 ]] && HF_STATUS="relevé HF écarté : compteurs en baisse (cache probable), bloc de la veille conservé"
[[ $rc -ne 0 && $rc -ne 3 ]] && HF_STATUS="relevé HF en échec (code $rc)"
python3 gh_snapshot.py --out out/github.json || echo "[warn] relevé GitHub incomplet (limite de l'API ? mettre GITHUB_TOKEN)" >&2
[[ "${YOUTUBE:-0}" == "1" ]] && { python3 fetch_youtube.py --out "snapshots/$TODAY" || echo "[warn] YouTube ignoré" >&2; }

set -e
python3 fetch_sources.py --sources sources.json --out snapshots --date "$TODAY"
python3 generate.py --snapshot "snapshots/$TODAY" ${PREV:+--prev "$PREV"} --hf out/hf.json --gh out/github.json --hf-status "$HF_STATUS" \
  --zone "${ZONE:-monde}" --focus "${FOCUS:-IA locale grand public}" --frequence "${FREQ:-quotidien}" \
  --date "$TODAY" --out "out/$TODAY.json" --keep-facts "out/$TODAY.facts.json"
python3 publish.py "out/$TODAY.json" --repo .. --git

find snapshots -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
find out -maxdepth 1 -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
