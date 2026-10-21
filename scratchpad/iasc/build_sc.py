"""Small Cycle IA workflows (scratchpad/iasc/CONTRACT.md): SO_IA_PROJECTION (read-only) and IA_SC_RELINK.

usage: python3 scratchpad/iasc/build_sc.py [--write] [NAME ...]
Writes <repo>/Item Assembly & BOM/SmallCycle/<NAME>.json with --write. Uses the iav2 workflow kit (scratchpad/iav2/lib)."""
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "iav2", "lib"))
sys.path.insert(0, os.path.join(HERE, "code", "shared"))
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402
import sql as S  # noqa: E402

CODE = os.environ.get("IASC_CODE") or os.path.join(HERE, "code")
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
IA_TABLE = "Item Assembly:Table:2098256587713404929"
N = V.N


def node(nid, title, path, names, objects=(), arrays=()):
    body = V.include_js(CODE, "shared/sc_proj.js") + "\n" + V.raw(CODE, path)
    return K.code(nid, title, body, names, arrays=arrays, objects=objects)


def ret(nid, title, src):
    return K.ret(nid, title, [("code", N(src, "data.code")), ("message", N(src, "data.message")), ("result_json", N(src, "data.result_json"))])


def build_projection():
    ids = K.Ids(1792000000000)
    G = "code_node_SPguard"
    t, line, so, item, org, uid = N(G, "data.tenantId"), N(G, "data.line"), N(G, "data.so"), N(G, "data.item"), N(G, "data.org"), N(G, "data.uid")
    j = ["j"]
    summary = [
        K.parallel("condition_all_SPread", "SUMMARY reads (independent, one join)", [
            ("cai_SPline", "Line + header", [K.sql("sql_node_SPline", "The line (deleted too) and its SO header", V.sub(S.P_LINE, T=t, LINE=line, SO=so), j)]),
            ("cai_SPias", "Linked IAs", [K.sql("sql_node_SPias", "The IAs linked to this line", V.sub(S.P_IAS, T=t, ORG=org, LINEQ=line), j)]),
            ("cai_SPfg", "FG", [K.sql("sql_node_SPfg", "The FG item and its UOM conversions", V.sub(S.P_FG, T=t, ITEM=item), j)]),
            ("cai_SPrelink", "Re-link candidates", [K.sql("sql_node_SPrelink", "Live lines of the same SO for the same item", V.sub(S.P_RELINK, T=t, LINE=line, SO=so, ITEMQ=item), j)]),
            ("cai_SPorphans", "Orphans", [K.sql("sql_node_SPorphans", "IAs of this SO whose line no longer exists", V.sub(S.P_ORPHANS, T=t, ORG=org, LINE=line, SO=so), j)]),
            ("cai_SPmember", "Member", [K.sql("sql_node_SPmember", "Is the session user assigned to the organisation (FIX-03)", V.sub(S.MEMBER, T=t, ORG=org, UID=uid), j)]),
        ]),
        node("code_node_SPsummary", "SUMMARY: sales vs production figures (scProject)", "projection/summary.js", ["code", "message", "result_json"]),
        ret("return_node_SPsummary", "Return SUMMARY", "code_node_SPsummary"),
    ]
    candidates = [
        K.parallel("condition_all_SPcread", "CANDIDATES reads (independent, one join)", [
            ("cai_SPcand", "Lines", [K.sql("sql_node_SPcand", "Live lines of eligible SOs for the item (newest 200)", V.sub(S.P_CAND, T=t, ITEMQ=item, ORG=org), j)]),
            ("cai_SPcandIas", "Linked IAs", [K.sql("sql_node_SPcandIas", "The linked IAs of the item", V.sub(S.P_CAND_IAS, T=t, ORG=org, ITEMQ=item), j)]),
            ("cai_SPcfg", "FG", [K.sql("sql_node_SPcfg", "The FG item and its UOM conversions", V.sub(S.P_FG, T=t, ITEM=item), j)]),
            ("cai_SPcmember", "Member", [K.sql("sql_node_SPcmember", "Is the session user assigned to the organisation (FIX-03)", V.sub(S.MEMBER, T=t, ORG=org, UID=uid), j)]),
        ]),
        node("code_node_SPcand", "CANDIDATES: eligible lines with their suggestion (scCandidates)", "projection/candidates.js", ["code", "message", "result_json"]),
        ret("return_node_SPcand", "Return CANDIDATES", "code_node_SPcand"),
    ]
    nodes = [
        node("code_node_SPguard", "Guard: operation, session tenant and user, digit ids", "projection/guard.js",
             ["route", "code", "tenantId", "uid", "so", "line", "item", "exclude", "org", "proposal", "baseline", "result_code", "result_message", "result_json"],
             objects=("proposal", "baseline")),
        K.if_(ids, "if_SPreject", "IF the request is invalid", V.is_(G, "route", "REJECT"),
              [K.ret("return_node_SPreject", "Return 400", [("code", N(G, "data.code")), ("message", N(G, "data.result_message")), ("result_json", N(G, "data.result_json"))])],
              [K.if_(ids, "if_SPsummary", "IF SUMMARY (else CANDIDATES)", V.is_(G, "route", "SUMMARY"), summary, candidates)]),
    ]
    request = [(n, "string", d) for n, d in [("operation", "SUMMARY | CANDIDATES"), ("so_id", "sales_order.id (optional)"), ("so_line_id", "the SO line id (SUMMARY)"),
                                              ("item_id", "the FG item id"), ("exclude_ia_id", "the IA being edited (optional)"), ("organization_id", "the caller's organisation"),
                                              ("proposal_qty", "the IA's proposed quantity (optional)"), ("proposal_uom_id", "its UOM"), ("baseline", "the IA's source_so_context_json (optional)")]]
    return K.workflow(request, ["code", "message", "result_json"], nodes)


def build_relink():
    ids = K.Ids(1792100000000)
    G = "code_node_RLguard"
    t, ia, line, org, uid = N(G, "data.tenantId"), N(G, "data.ia"), N(G, "data.line"), N(G, "data.org"), N(G, "data.uid")
    j = ["j"]
    go = [
        K.parallel("condition_all_RLread", "Reads (independent, one join)", [
            ("cai_RLia", "IA", [K.sql("sql_node_RLia", "The IA (status, link, context) and whether its line is still live", V.sub(S.R_IA, T=t, IA=ia), j)]),
            ("cai_RLline", "New line", [K.sql("sql_node_RLline", "The chosen line and its SO header", V.sub(S.P_LINE, T=t, LINE=line, SO="0"), j)]),
            ("cai_RLmember", "Member", [K.sql("sql_node_RLmember", "Is the session user assigned to the organisation (FIX-03)", V.sub(S.MEMBER, T=t, ORG=org, UID=uid), j)]),
        ]),
        node("code_node_RLcheck", "Check: a completed IA whose line is gone, onto a live line of the same SO and item", "relink/check.js",
             ["route", "code", "message", "rows", "needUpd"], arrays=("rows",)),
        K.if_(ids, "if_RLstop", "IF refused", V.is_("code_node_RLcheck", "route", "STOP"),
              [K.ret("return_node_RLstop", "Return 400", [("code", N("code_node_RLcheck", "data.code")), ("message", N("code_node_RLcheck", "data.message")),
                                                         ("result_json", N(G, "data.result_json"))])],
              [V.gate(ids, "cor_RLupd", "Link to write?", "code_node_RLcheck", "needUpd", [
                  K.update(ids, "update_node_RLia", "Item Assembly: the source line + context only", IA_TABLE, ("id", "in", N("code_node_RLcheck", "data.rows.id")),
                           [("source_so_line_id", N("code_node_RLcheck", "data.rows.source_so_line_id")),
                            ("source_so_context_json", N("code_node_RLcheck", "data.rows.source_so_context_json"))])]),
               K.sql("sql_node_RLback", "Read-back: the IA after the write", V.sub(S.R_IA, T=t, IA=ia), j),
               node("code_node_RLresult", "Result: the read-back shows the new line", "relink/result.js", ["code", "message", "result_json"]),
               ret("return_node_RLdone", "Return", "code_node_RLresult")]),
    ]
    nodes = [
        node("code_node_RLguard", "Guard: digit ids, session tenant and user, the link and status the user saw", "relink/guard.js",
             ["route", "code", "tenantId", "ia", "line", "item", "org", "uid", "expectLine", "expectStatus", "result_message", "result_json"]),
        K.if_(ids, "if_RLreject", "IF the request is invalid", V.is_(G, "route", "REJECT"),
              [K.ret("return_node_RLreject", "Return 400", [("code", N(G, "data.code")), ("message", N(G, "data.result_message")), ("result_json", N(G, "data.result_json"))])],
              go),
    ]
    request = [(n, "string", d) for n, d in [("ia_id", "the completed IA"), ("so_line_id", "the live line to link"), ("item_id", "the IA's FG item"),
                                              ("organization_id", "the caller's organisation"), ("expected_line_id", "the IA's SO line as the user saw it"),
                                              ("expected_status", "the IA's status as the user saw it")]]
    return K.workflow(request, ["code", "message", "result_json"], nodes)


BUILDERS = [("SO_IA_PROJECTION", build_projection), ("IA_SC_RELINK", build_relink)]

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    V.build(BUILDERS, OUT, "--write" in sys.argv, args)
