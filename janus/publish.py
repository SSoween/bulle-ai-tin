#!/usr/bin/env python3
"""Étape 3 : valide un rapport v2 (validate_report.py : schéma, jetons de modèles, registre HF, couverture) puis le publie dans data/.
Usage : python3 publish.py out/DATE.json --check-only | --repo .. [--git]
Les AVERTISSEMENTS (couverture, noms de modèles nus, aucune contradiction) n'empêchent pas la publication ; les ERREURS, si.
Le push utilise les identifiants git déjà configurés (clé de déploiement conseillée). Aucun jeton dans ce script."""
import argparse, json, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LABELS = ["SAIN", "ECHAUFFEMENT", "TENDU", "SURCHAUFFE", "ECLATEMENT"]
DOMAIN_IDS = {"finance", "frontier", "open", "local", "hardware", "geo", "tech", "adopt"}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("report"); ap.add_argument("--repo", default=str(HERE.parent))
    ap.add_argument("--check-only", action="store_true"); ap.add_argument("--git", action="store_true")
    a = ap.parse_args()
    raw = re.sub(r"^```(?:json)?|```$", "", Path(a.report).read_text(encoding="utf-8").strip(), flags=re.I).strip()
    r = json.loads(raw)
    errs = []
    ids = [d["id"] for d in r.get("domains", [])]
    if set(ids) != DOMAIN_IDS or len(ids) != 8: errs.append("domains : il faut exactement les 8 ids, sans doublon")
    lv = r.get("alert", {}).get("level")
    if lv not in range(5) or r["alert"].get("label") != LABELS[lv]: errs.append(f"alert : label incohérent avec level {lv}")
    for d in r.get("domains", []):
        if len(d.get("note", "")) > 160: errs.append(f"domaine {d['id']} : note > 160 caractères")
    if errs:
        print(*["[erreur] " + e for e in errs], sep="\n"); sys.exit("Rapport refusé (contrôles de base).")
    v = subprocess.run([sys.executable, str(HERE / "validate_report.py"), a.report,
                        "--schema", str(Path(a.repo) / "schema.json"), "--sources", str(HERE / "sources.json")])
    if v.returncode: sys.exit("Rapport refusé par validate_report.py.")
    print(f"Rapport valide : {r['date']} · N{lv} · {r.get('generator', 'inconnu')} · {len(r.get('contradictions', []))} contradiction(s)")
    if a.check_only: return
    data = Path(a.repo) / "data"; data.mkdir(exist_ok=True)
    name = f"{r['date']}.json"
    (data / name).write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    ip = data / "index.json"; idx = json.loads(ip.read_text(encoding="utf-8")) if ip.exists() else []
    idx = sorted({f for f in idx if not f.startswith("sample-")} | {name})
    ip.write_text(json.dumps(idx, indent=1), encoding="utf-8")
    print(f"Publié : data/{name} ({len(idx)} rapport(s))")
    if a.git:
        run = lambda *c: subprocess.run(["git", "-C", a.repo, *c], check=True)
        run("add", f"data/{name}", "data/index.json")
        run("commit", "-m", f"Bulletin {r['date']} (N{lv}, {r.get('generator', '?')})"); run("push")
        print("Poussé sur le dépôt.")

if __name__ == "__main__":
    main()
