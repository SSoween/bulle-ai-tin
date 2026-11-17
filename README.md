# Bulle-AI-tin

**Classification : Internal use only (L2).** Source du niveau : contenu public (L1) compilé pour usage personnel ; défaut L2.

Clone de l'UX de *canar-ai-n-the-mine*, appliqué à l'IA : une PWA hors ligne alimentée chaque jour par Janus. Palette froide (turquoise, bleu, violet).
Ce qui a changé depuis la veille est mis en évidence (▲ ▼ ► 🆕, « = IDEM »).

## Ce qui est différent du Canari

| Sujet | Choix |
|---|---|
| N0 à N4 | Risque de **bulle IA** (SAIN, ÉCHAUFFEMENT, TENDU, SURCHAUFFE, ÉCLATEMENT). Couleurs froides, jamais de jaune/orange/rouge. |
| 8 domaines | finance, frontier, open, local, hardware, geo, tech, adopt |
| Hugging Face | Top 3 tendance (tous dépôts + laboratoires officiels), rang et score comparés à la veille. Relevé par `janus/hf_snapshot.py`, **sans LLM**. |
| Modèles | Toute mention s'écrit `{{org/Nom}}` ; l'app la rend en lien Hugging Face + propriétaire (Alibaba, DeepSeek…). Un jeton sans registre est refusé par `validate_report.py`. |
| Modèles suivis | `janus/watchlist.json` : propriétaire, dernière version, prochaine mise à niveau sur une échelle rumeur, teaser, preview, poids publiés. |
| IA locale | Débits mesurés sur carte unique grand public (24 à 32 Go), avec matériel, moteur, contexte, qui a mesuré. |
| Matériel | RAM, SSD, GPU : tendance, et pour chaque pièce « si j'achète / si j'attends 3 à 6 mois ». |
| Projets GitHub | Strata, Colibri, llama.cpp, Unsloth : étoiles, forks, licence, version, mise en garde, liens. Relevé par `janus/gh_snapshot.py` (sans LLM). La release « latest » peut retarder sur le README : les deux sont signalées. |
| YouTube | Eliott Meunier via `janus/fetch_youtube.py` : flux RSS officiel, transcripts en option (désactivés par défaut). Résultat = bloc **Pistes**, jamais des faits. |
| Design | Coins nets (biseau haut-gauche/bas-droit sur Chrome et Edge récents), cartes gris graphite avec quadrillage et repères d'angle, comme AI Multiverse. Palette froide. |
| Vue internationale | Chaque source porte une région. Cibles : Asie ≥ 1/3, Europe ≥ 1/4, Amérique du Nord ≤ 1/4. L'app affiche la couverture réelle de chaque rapport. |

## Fichiers

```
index.html · style.css · app.js · sw.js · manifest.webmanifest · icons/   PWA
schema.json                         format v2 (génération, validation, PWA)
data/2026-11-16.json                rapport de référence (réel)
data/sample-prev.json               veille FICTIVE pour voir les variations (menu ⋯ > exemple)
janus/sources.json                  registre de sources par région
janus/watchlist.json                modèles préférés + échelle de certitude
janus/owners.json                   org Hugging Face -> propriétaire, pays
janus/hf_snapshot.py                relevé HF déterministe
janus/gh_snapshot.py                relevé GitHub déterministe (github_watch.json)
janus/fetch_youtube.py              RSS + transcripts optionnels (youtube.json)
janus/validate_report.py            validation avant publication
janus/prompts/                      extract.txt et synthesize.txt (v2)
_build/                             scripts qui régénèrent schema, sources et données d'exemple
```

## À brancher dans Janus (non fait)

`generate.py`, `publish.py`, `fetch_sources.py` et `run.sh` du Canari restent à adapter :
1. appeler `hf_snapshot.py`, `gh_snapshot.py` et `fetch_youtube.py` avant la synthèse ; injecter `out/github.json` dans `{{GH}}` et les documents YouTube dans les faits à extraire ;
1b. appeler `hf_snapshot.py` avant la synthèse et injecter `out/hf.json` dans `{{HF}}` ;
2. injecter `watchlist.json` dans `{{WATCHLIST}}` et le registre dans `{{REGISTRY}}` (avec la région) ;
3. appeler `validate_report.py` dans `publish.py` à la place de la validation v1 ;
4. fusionner le bloc `hf_trending` du script par-dessus celui du LLM (le script fait foi).

## Contradictions : de l'analyse, pas de l'exécution (v2.1)

Le bloc `contradictions` du rapport (section « Écarts et contradictions », ouverte par défaut) expose chaque désaccord entre sources : version A, version B (avec numéros de sources), verdict (`tranche`, `ouvert`, `donnee_suspecte`), analyse de la cause probable, impact, et ce qui trancherait. Règles :

- Une contradiction n'est jamais lissée ni retirée pour « faire propre » ; elle reste tant que rien ne la tranche.
- Un relevé scripté périmé ou en échec (cache HF, API GitHub refusée) est consigné comme contradiction, pas masqué (`run.sh` transmet `--hf-status` à `generate.py`).
- `validate_report.py` avertit si un rapport n'a aucune contradiction (rare en pratique) ou si une contradiction « tranchée » ne cite aucune source.
- Le prompt de synthèse (règle 12) précise que les demandes ou hypothèses précédentes ne priment pas sur les faits.

## Janus v2

`janus/run.sh` : `hf_snapshot.py --prev` (garde-fou anti-cache) → `gh_snapshot.py` → `fetch_youtube.py` (si `YOUTUBE=1`, sur ton serveur) → `fetch_sources.py` → `generate.py` (les relevés scriptés écrasent toujours le LLM) → `publish.py` (validation, `data/`, `git push`).
Variables : `JANUS_ENDPOINT`, `JANUS_MODEL`, `GITHUB_TOKEN` (optionnel, jamais commité), `ZONE`, `FOCUS`, `FREQ`.

Classification : Internal use only (L2), source : veille publique (sources.json) sans donnée Ubisoft.
