import os

from flask import Flask, abort, jsonify, render_template, request

from analyzer import analyzer

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
MAX_LEN = 300

CATEGORIES = sorted({c["category"] for c in analyzer.conditions})
EXAMPLES = ["fever and cough", "sir dard", "stomach pain", "low bp", "hair fall", "chakkar aa rahe hain", "sore throat"]


def _clean_input(value):
    return (value or "").strip()[:MAX_LEN]


@app.context_processor
def inject_globals():
    return {"total_conditions": len(analyzer.conditions), "total_keywords": len(analyzer.phrases)}


@app.route("/")
def home():
    popular = [analyzer.by_slug[s] for s in ("fever", "cough", "headache", "stomach-pain", "cold", "dizziness", "hairfall", "diabetes")]
    return render_template("index.html", examples=EXAMPLES, popular=popular)


@app.route("/diagnosis", methods=["POST"])
def diagnosis():
    """No-JS fallback: full page render."""
    query = _clean_input(request.form.get("symptoms"))
    return render_template("result.html", analysis=analyzer.analyze(query))


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    payload = request.get_json(silent=True) or {}
    query = _clean_input(payload.get("symptoms"))
    if not query:
        return jsonify(ok=False, error="Please describe at least one symptom."), 400
    analysis = analyzer.analyze(query)
    html = render_template("_analysis.html", analysis=analysis)
    return jsonify(ok=True, html=html, matched=len(analysis["results"]), emergency=bool(analysis["flags"]))


@app.route("/api/suggest")
def api_suggest():
    return jsonify(analyzer.suggest(request.args.get("q", "")))


@app.route("/conditions")
def conditions():
    return render_template("conditions.html", conditions=analyzer.conditions, categories=CATEGORIES)


@app.route("/conditions/<slug>")
def condition(slug):
    c = analyzer.by_slug.get(slug)
    if not c:
        abort(404)
    related = [x for x in analyzer.conditions if x["category"] == c["category"] and x["slug"] != slug][:3]
    return render_template("condition.html", c=c, related=related)


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/healthz")
def healthz():
    return jsonify(status="ok", conditions=len(analyzer.conditions))


@app.errorhandler(404)
def not_found(_):
    return render_template("404.html"), 404


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG", "1") == "1", port=int(os.environ.get("PORT", 5000)))
