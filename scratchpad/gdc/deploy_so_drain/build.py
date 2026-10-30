"""Pull the enabled SO list page (1901872125787099137) from dev or prod and build the page with the repo's convert handler
(Goods Delivery/GDhandleConvertSOtoGD.js = eventScript 43 func_handleConvertGD). The base's handler must be the committed
(HEAD) handler, and nothing but that handler may differ.   usage: python3 build.py dev|prod"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
env = sys.argv[1]
out = subprocess.run([R + ".dbtools/db", "--" + env, "--json", "SELECT version_number v, page_json j FROM su_code_pages_history WHERE data_id = 1901872125787099137 AND status = 'enabled' ORDER BY id DESC LIMIT 1"], capture_output=True, text=True, check=True).stdout
row = json.loads(out[out.find("["):])[0]
base = json.loads(row["j"])
head = subprocess.run(["git", "show", "HEAD:Goods Delivery/GDhandleConvertSOtoGD.js"], capture_output=True, text=True, cwd=R, check=True).stdout
new = open(R + "Goods Delivery/GDhandleConvertSOtoGD.js").read()
idx = [i for i, h in enumerate(base["config"]["eventScript"]) if h.get("name") == "func_handleConvertGD"]
assert len(idx) == 1, idx
i = idx[0]
assert base["config"]["eventScript"][i]["func"].rstrip() == head.rstrip(), "the live handler is not the committed one"
page = json.loads(json.dumps(base))
page["config"]["eventScript"][i]["func"] = new.rstrip()


def diff_paths(a, b, p=""):
    if isinstance(a, dict) and isinstance(b, dict):
        return [x for k in sorted(set(a) | set(b)) for x in diff_paths(a.get(k), b.get(k), p + "/" + k)]
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [x for k in range(len(a)) for x in diff_paths(a[k], b[k], p + "/" + str(k))]
    return [] if a == b else [p]


assert diff_paths(base, page) == ["/config/eventScript/%d/func" % i]
bf = os.path.join(HERE, "SO_list.%s_v%s_base.json" % (env, row["v"]))
pf = os.path.join(HERE, "SO_list.%s_drain.json" % env if env == "dev" else "SO_list.prod_paste.json")
json.dump(base, open(bf, "w"), ensure_ascii=False, indent=1)
json.dump(page, open(pf, "w"), ensure_ascii=False, indent=1)
print("%s v%s: eventScript %d replaced -> %s (base %s)" % (env, row["v"], i, os.path.basename(pf), os.path.basename(bf)))
