#!/usr/bin/env python3
"""Étapes 1 et 2 : extraction par domaine, puis synthèse du rapport JSON v2 avec un LLM local.
Les FAITS CHIFFRÉS (Top 3 Hugging Face, stars/forks/licence GitHub) viennent des scripts déterministes (out/hf.json, out/github.json)
et écrasent toujours la sortie du LLM. Le LLM commente (why, watch, notes) et analyse les contradictions.
API compatible OpenAI (/v1/chat/completions), sortie contrainte par JSON Schema.
Usage : python3 generate.py --snapshot snapshots/DATE --prev ../data/PREC.json --hf out/hf.json --gh out/github.json --out out/DATE.json
Env : JANUS_ENDPOINT (http://127.0.0.1:8080/v1), JANUS_MODEL (local), JANUS_API_KEY (jamais commitée), JANUS_CTX_CHARS (24000). Bibliothèque standard seulement."""
import argparse, datetime as dt, json, os, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE.parent / "schema.json").read_text(encoding="utf-8"))
DOMAINS = [("finance", "Finance, IPO, bulle"), ("frontier", "Modèles de pointe"), ("open", "Modèles ouverts"), ("local", "IA locale"),
           ("hardware", "Matériel RAM, SSD, GPU"), ("geo", "Géopolitique et régulation"), ("tech", "Technologies à venir"), ("adopt", "Adoption en entreprise")]
FACTS_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["facts"], "properties": {"facts": {"type": "array", "maxItems": 12, "items": {
    "type": "object", "additionalProperties": False, "required": ["doc", "fact", "strength", "why"],
    "properties": {"doc": {"type": "integer", "minimum": 1}, "date": {"type": "string"}, "fact": {"type": "string", "maxLength": 300},
                   "strength": {"type": "string", "enum": ["fort", "faible", "bruit"]}, "why": {"type": "string"}, "hf": {"type": "string"},
                   "palier": {"type": "string", "enum": ["rumeur", "teaser", "preview", "poids", "vide"]}, "piste": {"type": "boolean"}, "verifier": {"type": "string"}}}}}}
ENDPOINT = os.environ.get("JANUS_ENDPOINT", "http://127.0.0.1:8080/v1").rstrip("/")
MODEL = os.environ.get("JANUS_MODEL", "local")
API_KEY = os.environ.get("JANUS_API_KEY", "")
CTX = int(os.environ.get("JANUS_CTX_CHARS", "24000"))

def strip_json(text):
    t = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.I).strip()
    return json.loads(t[t.find("{"):t.rfind("}") + 1])

def llm(prompt, schema, name, retries=1):
    body = {"model": MODEL, "temperature": 0.2, "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}}
    headers = {"Content-Type": "application/json"}
    if API_KEY: headers["Authorization"] = "Bearer " + API_KEY
    last = None
    for _ in range(retries + 1):
        req = urllib.request.Request(ENDPOINT + "/chat/completions", data=json.dumps(body).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=1800) as r:
                return strip_json(json.loads(r.read())["choices"][0]["message"]["content"])
        except (ValueError, KeyError) as e:
            last = e
            body["messages"].append({"role": "user", "content": f"Ta réponse n'était pas un JSON valide ({e}). Renvoie uniquement l'objet JSON."})
    raise RuntimeError(f"{name} : échec après {retries + 1} essais ({last})")

def batches(docs, limit):
    cur, size = [], 0
    for d in docs:
        block = f'<doc n="{d["n"]}" title="{d["title"]}" publisher="{d["publisher"]}" region="{d.get("region","")}">\n{d["text"]}\n</doc>\n'
        if cur and size + len(block) > limit: yield "".join(cur); cur, size = [], 0
        cur.append(block[:limit]); size += len(block)
    if cur: yield "".join(cur)

def load_opt(path):
    return json.loads(Path(path).read_text(encoding="utf-8")) if path and Path(path).exists() else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True); ap.add_argument("--prev"); ap.add_argument("--hf", default="out/hf.json"); ap.add_argument("--gh", default="out/github.json")
    ap.add_argument("--hf-status", default="", help="message si le relevé HF a été écarté (périmé) : devient une contradiction")
    ap.add_argument("--zone", default="monde"); ap.add_argument("--focus", default="IA locale grand public"); ap.add_argument("--frequence", default="quotidien")
    ap.add_argument("--date", default=dt.date.today().isoformat()); ap.add_argument("--period", default="")
    ap.add_argument("--out", default="report.json"); ap.add_argument("--keep-facts", default="facts.json")
    a = ap.parse_args()

    snap = Path(a.snapshot); manifest = json.loads((snap / "manifest.json").read_text(encoding="utf-8"))
    docs = []
    for d in manifest["docs"]:
        if d.get("ok"): d["text"] = (snap / d["file"]).read_text(encoding="utf-8"); docs.append(d)
    if not docs: sys.exit("Aucun document dans l'instantané.")
    registry = {d["n"]: d for d in docs}
    prev = load_opt(a.prev); hf = load_opt(a.hf); gh = load_opt(a.gh)
    watch = json.loads((HERE / "watchlist.json").read_text(encoding="utf-8"))
    period = a.period or (f"{prev['date']} → {a.date}" if prev else f"jusqu'au {a.date}")

    extract_tpl = (HERE / "prompts" / "extract.txt").read_text(encoding="utf-8")
    facts = []
    for dom_id, dom_name in DOMAINS:
        dom_docs = [d for d in docs if dom_id in d.get("domains", [])]; ns = {d["n"] for d in dom_docs}
        for chunk in batches(dom_docs, CTX):
            out = llm(extract_tpl.replace("{{DOMAIN}}", f"{dom_name} ({dom_id})").replace("{{PERIOD}}", period).replace("{{DOCS}}", chunk), FACTS_SCHEMA, "facts")
            facts += [dict(f, domain=dom_id) for f in out.get("facts", []) if f.get("doc") in ns]
        print(f"[1/2] {dom_id} : {sum(1 for f in facts if f['domain'] == dom_id)} faits", file=sys.stderr)
    Path(a.keep_facts).write_text(json.dumps(facts, ensure_ascii=False, indent=1), encoding="utf-8")

    config = {"zone": a.zone, "focus": a.focus, "frequence": a.frequence}
    reg_txt = "\n".join(f'[{n}] ({d.get("region","?")}) {d["title"]} — {d["publisher"]}' for n, d in sorted(registry.items()))
    hf_txt = json.dumps(hf, ensure_ascii=False) if hf else f"RELEVÉ ABSENT ({a.hf_status or 'échec'}). Recopie hf_trending du rapport précédent et ajoute une contradiction « donnee_suspecte »."
    p = ((HERE / "prompts" / "synthesize.txt").read_text(encoding="utf-8")
         .replace("{{DATE}}", a.date).replace("{{CONFIG}}", json.dumps(config, ensure_ascii=False))
         .replace("{{PREV}}", json.dumps(prev, ensure_ascii=False) if prev else "aucun").replace("{{REGISTRY}}", reg_txt)
         .replace("{{HF}}", hf_txt).replace("{{WATCHLIST}}", json.dumps(watch, ensure_ascii=False))
         .replace("{{GH}}", json.dumps(gh, ensure_ascii=False) if gh else "RELEVÉ ABSENT (API GitHub refusée) : garde les chiffres de la veille et signale-le dans 'watch'.")
         .replace("{{FACTS}}", json.dumps([f for f in facts if f["strength"] != "bruit"], ensure_ascii=False)))
    report = llm(p, SCHEMA, "report"); print("[2/2] synthèse terminée", file=sys.stderr)

    # --- post-traitement déterministe : les relevés scriptés écrasent le LLM ---
    report.update(schema=2, date=a.date, period=report.get("period") or period, config=config, generator=f"janus/{MODEL}")
    if hf:
        old = {e["id"]: e for k in ("top3", "top3_official") for e in (report.get("hf_trending") or {}).get(k, [])}
        h = dict(hf["hf_trending"])
        for k in ("top3", "top3_official"):
            h[k] = [dict(e, **({"why": old[e["id"]]["why"]} if e["id"] in old and old[e["id"]].get("why") else {})) for e in h[k]]
        h["note"] = (report.get("hf_trending") or {}).get("note", "")
        report["hf_trending"] = h
        have = {m["id"] for m in report.get("models", [])}
        report["models"] = report.get("models", []) + [m for m in hf["models"] if m["id"] not in have]
    if gh:
        by = {x["repo"]: x for x in gh["projects"] if "error" not in x}
        for pr in report.get("projects", []):
            g = by.get(pr["repo"])
            if g: pr.update(stars=g["stars"], forks=g["forks"], license=g["license"], owner=g["owner"])
    cited = {n for m in re.finditer(r"\[(\d+)\]", json.dumps(report, ensure_ascii=False)) for n in [int(m.group(1))]}
    def collect(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "sources" and isinstance(v, list): cited.update(x for x in v if isinstance(x, int))
                else: collect(v)
        elif isinstance(o, list): [collect(x) for x in o]
    collect({k: v for k, v in report.items() if k != "sources"})
    report["sources"] = [{k: v for k, v in {"n": n, "title": registry[n]["title"], "publisher": registry[n]["publisher"], "region": registry[n].get("region", "GLOBAL"),
                          "date": registry[n].get("fetched", "")[:10], "url": registry[n]["url"]}.items() if v} for n in sorted(cited) if n in registry]
    Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Rapport écrit : {a.out} (N{report['alert']['level']}, {len(report.get('contradictions', []))} contradiction(s))")

if __name__ == "__main__":
    main()
