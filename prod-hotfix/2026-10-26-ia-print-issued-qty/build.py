"""LSH IA print (page 2069438052207247362, DEV v3 == PROD v3): a component's 'Request Raw Mat Qty' cell prints the line's picked /
issued quantity (total_quantity) instead of requested_qty (user, 2026-10-26, after IAH-2610-49: 40.5 requested printed, 2 issued).
Only that cell's expression, the components datasource field and the page's field map change. Writes lsh_ia_print.v4.json (the DEV
publish and the PROD paste: the same content).
   python3 prod-hotfix/2026-10-26-ia-print-issued-qty/build.py"""
import copy, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "lsh_ia_print.v3.deployed.json")
OUT = os.path.join(HERE, "lsh_ia_print.v4.json")
WAS = "requested_qty"
NOW = "total_quantity"


def find(x, key):
    if isinstance(x, dict):
        if x.get("key") == key:
            return x
        for v in x.values():
            r = find(v, key)
            if r:
                return r
    elif isinstance(x, list):
        for v in x:
            r = find(v, key)
            if r:
                return r
    return None


def build():
    base = json.load(open(BASE, encoding="utf-8"))
    page = copy.deepcopy(base)
    # the cell under 'Request Raw Mat Qty' (header lshia00064 in column lshia00065, 27mm; the row's cell lshia00038 > lshia00037)
    assert find(page["list"], "lshia00064")["options"]["defaultValue"] == "Request Raw Mat Qty"
    assert find(page["list"], "lshia00038")["options"]["width"] == find(page["list"], "lshia00065")["options"]["width"] == "27mm"
    cell = find(page["list"], "lshia00037")
    fx = cell["options"]["dynamicValueFx"]
    assert fx.count("flex_ia_components:" + WAS) == 2, fx
    cell["options"]["dynamicValueFx"] = fx.replace("flex_ia_components:" + WAS, "flex_ia_components:" + NOW)
    # the components datasource reads total_quantity in place of requested_qty (no other cell reads it), the page's field map too
    assert json.dumps(page["list"], ensure_ascii=False).count(WAS) == 1  # only more_fields left: no other cell reads it

    def comp(x):
        if isinstance(x, dict):
            o = x.get("options")
            if isinstance(o, dict) and WAS in (o.get("more_fields") or []):
                return x
            for v in x.values():
                r = comp(v)
                if r:
                    return r
        elif isinstance(x, list):
            for v in x:
                r = comp(v)
                if r:
                    return r
        return None

    c = comp(page["list"])
    mf = c["options"]["more_fields"]
    assert mf.count(WAS) == 1 and NOW not in mf
    c["options"]["more_fields"] = [NOW if f == WAS else f for f in mf]
    deps = page["config"]["deps"]["flex_ia_components"]
    assert deps.count([WAS]) == 2 and [NOW] not in deps
    page["config"]["deps"]["flex_ia_components"] = [[NOW] if d == [WAS] else d for d in deps]
    assert WAS not in json.dumps(page, ensure_ascii=False)
    return base, page


if __name__ == "__main__":
    base, page = build()
    json.dump(page, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote", OUT)
