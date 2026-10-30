"""Build the Picking form (transfer_order 1935556443668959233, eventScript 14 = Picking/AsyncV2/pkV2_onSave_Completed.js) and
Picking list (page 1935635853539348481, eventScript 24 = Picking/AsyncV2/pkV2_listAutoPick.js) with the GD Complete drain
(10-29) from the ENABLED version of the given environment. Each base's handler must still be the pre-drain handler
(*.pre_drain.js), and nothing but the handler may differ.   usage: python3 build.py dev|prod"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
ITEMS = [("PickingFullJSON", "su_code_tables_history", "form_json", "1935556443668959233", 14, "pkV2_onSave_Completed"),
         ("PickingListPageFullJSON", "su_code_pages_history", "page_json", "1935635853539348481", 24, "pkV2_listAutoPick")]
env = sys.argv[1]


def diff_paths(a, b, p=""):
    if isinstance(a, dict) and isinstance(b, dict):
        return [x for k in sorted(set(a) | set(b)) for x in diff_paths(a.get(k), b.get(k), p + "/" + k)]
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [x for i in range(len(a)) for x in diff_paths(a[i], b[i], p + "/" + str(i))]
    return [] if a == b else [p]


for name, table, col, did, idx, js in ITEMS:
    out = subprocess.run([R + ".dbtools/db", "--" + env, "--json", f"SELECT version_number v, {col} j FROM {table} WHERE data_id = {did} AND status = 'enabled' ORDER BY id DESC LIMIT 1"], capture_output=True, text=True, check=True).stdout
    row = json.loads(out[out.find("["):])[0]
    base = json.loads(row["j"])
    pre = open(os.path.join(HERE, js + ".pre_drain.js")).read()
    new = open(R + "Picking/AsyncV2/" + js + ".js").read()
    assert base["config"]["eventScript"][idx]["func"].rstrip() == pre.rstrip(), f"{name} {env}: eventScript {idx} is not the pre-drain handler"
    page = json.loads(json.dumps(base))
    page["config"]["eventScript"][idx]["func"] = new.rstrip()
    assert diff_paths(base, page) == ["/config/eventScript/%d/func" % idx]
    bf = os.path.join(HERE, f"{name}.{env}_v{row['v']}.base.json")
    pf = os.path.join(HERE, f"{name}.{env}_drain.json" if env == "dev" else f"{name}.prod_paste.json")
    json.dump(base, open(bf, "w"), ensure_ascii=False, indent=1)
    json.dump(page, open(pf, "w"), ensure_ascii=False, indent=1)
    print(f"{name} {env} v{row['v']}: eventScript {idx} replaced -> {os.path.basename(pf)}")
