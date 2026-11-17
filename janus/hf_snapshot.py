#!/usr/bin/env python3
"""Relevé déterministe Hugging Face : Top 3 tendance + dernières sorties des modèles suivis.
Aucun LLM : l'API fournit le classement, owners.json fournit le propriétaire. Le LLM ne fait que commenter.
Python 3.9+, bibliothèque standard seulement.

Usage : python3 hf_snapshot.py [--out out/hf.json] [--fixture trending.json]
Sortie : un objet « hf_trending » conforme à schema.json + "watch_latest" (par famille de watchlist.json) + "models" (registre).
La variation à J-1 n'est PAS calculée ici : l'application compare le rang et le score au rapport de la veille.
Si la veille n'a pas ce modèle dans son Top 3, l'application affiche « entrée »."""
import json, os, sys, argparse, urllib.request, urllib.parse
from datetime import datetime, timezone

API = "https://huggingface.co/api/models"
HERE = os.path.dirname(os.path.abspath(__file__))

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bulle-ai-tin/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def org_of(repo_id):
    return repo_id.split("/", 1)[0]

def base_orgs(tags):
    return [t.split(":", 2)[-1].split("/")[0] for t in tags if t.startswith("base_model:") and "/" in t]

def classify(m, owners):
    """Renvoie (owner, country, kind). Ne devine jamais : inconnu -> 'Communauté'."""
    org = org_of(m["id"]); labs, quant = owners["labs"], owners["quantizers"]
    tags = m.get("tags", [])
    if org in labs and not any(t.startswith("base_model:finetune") or t.startswith("base_model:quantized") for t in tags):
        return labs[org]["owner"], labs[org]["country"], "original"
    base = next((labs[b]["owner"] for b in base_orgs(tags) if b in labs), None)
    if org in quant or any(t.startswith("base_model:quantized") for t in tags):
        who = quant.get(org, f"Communauté ({org})")
        return (f"{who} · base {base}" if base else who), None, "quantification"
    if org in labs:  # dérivé publié par le laboratoire lui-même (ex. variante officielle)
        return labs[org]["owner"], labs[org]["country"], "original"
    return (f"Communauté ({org}) · base {base}" if base else f"Communauté ({org})"), None, "dérivé"

def stale_check(trending, prev_path):
    """Garde-fou anti-cache : les likes et téléchargements ne baissent pas d'un jour à l'autre (hors dé-likes marginaux).
    Si un modèle vu la veille a perdu plus de 3 % de likes ou de téléchargements, le relevé est probablement un cache ancien :
    on le signale et on n'écrit PAS le fichier de sortie (le rapport du jour garde alors le bloc de la veille)."""
    if not prev_path or not os.path.exists(prev_path): return []
    prev = json.load(open(prev_path, encoding="utf-8")).get("hf_trending", {})
    old = {e["id"]: e for k in ("top3", "top3_official") for e in prev.get(k, [])}
    bad = []
    for m in trending:
        o = old.get(m["id"])
        if not o: continue
        for field in ("likes", "downloads"):
            if o.get(field) and m.get(field, 0) < o[field] * 0.97:
                bad.append(f"{m['id']} : {field} {o[field]} -> {m.get(field)}")
    return bad

def entry(rank, m, owners):
    owner, country, kind = classify(m, owners)
    e = {"rank": rank, "id": m["id"], "name": m["id"].split("/", 1)[1], "url": "https://huggingface.co/" + m["id"], "owner": owner,
         "kind": kind, "score": m.get("trendingScore", 0), "likes": m.get("likes", 0), "downloads": m.get("downloads", 0)}
    if country: e["country"] = country
    if m.get("pipeline_tag"): e["task"] = m["pipeline_tag"]
    return e

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default=os.path.join(HERE, "out", "hf.json")); ap.add_argument("--fixture"); ap.add_argument("--prev", help="rapport de la veille (data/AAAA-MM-JJ.json) pour le contrôle de fraîcheur")
    a = ap.parse_args()
    owners = json.load(open(os.path.join(HERE, "owners.json"), encoding="utf-8"))
    watch = json.load(open(os.path.join(HERE, "watchlist.json"), encoding="utf-8"))["watch"]

    if a.fixture: trending = json.load(open(a.fixture, encoding="utf-8"))
    else: trending = get(API + "?" + urllib.parse.urlencode({"sort": "trendingScore", "limit": 30}))
    trending = [m for m in trending if not m.get("private")]

    bad = stale_check(trending, a.prev)
    if bad:
        print("RELEVÉ SUSPECT (cache ancien probable), rien n'est écrit :", *bad, sep="\n  ", file=sys.stderr)
        sys.exit(3)
    top3 = [entry(i + 1, m, owners) for i, m in enumerate(trending[:3])]
    # « laboratoires officiels » : on saute les dérivés et quantifications, on garde l'ordre de tendance
    official = [m for m in trending if classify(m, owners)[2] == "original"][:3]
    top3_official = [entry(i + 1, m, owners) for i, m in enumerate(official)]

    watch_latest = {}
    for w in watch:
        try:
            if a.fixture: break
            lst = get(API + "?" + urllib.parse.urlencode({"author": w["hf_org"], "sort": "createdAt", "limit": 5}))
            watch_latest[w["family"]] = [{"id": m["id"], "createdAt": m.get("createdAt"), "tags": [t for t in m.get("tags", []) if t.startswith(("license:", "base_model:"))][:4]} for m in lst]
        except Exception as e:  # une org en panne ne bloque pas le relevé
            watch_latest[w["family"]] = {"error": str(e)}

    # registre prêt à fusionner dans le rapport (modèles du Top 3 : propriétaire et lien HF garantis par construction)
    reg = {}
    for e in top3 + top3_official:
        reg[e["id"]] = {"id": e["id"], "name": e["name"], "owner": e["owner"], "url": e["url"], **({"country": e["country"]} if e.get("country") else {})}
    out = {"hf_trending": {"fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "top3": top3, "top3_official": top3_official, "sources": []},
           "watch_latest": watch_latest, "models": list(reg.values())}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for e in top3: print(f"{e['rank']}. {e['id']}  [{e['owner']}]  score {e['score']}  ({e['kind']})")
    print("officiels :", ", ".join(e["id"] for e in top3_official))

if __name__ == "__main__":
    main()
