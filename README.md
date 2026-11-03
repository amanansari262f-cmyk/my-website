# AI Health Assistant (v2)

Run: `pip install -r requirements.txt` then `python app.py` (http://127.0.0.1:5000). Production: `gunicorn app:app`.

- `app.py` routes: `/`, `/diagnosis`, `/api/analyze`, `/api/suggest`, `/conditions`, `/about`, `/healthz`
- `analyzer.py` multi-symptom, typo-tolerant, negation-aware matching + emergency red flags
- `data/conditions.json` knowledge base (20 conditions)
- `templates/`, `static/css/app.css`, `static/js/app.js` UI
- `assets_src/` original full-size doctor image

Educational use only, not medical advice.
