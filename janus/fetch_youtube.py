#!/usr/bin/env python3
"""Documents YouTube pour la chaîne d'analyse (youtube.json) : flux RSS officiel de la chaîne, puis transcripts en option.
À lancer SUR TON SERVEUR (l'outil de cette session n'a pas le droit de lire YouTube). Python 3.9+, bibliothèque standard.
  - Étape 1 (toujours) : le flux RSS public de la chaîne donne titre, date, description et lien des dernières vidéos.
  - Étape 2 (si "transcripts": true) : sous-titres automatiques via yt-dlp, s'il est installé. Sinon, la vidéo reste en RSS seul.
Les documents sont écrits en texte brut dans --out (un fichier par vidéo), avec un en-tête qui rappelle la règle :
« analyse secondaire : une piste, jamais un fait ». Ils n'entrent dans le rapport que par le bloc 'leads'.
Respecte les conditions d'utilisation de YouTube : peu de vidéos, pause entre les requêtes, aucun contournement si l'accès est refusé.
Usage : python3 fetch_youtube.py --out snapshots/2026-11-16/youtube [--since-days 2] [--rss-fixture feed.xml]"""
import json, os, re, sys, time, argparse, shutil, subprocess, tempfile, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "m": "http://search.yahoo.com/mrss/"}

def read_feed(channel_id, fixture=None):
    if fixture: return ET.parse(fixture).getroot()
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "bulle-ai-tin/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return ET.fromstring(r.read())

def videos(root, since):
    for e in root.findall("a:entry", NS):
        pub = datetime.fromisoformat(e.findtext("a:published", "", NS).replace("Z", "+00:00"))
        if pub < since: continue
        yield {"id": e.findtext("yt:videoId", "", NS), "title": e.findtext("a:title", "", NS), "published": pub.date().isoformat(),
               "url": (e.find("a:link", NS).get("href") if e.find("a:link", NS) is not None else ""),
               "description": (e.findtext("m:group/m:description", "", NS) or "").strip()}

def vtt_to_text(vtt):
    """Retire en-têtes, minutages et balises ; supprime les répétitions typiques des sous-titres automatiques."""
    out, last = [], ""
    for line in vtt.splitlines():
        line = line.strip()
        if not line or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")) or "-->" in line or re.fullmatch(r"\d+", line): continue
        line = re.sub(r"<[^>]+>", "", line).strip()
        if line and line != last: out.append(line); last = line
    return " ".join(out)

def transcript(video_url, lang, limit):
    if not shutil.which("yt-dlp"): return None, "yt-dlp absent : RSS seul"
    with tempfile.TemporaryDirectory() as tmp:
        cmd = ["yt-dlp", "--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", f"{lang}.*,{lang}", "--sub-format", "vtt", "-o", os.path.join(tmp, "v.%(ext)s"), video_url]
        try: subprocess.run(cmd, capture_output=True, timeout=120, check=False)
        except Exception as e: return None, f"yt-dlp : {e}"
        files = [f for f in os.listdir(tmp) if f.endswith(".vtt")]
        if not files: return None, "pas de sous-titres disponibles"
        return vtt_to_text(open(os.path.join(tmp, files[0]), encoding="utf-8", errors="replace").read())[:limit], None

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--since-days", type=int); ap.add_argument("--rss-fixture")
    a = ap.parse_args()
    cfg = json.load(open(os.path.join(HERE, "youtube.json"), encoding="utf-8"))
    since = datetime.now(timezone.utc) - timedelta(days=a.since_days or cfg.get("since_days", 2))
    os.makedirs(a.out, exist_ok=True); n = 0
    for ch in cfg["channels"]:
        try: root = read_feed(ch["id"], a.rss_fixture)
        except Exception as e: print(f"{ch['handle']} : flux RSS indisponible ({e})"); continue
        for v in list(videos(root, since))[:ch.get("max_videos", 3)]:
            body, note = (None, "transcripts désactivés")
            if ch.get("transcripts"):
                body, note = transcript(v["url"], ch.get("lang", "fr"), ch.get("max_chars_per_video", 12000)); time.sleep(cfg.get("pause_seconds", 3))
            doc = (f"SOURCE : {ch['publisher']}\nTYPE : analyse secondaire (piste à confirmer, jamais un fait)\nRÉGION : {ch['region']}\nDOMAINES : {', '.join(ch['domains'])}\n"
                   f"VIDÉO : {v['title']}\nDATE : {v['published']}\nLIEN : {v['url']}\nTRANSCRIPT : {'oui' if body else 'non (' + str(note) + ')'}\n\nDESCRIPTION\n{v['description']}\n")
            if body: doc += f"\nTRANSCRIPT\n{body}\n"
            open(os.path.join(a.out, f"yt-{ch['handle'].lstrip('@')}-{v['id']}.txt"), "w", encoding="utf-8").write(doc); n += 1
            print(f"{ch['handle']} · {v['published']} · {v['title'][:70]} · {'transcript' if body else 'RSS seul'}")
    print(f"{n} document(s) écrit(s) dans {a.out}")

if __name__ == "__main__":
    main()
