#!/usr/bin/env python3
"""Étape 0 : fige les sources documentaires dans un instantané daté (texte brut).
Les sources « données » (API Hugging Face, API GitHub) sont lues par des scripts déterministes (hf_snapshot.py, gh_snapshot.py), pas ici.
Les transcripts YouTube (fetch_youtube.py) déposés dans l'instantané sont ajoutés au manifeste en type « analyse secondaire ».
Usage : python3 fetch_sources.py --sources sources.json --out snapshots [--date AAAA-MM-JJ]
Sortie : snapshots/DATE/*.txt + manifest.json (n, id, title, publisher, url, region, type, domains, ok, error).
Une source en échec n'arrête rien : elle est listée dans le manifeste et dans coverage_gaps. Bibliothèque standard seulement."""
import argparse, datetime as dt, html, json, re, sys, urllib.request
from html.parser import HTMLParser
from pathlib import Path

MAX_CHARS = 40000
DETERMINISTIC = {"hf-api-trending", "github-api"}  # lus par scripts, jamais par le LLM

class TextExtractor(HTMLParser):
    SKIP = {"script", "style", "nav", "footer", "header", "noscript", "svg", "form"}
    def __init__(self): super().__init__(); self.parts, self.depth = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP: self.depth += 1
        elif tag in {"p", "br", "li", "h1", "h2", "h3", "h4", "tr", "div"}: self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth: self.depth -= 1
    def handle_data(self, data):
        if not self.depth: self.parts.append(data)

def html_to_text(raw):
    p = TextExtractor(); p.feed(raw)
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t]+", " ", "".join(p.parts))).strip()

def feed_to_text(raw):
    out = []
    for m in re.finditer(r"<(item|entry)\b(.*?)</\1>", raw, flags=re.S | re.I):
        b = m.group(2)
        get = lambda t: (re.search(rf"<{t}[^>]*>(.*?)</{t}>", b, re.S | re.I) or [None, ""])[1]
        clean = lambda x: html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", x))
        title, date = clean(get("title")).strip(), (get("pubDate") or get("updated") or get("published")).strip()
        desc = html_to_text(clean(get("description") or get("summary") or get("content")))
        out.append(f"- [{date}] {title}\n  {desc[:800]}")
    return "\n".join(out)

def fetch(url):
    if not url.startswith("https://"): raise ValueError("https uniquement")
    req = urllib.request.Request(url, headers={"User-Agent": "bulle-ai-tin/1.0 (veille personnelle)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        ctype = r.headers.get("Content-Type", "")
        raw = r.read(5_000_000).decode(r.headers.get_content_charset() or "utf-8", errors="replace")
    if "xml" in ctype or raw.lstrip().startswith("<?xml") or "<rss" in raw[:500]:
        return feed_to_text(raw) or html_to_text(raw)
    return html_to_text(raw)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default="sources.json"); ap.add_argument("--out", default="snapshots")
    ap.add_argument("--date", default=dt.date.today().isoformat())
    a = ap.parse_args()
    cfg = json.loads(Path(a.sources).read_text(encoding="utf-8"))
    snap = Path(a.out) / a.date; snap.mkdir(parents=True, exist_ok=True)
    docs, ok, n = [], 0, 0
    for s in cfg["sources"]:
        if s["id"] in DETERMINISTIC or s["id"].startswith("yt-"): continue
        n += 1
        e = {"n": n, "id": s["id"], "title": s.get("title", s["id"]), "publisher": s.get("publisher", ""), "url": s["url"],
             "region": s.get("region", "GLOBAL"), "type": s.get("type", ""), "domains": s.get("domains", []), "file": f"{s['id']}.txt", "ok": False}
        try:
            text = fetch(s["url"])[:MAX_CHARS]
            (snap / e["file"]).write_text(text, encoding="utf-8")
            e.update(ok=True, chars=len(text), fetched=dt.datetime.now().isoformat(timespec="seconds")); ok += 1
        except Exception as ex:
            e["error"] = str(ex)[:200]; print(f"[warn] {s['id']} : {ex}", file=sys.stderr)
        docs.append(e)
    # transcripts YouTube éventuels (déposés par fetch_youtube.py) : analyse secondaire, domaines « tech » et « adopt »
    for f in sorted(snap.glob("yt-*.txt")):
        n += 1
        head = f.read_text(encoding="utf-8").splitlines()[:3]
        url = next((l.split(" ", 1)[1].strip() for l in head if l.lower().startswith("url:")), "https://www.youtube.com/")
        docs.append({"n": n, "id": f.stem, "title": f.stem, "publisher": "YouTube (analyse secondaire)", "url": url, "region": "EU",
                     "type": "analyse secondaire", "domains": ["tech", "adopt", "local"], "file": f.name, "ok": True,
                     "chars": f.stat().st_size, "fetched": dt.datetime.now().isoformat(timespec="seconds")})
        ok += 1
    gaps = [d["id"] for d in docs if not d["ok"]]
    (snap / "manifest.json").write_text(json.dumps({"date": a.date, "docs": docs, "coverage_gaps": gaps}, ensure_ascii=False, indent=1), encoding="utf-8")
    reg = {}
    for d in docs:
        if d["ok"]: reg[d["region"]] = reg.get(d["region"], 0) + 1
    print(f"Instantané {snap} : {ok}/{len(docs)} sources ; régions {reg} ; en échec : {gaps or 'aucune'}")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
