#!/usr/bin/env python3
"""Validation d'un rapport Bulle-AI-tin avant publication (à appeler depuis publish.py).
Usage : python3 validate_report.py data/2026-11-16.json [--schema ../schema.json]
Sortie : code 1 si une ERREUR (bloquante) ; les AVERTISSEMENTS n'empêchent pas la publication.

Règles produit contrôlées en plus du schéma :
  - toute mention {{id}} dans un texte a une entrée dans "models" ;
  - chaque modèle du registre a un propriétaire et une URL huggingface.co ;
  - un nom de modèle versionné écrit en clair (ex. « Qwen3.8 ») hors jeton est signalé ;
  - lo <= v <= hi, et p30 <= p90 <= p1y ;
  - les sources citées existent ; les domaines sont tous présents ;
  - la couverture géographique est calculée et comparée aux cibles de sources.json."""
import json, re, sys, os, argparse

TOKEN = re.compile(r"\{\{([^{}]+)\}\}")
# nom de famille suivi d'une version = mention de modèle (pas juste le nom du laboratoire)
BARE = re.compile(r"\b(Qwen|DeepSeek|Gemma|Kimi|GLM|Mistral|Mixtral|Ministral|MiniMax|Llama|LTX|Phi|Falcon|Nemotron|Granite)[- ]?(?:V|v)?\d[\w.\-]*")
SKIP_KEYS = {"family", "name", "id", "url", "title", "publisher", "owner", "what", "part", "hardware", "setup", "tps", "measure", "ctx", "repo", "label", "kind", "license", "version", "channel", "tools"}

def walk(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in SKIP_KEYS and isinstance(v, str): continue
            yield from walk(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o): yield from walk(v, f"{path}[{i}]")
    elif isinstance(o, str):
        yield path, o

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("report"); ap.add_argument("--schema"); ap.add_argument("--sources")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    schema_path = a.schema or os.path.join(here, "..", "schema.json")
    src_path = a.sources or os.path.join(here, "sources.json")
    r = json.load(open(a.report, encoding="utf-8")); errs, warns = [], []

    try:
        import jsonschema
        for e in sorted(jsonschema.Draft7Validator(json.load(open(schema_path, encoding="utf-8"))).iter_errors(r), key=lambda e: list(e.path)):
            errs.append("schéma " + "/".join(map(str, e.path)) + " : " + e.message[:160])
    except ImportError:
        warns.append("jsonschema absent : validation de schéma sautée (pip install jsonschema)")

    reg = {m.get("id"): m for m in r.get("models", [])}
    for m in r.get("models", []):
        if not str(m.get("url", "")).startswith("https://huggingface.co/"): errs.append(f"modèle {m.get('id')} : lien Hugging Face manquant")
        if not m.get("owner"): errs.append(f"modèle {m.get('id')} : propriétaire manquant")
    used = set()
    for p, t in walk({k: v for k, v in r.items() if k not in ("models", "schema")}):
        for tok in TOKEN.findall(t):
            used.add(tok.strip())
            if tok.strip() not in reg: errs.append(f"{p} : jeton {{{{{tok}}}}} absent du registre models")
        bare = BARE.findall(TOKEN.sub("", t))
        if bare: warns.append(f"{p} : nom de modèle versionné hors jeton ({', '.join(sorted(set(bare)))}) : ajouter {{{{org/Nom}}}}")
    for i in set(reg) - used: warns.append(f"modèle {i} dans le registre mais jamais cité")

    for s in r.get("scenarios", []):
        for h in ("p30", "p90", "p1y"):
            x = s[h]
            if not (x["lo"] <= x["v"] <= x["hi"]): errs.append(f"scénario {s['id']} {h} : lo <= v <= hi violé")
        if not (s["p30"]["v"] <= s["p90"]["v"] <= s["p1y"]["v"]): errs.append(f"scénario {s['id']} : probabilité plus basse à horizon plus long")
    ids = {s["id"] for s in r.get("scenarios", [])}
    for im in r.get("impacts", []):
        if im["scenario_id"] not in ids: errs.append(f"impact : scénario inconnu {im['scenario_id']}")

    ns = {s["n"] for s in r.get("sources", [])}
    def cited(o, p=""):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "sources" and isinstance(v, list) and all(isinstance(x, int) for x in v):
                    for n in v:
                        if n not in ns: errs.append(f"{p}: source [{n}] absente du registre")
                elif k != "sources": cited(v, f"{p}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o): cited(v, f"{p}[{i}]")
    cited({k: v for k, v in r.items() if k != "sources"})
    for p, t in walk({k: v for k, v in r.items() if k != "sources"}):
        for n in re.findall(r"\[(\d+)\]", t):
            if int(n) not in ns: errs.append(f"{p} : renvoi [{n}] absent du registre")

    # couverture géographique
    tot = max(1, len(r.get("sources", []))); cnt = {}
    for s in r.get("sources", []): cnt[s.get("region", "?")] = cnt.get(s.get("region", "?"), 0) + 1
    try:
        tg = json.load(open(src_path, encoding="utf-8")).get("coverage_targets", {})
        if cnt.get("AS", 0) / tot < tg.get("AS_min", 0): warns.append(f"couverture Asie {cnt.get('AS',0)}/{tot} sous la cible {tg['AS_min']:.0%}")
        if cnt.get("EU", 0) / tot < tg.get("EU_min", 0): warns.append(f"couverture Europe {cnt.get('EU',0)}/{tot} sous la cible {tg['EU_min']:.0%}")
        if cnt.get("NA", 0) / tot > tg.get("NA_max", 1): warns.append(f"Amérique du Nord {cnt.get('NA',0)}/{tot} au-dessus du plafond {tg['NA_max']:.0%}")
    except OSError: pass

    if not r.get("contradictions"):
        warns.append("aucune contradiction analysée : une veille sans désaccord entre sources est rare, vérifier que rien n'a été lissé")
    for c in r.get("contradictions", []):
        if c.get("verdict") == "tranche" and not (c["a"].get("sources") or c["b"].get("sources")):
            warns.append(f"contradiction « {c['topic']} » tranchée sans source citée")
    for w in warns: print("AVERTISSEMENT", w)
    for e in errs: print("ERREUR", e)
    print(f"{len(errs)} erreur(s), {len(warns)} avertissement(s) ; régions : {dict(sorted(cnt.items()))}")
    sys.exit(1 if errs else 0)

if __name__ == "__main__":
    main()
