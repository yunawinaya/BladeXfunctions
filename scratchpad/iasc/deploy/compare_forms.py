"""Compare two IA form JSONs: handlers (by name) added / removed / changed, widgets (by model) added / removed / changed (minus their
children), and the config outside the event scripts. usage: python3 compare_forms.py <a.json> <b.json>"""
import json
import sys


def canon(o):
    return json.dumps(o, sort_keys=True, ensure_ascii=False)


def handlers(form):
    out = {}

    def walk(o, path):
        if isinstance(o, dict):
            if isinstance(o.get("func"), str):
                out[str(o.get("name") or path)] = o["func"]
            for k, v in o.items():
                walk(v, path + "." + k)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, path + "[%d]" % i)
    walk(form, "")
    return out


def widgets(form):
    out = {}

    def walk(o, parent):
        if isinstance(o, dict):
            if o.get("model") and o.get("type"):
                shallow = {k: v for k, v in o.items() if k not in ("list", "columns", "tabs", "tableColumns")}
                kids = [c.get("model") for k in ("list", "tableColumns") for c in (o.get(k) or []) if isinstance(c, dict)]
                out[o["model"]] = (canon(shallow), parent, kids)
                parent = o["model"]
            for v in o.values():
                walk(v, parent)
        elif isinstance(o, list):
            for v in o:
                walk(v, parent)
    walk(form.get("list", []), "")
    return out


def strip_funcs(o):
    if isinstance(o, dict):
        return {k: strip_funcs(v) for k, v in o.items() if k != "func"}
    if isinstance(o, list):
        return [strip_funcs(v) for v in o]
    return o


def main(a_path, b_path):
    a, b = json.load(open(a_path, encoding="utf-8")), json.load(open(b_path, encoding="utf-8"))
    ha, hb = handlers(a), handlers(b)
    print("handlers added:", sorted(set(hb) - set(ha)))
    print("handlers removed:", sorted(set(ha) - set(hb)))
    print("handlers changed:", sorted(k for k in set(ha) & set(hb) if ha[k] != hb[k]))
    wa, wb = widgets(a), widgets(b)
    print("widgets added:", sorted(set(wb) - set(wa)))
    print("widgets removed:", sorted(set(wa) - set(wb)))
    print("widgets changed (own options):", sorted(k for k in set(wa) & set(wb) if wa[k][0] != wb[k][0]))
    print("widgets moved / children changed:", sorted(k for k in set(wa) & set(wb) if wa[k][1:] != wb[k][1:]))
    ca = {k: v for k, v in a.get("config", {}).items() if k != "eventScript"}
    cb = {k: v for k, v in b.get("config", {}).items() if k != "eventScript"}
    print("config (outside events) changed keys:", sorted(k for k in set(ca) | set(cb) if canon(ca.get(k)) != canon(cb.get(k))))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
