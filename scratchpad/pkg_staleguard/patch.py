# PACKING_SAVE stale-copy guard (2026-10-26, PACK-2610-1012): a save from a copy loaded before someone else added lines
# (a Picking's P5 refresh) wrote its stale table_item_source over them. Refuse, before any write, a save that would drop
# live source rows the client never had: not in its payload, created after its copy (entry.update_time), by another user.
# Inserted right after the terminal-status guard (code_node_PkTermPrep .. if_PkTerm), so every saveAs passes through it.
# Usage: python3 patch.py   (writes out/PackingSaveWorkflowJSON.json)
import copy, json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "Packing/PackingSaveWorkflowJSON.json")
OUT = os.path.join(os.path.dirname(__file__), "out", "PackingSaveWorkflowJSON.json")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
raw = open(SRC).read()
w = json.loads(raw)


def find(o, i):
    if isinstance(o, dict):
        if o.get("id") == i:
            return o
        for v in o.values():
            r = find(v, i)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, i)
            if r:
                return r


if find(w, "sql_node_PkStale"):
    sys.exit("already patched")
T, P = "{{node:code_node_PkTermPrep.data.tenantId}}", "{{node:code_node_PkTermPrep.data.packingId}}"
SQL = f"""SELECT CAST('SRC' AS CHAR) AS kind, CAST(s.id AS CHAR) AS id, DATE_FORMAT(s.create_time, '%Y-%m-%d %H:%i:%s.%f') AS created, CAST(s.create_user AS CHAR) AS by_user
  FROM packing_jz8m9w3h_sub s
 WHERE s.tenant_id = '{T}'
   AND s.packing_id = {P}
   AND s.is_deleted = 0
UNION ALL
SELECT CAST('HUSRC' AS CHAR), CAST(h.id AS CHAR), DATE_FORMAT(h.create_time, '%Y-%m-%d %H:%i:%s.%f'), CAST(h.create_user AS CHAR)
  FROM packing_mudjw4xk_sub h
 WHERE h.tenant_id = '{T}'
   AND h.packing_id = {P}
   AND h.is_deleted = 0"""
CODE = """// a save from a copy loaded before someone else added lines (e.g. a Picking) would write its stale table_item_source over them
const entry = {{workflowparams:entry}} || {};
const rows = [{{node:sql_node_PkStale.data}}][0];
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const ms = (v) => {
  const m = String(v || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,6}))?/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Math.floor(Number(((m[7] || "0") + "000").slice(0, 3)))) : NaN;
};
const loaded = ms(entry.update_time);
const me = String([{{system:uid}}][0] || "");
const mine = new Set(list(entry.table_item_source).concat(list(entry.table_hu_source)).map((r) => String(r.id || "")).filter((x) => x));
const added = isNaN(loaded) ? [] : list(rows).filter((r) => !mine.has(String(r.id)) && ms(r.created) > loaded && String(r.by_user) !== me);
return {
  stale: added.length ? "1" : "0",
  message: "This Packing changed since you opened it: " + added.length + " line(s) were added meanwhile (for example by a Picking). Close it and open it again. Nothing was saved.",
};"""

sql_t, chk_t, if_t = find(w, "sql_node_PkTerm"), find(w, "code_node_PkTermChk"), find(w, "if_PkTerm")
sql_n = copy.deepcopy(sql_t)
sql_n["id"] = "sql_node_PkStale"
for k in ("title", "nodeName", "name"):
    sql_n["data"][k] = "Live Source Lines Of The Stored Packing"
sql_n["data"]["script"]["code"] = SQL
proto = sql_t["data"]["response_json"][0]
sql_n["data"]["response_json"] = [dict(copy.deepcopy(proto), key=k, name=n, title=n) for k, n in
                                   (("pkst7kd2", "kind"), ("pkst3qa9", "id"), ("pkst8mw4", "created"), ("pkst5vx1", "by_user"))]
chk_n = copy.deepcopy(chk_t)
chk_n["id"] = "code_node_PkStaleChk"
for k in ("title", "nodeName", "name"):
    chk_n["data"][k] = "Stale Copy Check"
chk_n["data"]["script"]["code"] = CODE
if "code" in chk_n["data"] and chk_n["data"].get("code"):
    chk_n["data"]["code"] = CODE
rp = chk_t["data"]["response_json"]
chk_n["data"]["response_json"] = [dict(copy.deepcopy(rp[0]), key="pksc4hz8", name="stale", title="stale"), dict(copy.deepcopy(rp[1]), key="pksc9tu3", name="message", title="message")]
if_n = copy.deepcopy(if_t)
if_n["id"] = "if_PkStale"
for k in ("title", "nodeName", "name"):
    if_n["data"][k] = "IF Stale Copy"
if_n["data"]["expression"]["code"] = "'{{node:code_node_PkStaleChk.data.stale}}' == '1'"
tb, fb = if_n["blocks"]
tb["id"], fb["id"] = "if_block_PkStale_t", "if_block_PkStale_f"
ret = tb["blocks"][0]
ret["id"] = "return_node_PkStale"
for k in ("title", "nodeName", "name"):
    if k in ret["data"]:
        ret["data"][k] = "Return Stale Copy"
for item in ret["data"]["response_value"]["list"]:
    if item["prop"] == "errorStatus":
        item["value"] = "\"staleCopy\""
    elif item["prop"] == "message":
        item["value"] = "{{node:code_node_PkStaleChk.data.message}}"
fb["blocks"] = []

ind = " " * 12
text = ",\n".join("\n".join(ind + l for l in json.dumps(n, ensure_ascii=False, indent=2).splitlines()) for n in (sql_n, chk_n, if_n)) + ",\n"
anchor = ind + "{\n" + ind + '  "id": "code_node_PkStoredPrep",'
if raw.count(anchor) != 1:
    sys.exit(f"anchor found {raw.count(anchor)} times")
out = raw.replace(anchor, text + anchor)
json.loads(out)
open(OUT, "w").write(out)
print("ok", OUT)
