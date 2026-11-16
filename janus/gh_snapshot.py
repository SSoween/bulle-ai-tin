#!/usr/bin/env python3
"""Relevé déterministe GitHub des projets de github_watch.json : stars, forks, licence, tickets ouverts, release « latest ».
Aucun LLM. API publique (60 requêtes/heure sans jeton ; mettre GITHUB_TOKEN dans l'environnement pour monter à 5000, jamais dans le dépôt).
Usage : python3 gh_snapshot.py [--out out/github.json] [--fixture fixture.json]
La variation (étoiles, nouvelle version) est calculée par l'application à partir du rapport de la veille.
Piège connu : la release marquée « latest » peut retarder sur la version annoncée dans le README (vu sur Strata et Colibri) ;
le relevé garde donc les deux notions séparées : 'latest_release' (API) et le texte 'readme_version_hint' de la config."""
import json, os, sys, argparse, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))

def get(path, fixture=None):
    if fixture is not None:
        if path in fixture: return fixture[path]
        raise KeyError(path)
    req = urllib.request.Request("https://api.github.com/" + path, headers={"User-Agent": "bulle-ai-tin/1.0", "Accept": "application/vnd.github+json"})
    if os.environ.get("GITHUB_TOKEN"): req.add_header("Authorization", "Bearer " + os.environ["GITHUB_TOKEN"])
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default=os.path.join(HERE, "out", "github.json")); ap.add_argument("--fixture")
    a = ap.parse_args()
    cfg = json.load(open(os.path.join(HERE, "github_watch.json"), encoding="utf-8"))
    fx = json.load(open(a.fixture, encoding="utf-8")) if a.fixture else None
    res = []
    for w in cfg["repos"]:
        r = w["repo"]; item = {"name": w["name"], "repo": "https://github.com/" + r, "kind": w.get("kind", ""), "readme_version_hint": w.get("readme_version_hint")}
        try:
            d = get(f"repos/{r}", fx)
            item.update({"owner": d["owner"]["login"], "license": (d.get("license") or {}).get("spdx_id") or "inconnue", "stars": d["stargazers_count"], "forks": d["forks_count"],
                         "open_issues": d["open_issues_count"], "archived": d.get("archived", False), "description": d.get("description")})
        except Exception as e:
            item["error"] = f"dépôt : {e}"; res.append(item); continue
        try:
            rel = get(f"repos/{r}/releases/latest", fx)
            item["latest_release"] = {"tag": rel.get("tag_name"), "published_at": rel.get("published_at"), "url": rel.get("html_url")}
        except Exception as e:
            item["latest_release"] = None; item["release_note"] = f"pas de release « latest » ({e})"
        item["links"] = [{"label": l.split("/")[-1].replace(".md", ""), "url": f"https://github.com/{r}/" + l} for l in w.get("links", [])]
        res.append(item)
    out = {"fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "projects": res}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for p in res:
        print(f"{p['name']:<10} ★ {p.get('stars', '?'):>7}  {p.get('license', '?'):<12} latest: {(p.get('latest_release') or {}).get('tag', '-')}  {p.get('error', '')}")

if __name__ == "__main__":
    main()
