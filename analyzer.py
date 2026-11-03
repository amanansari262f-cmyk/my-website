"""Symptom analyzer: multi-symptom, typo-tolerant, Hinglish-aware matching."""
import json
import re
from difflib import get_close_matches
from pathlib import Path

DATA_FILE = Path(__file__).parent / "data" / "conditions.json"

SEVERITY = {1: ("Mild", "low"), 2: ("Moderate", "mid"), 3: ("Needs care", "high")}

NEGATIONS = {"no", "not", "without", "nahi", "nahin", "never", "dont", "don't", "nope"}

# Emergency phrases -> shown above everything else
RED_FLAGS = [
    (r"chest (pain|pressure|tightness)|seene me dard", "Chest pain or pressure"),
    (r"(difficulty|trouble|hard) (in )?breathing|can'?t breathe|cannot breathe|shortness of breath|saans nahi", "Trouble breathing"),
    (r"unconscious|fainted|passed out|not responding|behosh", "Loss of consciousness"),
    (r"seizure|convulsion", "Seizure"),
    (r"blood in (vomit|stool|urine)|vomiting blood|coughing (up )?blood|bleeding heavily", "Bleeding"),
    (r"stroke|slurred speech|face drooping|paralysis|sudden weakness", "Possible stroke signs"),
    (r"suicid|kill myself|end my life|self harm|self-harm", "Thoughts of self-harm"),
    (r"severe allergic|swollen (face|lips|tongue)|anaphyla", "Severe allergic reaction"),
]


def _norm(text: str) -> str:
    text = text.lower().replace("’", "'")
    text = re.sub(r"[^a-z0-9' ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _stem(word: str) -> str:
    for suf in ("ing", "es", "s"):
        if word.endswith(suf) and len(word) - len(suf) >= 4:
            return word[: -len(suf)]
    return word


class Analyzer:
    def __init__(self, path: Path = DATA_FILE):
        self.conditions = json.loads(Path(path).read_text(encoding="utf-8"))
        self.by_slug = {c["slug"]: c for c in self.conditions}
        for c in self.conditions:
            c["severity_label"], c["severity_class"] = SEVERITY[c["severity"]]
            c["do"], c["avoid"] = self._split(c["precautions"])
            c["video_id"] = self._video_id(c.get("video"))
        # vocabulary: keyword phrase -> (condition list, weight)
        self.phrases = {}
        for c in self.conditions:
            for kw in c["keywords"]:
                k = _norm(kw)
                weight = 3.0 if k == _norm(c["key"]) else 2.0
                if " " not in k and len(k) <= 3:
                    weight = 1.5
                self.phrases.setdefault(k, []).append((c, weight))
        self.single_words = [p for p in self.phrases if " " not in p and len(p) >= 5]
        self.suggest_list = sorted({_norm(kw) for c in self.conditions for kw in c["keywords"] if len(kw) > 3})

    # -- helpers --------------------------------------------------------
    @staticmethod
    def _split(precautions):
        do, avoid = [], []
        for p in precautions:
            low = p.lower()
            if re.match(r"^(avoid|do not|don't|stay away|limit|reduce|wait)", low) and "consult" not in low:
                avoid.append(p)
            elif "consult" in low:
                continue  # shown in the dedicated 'see a doctor' block
            else:
                do.append(p)
        return do, avoid

    @staticmethod
    def _video_id(url):
        if not url:
            return None
        m = re.search(r"(?:shorts/|youtu\.be/|v=)([\w-]{11})", url)
        return m.group(1) if m else None

    def red_flags(self, text: str):
        t = _norm(text)
        return [label for pattern, label in RED_FLAGS if re.search(pattern, t)]

    # -- main -----------------------------------------------------------
    def analyze(self, raw: str):
        text = _norm(raw)
        tokens = text.split()
        scores, hits = {}, {}
        consumed = set()  # token indexes already explained by a phrase

        fillers = {"any", "have", "has", "got", "a", "the", "i"}

        def negated(start):
            if start >= 1 and tokens[start - 1] in NEGATIONS:
                return True
            return start >= 2 and tokens[start - 1] in fillers and tokens[start - 2] in NEGATIONS

        # 1) exact phrase matches (longest first so "high bp" beats "bp")
        for phrase in sorted(self.phrases, key=lambda p: -len(p)):
            n = len(phrase.split())
            for i in range(len(tokens) - n + 1):
                window = [_stem(t) for t in tokens[i:i + n]]
                if (" ".join(tokens[i:i + n]) == phrase or " ".join(window) == " ".join(_stem(w) for w in phrase.split())) \
                        and not consumed.intersection(range(i, i + n)):
                    consumed.update(range(i, i + n))
                    if negated(i):
                        continue
                    for cond, w in self.phrases[phrase]:
                        scores[cond["slug"]] = scores.get(cond["slug"], 0) + w
                        hits.setdefault(cond["slug"], []).append(phrase)

        # 2) fuzzy single-word matches for typos (e.g. "feaver", "vomitting")
        for i, tok in enumerate(tokens):
            if i in consumed or len(tok) < 5:
                continue
            close = get_close_matches(tok, self.single_words, n=1, cutoff=0.82)
            if close and not negated(i):
                for cond, w in self.phrases[close[0]]:
                    scores[cond["slug"]] = scores.get(cond["slug"], 0) + w * 0.8
                    hits.setdefault(cond["slug"], []).append(close[0])
                consumed.add(i)

        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        results = []
        for slug, sc in ranked[:4]:
            c = dict(self.by_slug[slug])
            c["score"] = round(sc, 1)
            c["strength"] = min(97, int(48 + 16 * sc))
            c["matched"] = sorted(set(hits[slug]))
            results.append(c)
        if results:  # keep ordering meaningful: weaker matches get a visibly lower bar
            top = results[0]["score"]
            for r in results[1:]:
                r["strength"] = max(20, int(r["strength"] * (0.55 + 0.45 * r["score"] / top)))
        flags = self.red_flags(raw)
        detected = sorted({h for r in results for h in r["matched"]})
        return {"results": results, "detected": detected, "flags": flags, "query": raw.strip()}

    def suggest(self, q: str, limit=6):
        q = _norm(q)
        if not q:
            return []
        last = q.split(" ")[-1]
        pool = [s for s in self.suggest_list if s.startswith(q)] or [s for s in self.suggest_list if last and s.startswith(last)]
        return pool[:limit]


analyzer = Analyzer()
