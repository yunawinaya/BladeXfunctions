"""Integration (plan.md Task F (a)): the cross-package interfaces checked mechanically, each with file:line citations of the writer and
the reader. Read-only (sources, CONTRACT.md, the built JSONs). usage: python3 scratchpad/iav2/test/integration/interfaces.py
  1 SUBMIT request_payload keys  -> what PREPARE / COMMIT / WORKER / the SUBMITs' FACTS read   (+ the revert's RV3 request)
  2 PREPARE manifest + parts     -> what COMMIT's entry and steps read (ENGINE_I, ENGINE_R + receiptBaseQty / assemblyCost, BATCH,
                                    LABELS, ITEMS; the part prefix)
  3 COMMIT states / steps / hand-over -> WORKER (states, SPLIT / PARK, answer fields); the workers' callee params
  4 the form's SUBMIT / STATUS / WORKER calls and answer handling -> IA_V2_SUBMIT / IA_V2_WORKER (+ mounted: both SUBMITs / workers)
  5 the list's Revert routing -> IA_REVERT_V2_SUBMIT / _WORKER
  6 IA_LOCK_JOIN identical in both builders, in the CONTRACT and in every lock-joined read of both built workers
  7 every error code a built workflow names is in CONTRACT section 10 / RV10; the workers' hard codes = sections 8 / RV5"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(IAV2, "..", ".."))
OUT = os.path.join(REPO, "Item Assembly & BOM", "AsyncV2")
sys.path.insert(0, os.path.join(IAV2, "lib"))
sys.path.insert(0, IAV2)
sys.dont_write_bytecode = True
results = []


def rel(p):
    return os.path.relpath(p, REPO)


def text(p):
    return open(p, encoding="utf-8").read()


def cite(path, pattern, flags=0):
    """path:line of the first line matching `pattern` (a regex); raises when absent"""
    p = os.path.join(IAV2, path) if not os.path.isabs(path) else path
    for i, line in enumerate(text(p).split("\n"), 1):
        if re.search(pattern, line, flags):
            return "%s:%d" % (rel(p), i)
    raise AssertionError("%s: no line matches %r" % (rel(p), pattern))


def check(name, ok, detail, cites):
    results.append((ok, name))
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "\n       " + detail))
    for c in cites:
        print("       " + c)


def literal_keys(src, start_re):
    """the top-level keys of the object literal that starts at `start_re` ({ ... } balanced, strings skipped)"""
    m = re.search(start_re, src)
    assert m, start_re
    i = src.index("{", m.end() - 1)
    depth, j, keys, buf = 0, i, [], ""
    while j < len(src):
        c = src[j]
        if c in "\"'":
            q = c
            j += 1
            while src[j] != q:
                j += 2 if src[j] == "\\" else 1
        elif c in "{[(":
            depth += 1
            if depth == 1:
                buf = ""
        elif c in "}])":
            depth -= 1
            if depth == 0:
                break
        if depth == 1 and c not in "{":
            buf += c
            k = re.match(r"^[\s,]*(\w+)\s*:", buf)
            if k and buf.rstrip().endswith(":") and k.group(1) not in keys:
                keys.append(k.group(1))
            if c == ",":
                buf = ""
        j += 1
    return keys


def doc(name):
    return json.load(open(os.path.join(OUT, name + ".json"), encoding="utf-8"))


def walk(nodes):
    for n in nodes or []:
        yield n
        yield from walk(n.get("blocks"))


def req_names(name):
    return [r["name"] for r in doc(name)["request_json"]]


def resp_names(name):
    return [r["name"] for r in doc(name)["response_json"]]


def contract():
    return text(os.path.join(IAV2, "CONTRACT.md"))


def contract_json(after):
    c = contract()
    i = c.index(after)
    j = c.index("```json", i)
    k = c.index("```", j + 7)
    return json.loads(c[j + 7:k])


def reads(path, var):
    return sorted(set(re.findall(r"\b%s\.(\w+)" % re.escape(var), text(os.path.join(IAV2, path)))))


# ================================================================================================ 1 request_payload
post = text(os.path.join(IAV2, "code/submit/post.js"))
written = literal_keys(post, r"const request = \{")
written_link = re.findall(r"request\.(\w+) = ", text(os.path.join(IAV2, "code/submit/link.js")))
c3 = list(contract_json("### request_payload (JSON text, written by SUBMIT only)").keys())
check("1.1 SUBMIT writes exactly CONTRACT section 3's request_payload keys", sorted(written) == sorted(c3) and set(written_link) <= set(written),
      "written %s / contract %s / link %s" % (sorted(written), sorted(c3), written_link),
      [cite("code/submit/post.js", r"const request = \{") + "  (writer)", cite("code/submit/link.js", r"request\.lineFingerprint = ") + "  (link: iaId, iaNo, issuedNo, lineFingerprint)",
       cite("CONTRACT.md", r"^### request_payload") + "  (contract)"])
prep_reads = sorted(set(reads("code/prepare/entry.js", "req") + reads("code/prepare/plan.js", "req")))
check("1.2 PREPARE reads only keys SUBMIT writes: " + ", ".join(prep_reads), set(prep_reads) <= set(written), "not written: %s" % sorted(set(prep_reads) - set(written)),
      [cite("code/prepare/entry.js", r"req\.prevStatus") + "  (prevStatus)", cite("code/prepare/plan.js", r"req\.action") + "  (action, saveAs)",
       cite("code/prepare/plan.js", r"req\.iaNo") + "  (iaNo)", cite("code/prepare/plan.js", r"iaLineFingerprint\(S\.lines, S\.hdr\) !== s\(req\.lineFingerprint\)") + "  (lineFingerprint)"])
sql_paths = set()
for wf in ("IA_V2_COMMIT", "IA_V2_WORKER", "IA_V2_SUBMIT", "IA_REVERT_V2_SUBMIT", "IA_REVERT_V2_WORKER"):
    for n in walk(doc(wf)["nodes"]):
        if n["type"] == "sql-node":
            for k in re.findall(r"JSON_EXTRACT\(\w+\.request_payload, '\$\.(\w+)'\)", n["data"]["script"]["code"]):
                sql_paths.add((wf, k))
sql_keys = sorted(set(k for _, k in sql_paths))
rv_written = literal_keys(text(os.path.join(IAV2, "code/revert/submit/post.js")), r"const request = \{")
both = set(written) | set(rv_written)
check("1.3 the SQL reads of request_payload (COMMIT job, WORKER prev_status, FACTS action / iaNo / issuedNo) name written keys: " + ", ".join(sql_keys),
      set(sql_keys) <= both and {"prevStatus", "action"} <= set(written) & set(rv_written), "not written: %s" % sorted(set(sql_keys) - both),
      [cite(os.path.join(IAV2, "build_commit.py"), r"prev_status|prevStatus") + "  (COMMIT job read)", cite("build_worker.py", r"^IA_PREV_COL") + "  (WORKER IA_PREV_COL)",
       cite("code/shared/sql.py", r"'\$\.issuedNo'") + "  (FACTS number rule)", cite("code/shared/sql.py", r"'\$\.action'") + "  (job_obj action / ia_no)"])
rv3 = list(contract_json("## RV3. gd_async_job for REVERT_IA").keys())
rv_reads = sorted(set(reads("code/revert/prepare/entry.js", "req") + reads("code/revert/prepare/prep.js", "req")))
check("1.4 IA_REVERT_V2_SUBMIT writes RV3's request keys; its PREPARE reads only those: " + ", ".join(rv_reads),
      sorted(rv_written) == sorted(rv3) and set(rv_reads) <= set(rv_written), "written %s / RV3 %s / read %s" % (sorted(rv_written), sorted(rv3), rv_reads),
      [cite("code/revert/submit/post.js", r"const request = \{"), cite("code/revert/prepare/entry.js", r"req\.movesFingerprint"), cite("CONTRACT.md", r"^## RV3")])

# ================================================================================================ 2 manifest and parts
plan = text(os.path.join(IAV2, "code/prepare/plan.js"))
man_w = literal_keys(plan, r"const manifest = \{")
man_c = list(contract_json("`prepared_payload` (PREPARE with READY_TO_COMMIT").keys())
man_r = reads("code/commit/entry.js", "m")
check("2.1 PREPARE's manifest = CONTRACT section 5's keys; COMMIT's entry reads only those: " + ", ".join(man_r), sorted(man_w) == sorted(man_c) and set(man_r) <= set(man_w),
      "written %s / contract %s / read-not-written %s" % (sorted(man_w), sorted(man_c), sorted(set(man_r) - set(man_w))),
      [cite("code/prepare/plan.js", r"const manifest = \{"), cite("code/commit/entry.js", r"const m = iaParseJ"), cite("CONTRACT.md", r"^`prepared_payload`")])
parts_w = re.search(r'IA_PLAN_PARTS = \[([^\]]*)\]', plan).group(1).replace('"', "").replace(" ", "").split(",")
parts_r = re.search(r'IA_PARTS = \[([^\]]*)\]', text(os.path.join(IAV2, "code/commit/entry.js"))).group(1).replace('"', "").replace(" ", "").split(",") + ["BATCH"]
parts_c = re.findall(r"PART in ([A-Z_, ]+?)\s*\(", contract())[0].replace(" ", "").split(",")
check("2.2 part names: PREPARE writes %s; COMMIT requires %s (+ BATCH when batchMode insert); CONTRACT section 1" % (parts_w, parts_r[:-1]),
      sorted(parts_w) == sorted(parts_c) and set(parts_r) <= set(parts_w), "PREPARE %s / COMMIT %s / CONTRACT %s" % (parts_w, parts_r, parts_c),
      [cite("code/prepare/plan.js", r"IA_PLAN_PARTS = \["), cite("code/commit/entry.js", r"IA_PARTS = \["), cite("CONTRACT.md", r"PREPARE parts")])
prefix_ok = 'iaPartRows(jobId, orgId, "P|" + nonce + "|" + name + "|"' in plan and 'partPrefix: valid ? "P|" + s(m.nonce) + "|"' in text(os.path.join(IAV2, "code/commit/entry.js"))
like = sorted(set(re.findall(r"LIKE CONCAT\('\{\{node:code_node_IACentry\.data\.partPrefix\}\}', '([A-Z_]+)\|%'\)", json.dumps(doc("IA_V2_COMMIT"), ensure_ascii=False))))
check("2.3 part step names P|<nonce>|<PART>|<nnn>: PREPARE's prefix = COMMIT's partPrefix; COMMIT's part reads: " + ", ".join(like), prefix_ok and set(like) <= set(parts_w),
      "prefix %s / reads %s" % (prefix_ok, like), [cite("code/prepare/plan.js", r'"P\|" \+ nonce'), cite("code/commit/entry.js", r'partPrefix: valid \? "P\|"')])
ei = literal_keys(plan, r"ENGINE_I: \{")
er = literal_keys(plan, r"ENGINE_R: \{")
ei_r = sorted(set(reads("code/commit/i2_in.js", "eng")))
er_r = sorted(set(reads("code/commit/i1_decide.js", "eng") + reads("code/commit/i3_plan.js", "eng")))
check("2.4 ENGINE_I fields %s cover COMMIT I2's reads %s" % (ei, ei_r), set(ei_r) <= set(ei), "missing %s" % sorted(set(ei_r) - set(ei)),
      [cite("code/prepare/plan.js", r"ENGINE_I: \{"), cite("code/commit/i2_in.js", r"eng\.operation_key")])
check("2.5 ENGINE_R fields %s cover COMMIT I1 / I3's reads %s (receiptBaseQty, assemblyCost never sent: I3 passes 4 params)" % (er, er_r), set(er_r) <= set(er) and {"receiptBaseQty", "assemblyCost"} <= set(er_r),
      "missing %s" % sorted(set(er_r) - set(er)), [cite("code/prepare/plan.js", r"ENGINE_R: \{"), cite("code/commit/i3_plan.js", r"receiptUnitPrice\("), cite("code/commit/i1_decide.js", r"eng\.movements")])
mv_c = list(contract_json("### ENGINE_I = the exact INVENTORY_BULK_APPLY request of op 1")["movements"][0].keys())
r1_c = list(contract_json("### ENGINE_R = the receipt request template of op 2")["movements"][0].keys())
mv_w = literal_keys(plan, r"const iaPlanIssue = function iaPlanIssue\(key, q, g\) \{\s*return \{")
r1_w = literal_keys(plan, r"const iaPlanReceipt = function iaPlanReceipt\(r\) \{\s*return \{")
check("2.6 the op-1 movement and R1 keys = CONTRACT section 5's examples", mv_w == mv_c and r1_w == r1_c, "issue %s vs %s / R1 %s vs %s" % (mv_w, mv_c, r1_w, r1_c),
      [cite("code/prepare/plan.js", r"const iaPlanIssue"), cite("code/prepare/plan.js", r"const iaPlanReceipt"), cite("CONTRACT.md", r"^### ENGINE_I")])
batch_w = literal_keys(plan, r"parts\.BATCH = \{ mode: \"insert\", row: \{")
batch_cols = re.search(r"BATCH_COLS = (\[[^\]]*\])", text(os.path.join(IAV2, "build_commit.py")))
bc = json.loads(batch_cols.group(1).replace("'", '"')) if batch_cols else []
bc_c = list(contract_json("### BATCH = the planned Batch row")["row"].keys())
part_r = reads("code/commit/i1_decide.js", "part") + reads("code/commit/i1_decide.js", "row")
check("2.7 BATCH row: PREPARE's 11 columns = COMMIT I1's insert columns = CONTRACT section 5; I1 reads %s" % sorted(set(part_r)),
      sorted(batch_w) == sorted(bc) == sorted(bc_c) and set(part_r) - {"row", "mode"} <= set(batch_w), "PREPARE %s / COMMIT %s / CONTRACT %s" % (batch_w, bc, bc_c),
      [cite("code/prepare/plan.js", r"parts\.BATCH = "), cite("build_commit.py", r"BATCH_COLS = ") if batch_cols else "build_commit.py BATCH_COLS", cite("code/commit/i1_decide.js", r"for \(const k of BATCH_COLS\)")])
items_ok = "ITEMS: { itemDates: itemDates }" in plan and "items.itemDates" in text(os.path.join(IAV2, "code/commit/i4.js"))
check("2.8 ITEMS { itemDates: [{ id }] }: written by PREPARE, read by I4; LABELS M<n> / R1 read by I1 / I2 only after a refusal", items_ok and "iaMapEngineMessage" in text(os.path.join(IAV2, "code/commit/i2.js")),
      "", [cite("code/prepare/plan.js", r"ITEMS: \{ itemDates"), cite("code/commit/i4.js", r"items\.itemDates"), cite("code/commit/i2.js", r'LABELS\|')])

# ================================================================================================ 3 COMMIT <-> WORKER
cm_states = set()
for f in sorted(os.listdir(os.path.join(IAV2, "code/commit"))):
    cm_states |= set(re.findall(r'job_status: "([A-Z_]+)"', text(os.path.join(IAV2, "code/commit", f))))
wk = text(os.path.join(IAV2, "code/worker/_common.js"))
wk_states = re.search(r"states: \[([^\]]*)\]", wk).group(1).replace('"', "").replace(" ", "").split(",")
accepted = re.search(r'\[("READY_TO_COMMIT", "COMMITTING_IA")\]\.indexOf\(status\)', text(os.path.join(IAV2, "code/commit/entry.js")))
check("3.1 COMMIT writes %s; takes READY_TO_COMMIT / COMMITTING_IA = the worker's open states %s; the rest terminal" % (sorted(cm_states), wk_states),
      cm_states <= {"COMMITTING_IA", "REQUIRES_REVIEW", "FAILED", "COMPLETED"} and accepted is not None and {"READY_TO_COMMIT", "COMMITTING_IA"} <= set(wk_states), str(cm_states),
      [cite("code/commit/entry.js", r'"READY_TO_COMMIT", "COMMITTING_IA"\]\.indexOf'), cite("code/worker/_common.js", r"states: \[")])
i2 = text(os.path.join(IAV2, "code/commit/i2.js"))
sp = text(os.path.join(IAV2, "code/worker/split.js"))
split_ok = 'lease_owner: "SPLIT|" + guard.nonce' in i2 and 'indexOf("SPLIT|") === 0 && !s(job.next_attempt_at)' in sp and 'next_attempt_at: entry.dbNow' in i2
resume_ok = 'own.route === "RESUME"' in text(os.path.join(IAV2, "code/worker/mid.js")) and 'status === "COMMITTING_IA" && String(job.lease_live) !== "1"' in text(os.path.join(IAV2, "code/worker/mid.js"))
check("3.2 hand-over: I2 writes SPLIT|<nonce> (no next_attempt_at) <= 1,000 picks else PARK (due now, no lease); the worker re-calls on SPLIT, RESUMEs a PARKed job",
      split_ok and resume_ok and "s(job.lease_owner).indexOf(\"SPLIT|\") !== 0" in text(os.path.join(IAV2, "code/commit/entry.js")), "split %s resume %s" % (split_ok, resume_ok),
      [cite("code/commit/i2.js", r'"SPLIT\|"'), cite("code/worker/split.js", r'indexOf\("SPLIT\|"\)'), cite("code/worker/mid.js", r'RESUME'), cite("code/commit/entry.js", r'SPLIT\| lease is the hand-over')])
steps_w = set()
for f in sorted(os.listdir(os.path.join(IAV2, "code/commit"))):
    steps_w |= set(re.findall(r'step(?:Ok|End|Wait)?\(entry, "(I[0-9]_[A-Z]+)"', text(os.path.join(IAV2, "code/commit", f))))
    steps_w |= set(re.findall(r'reviewEnd\(entry, "(I[0-9]_[A-Z]+)"', text(os.path.join(IAV2, "code/commit", f))))
steps_c = set(re.findall(r"`(I[0-9]_[A-Z]+)`", contract()[contract().index("| COMMIT step rows |"):contract().index("| worker claim")]))
check("3.3 COMMIT's step names %s = CONTRACT section 1; the steps read REGEXP '^I[0-9]_' (the I1|I|001 intent does not match)" % sorted(steps_w),
      steps_w == steps_c and "REGEXP '^I[0-9]_'" in json.dumps(doc("IA_V2_COMMIT")), "%s vs %s" % (sorted(steps_w), sorted(steps_c)),
      [cite("code/commit/i0.js", r'stepOk\(entry, "I0_REVALIDATE"'), cite("CONTRACT.md", r"COMMIT step rows")])
for pair, worker, prep, commit in (("completion", "IA_V2_WORKER", "IA_V2_PREPARE", "IA_V2_COMMIT"), ("revert", "IA_REVERT_V2_WORKER", "IA_REVERT_V2_PREPARE", "IA_REVERT_V2_COMMIT")):
    calls = {}
    reads_ = set()
    for n in walk(doc(worker)["nodes"]):
        if n["type"] == "workflow-node":
            calls[n["data"]["workflow"]["source"].split(":Workflow:")[0]] = sorted(b["prop"] for b in n["data"]["body_params"]["list"])
        if n["type"] == "code-node":
            for ref in re.findall(r"\{\{node:workflow_node_\w+\.data\.(\w+)\}\}", n["data"]["script"]["code"]):
                reads_.add(ref)
    wsrc = "code/worker" if pair == "completion" else "code/revert/worker"
    # `r` is the callee's answer (`const r = resp || {}`); `(r) => s(r.id)` lambdas walk the job rows
    body = re.sub(r"\(r\) => [^)]*\)", "", text(os.path.join(IAV2, wsrc, "after_publish.js")) + text(os.path.join(IAV2, wsrc, "after_prepare.js")))
    reads_ |= set(re.findall(r"\br\.(\w+)", body))
    ok_params = calls.get(prep) == sorted(req_names(prep)) and calls.get(commit) == sorted(req_names(commit))
    answers = set(resp_names(prep)) | set(resp_names(commit))
    check("3.4 %s: the worker calls %s / %s with %s (= their request_json); reads %s of their answers (all declared)" % (pair, prep, commit, calls.get(prep), sorted(reads_)),
          ok_params and reads_ <= answers, "calls %s / request %s %s / undeclared %s" % (calls, req_names(prep), req_names(commit), sorted(reads_ - answers)),
          [cite(wsrc + "/after_publish.js", r"r\.path|s\(r\.path\)"), cite(wsrc + "/after_prepare.js", r"r\.result_code")])

# ================================================================================================ 4 the form <-> IA_V2_SUBMIT / IA_V2_WORKER
cl = text(os.path.join(IAV2, "client/src/iaV2_onClick_completed.js"))
creq = literal_keys(cl, r"const request = \(ctx, operation, iaId\) => \(")
check("4.1 the form's SUBMIT / STATUS request %s = IA_V2_SUBMIT's request_json" % creq, sorted(creq) == sorted(req_names("IA_V2_SUBMIT")), str(req_names("IA_V2_SUBMIT")),
      [cite("client/src/iaV2_onClick_completed.js", r"const request = \(ctx, operation, iaId\)"), cite("code/submit/guard.js", r"submitGuard\(\{ operation: ")])
creads = set()
for v in ("r", "st", "q"):
    creads |= set(re.findall(r"\b%s\.(\w+)" % v, cl))
creads -= {"data"}
check("4.2 the answer fields the form reads %s are all IA_V2_SUBMIT answer fields" % sorted(creads), creads <= set(resp_names("IA_V2_SUBMIT")), "undeclared %s" % sorted(creads - set(resp_names("IA_V2_SUBMIT"))),
      [cite("client/src/iaV2_onClick_completed.js", r"r\.route === \"QUEUED\"")])
routes_c = ["QUEUED", "STATUS", "NOT_ELIGIBLE", "BUSY", "STALE", "STOP", "INVALID"]
handled = set(re.findall(r'r\.route === "([A-Z_]+)"', cl))
sub_routes = set()
for f in sorted(os.listdir(os.path.join(IAV2, "code/submit"))):
    sub_routes |= set(re.findall(r'(?:answer|out)\("([A-Z_]+)"', text(os.path.join(IAV2, "code/submit", f))))
sub_routes |= set(re.findall(r'route: "([A-Z_]+)"', text(os.path.join(IAV2, "code/submit/result.js"))))
final = (sub_routes - {"GO", "QUEUE", "CONTINUE", "REJECT"}) | {"INVALID"}
check("4.3 every route IA_V2_SUBMIT answers %s is one of CONTRACT section 7's and the form handles it (%s; STOP 500 keeps the key, other STOP -> error)" % (sorted(final), sorted(handled)),
      final <= set(routes_c) and set(routes_c) - {"STOP"} <= handled and 'r.route === "STOP" && s(r.code) === "500"' in cl, "answered %s handled %s" % (sorted(final), sorted(handled)),
      [cite("code/submit/result.js", r'route: "INVALID"'), cite("client/src/iaV2_onClick_completed.js", r'r\.route === "STOP" && s\(r\.code\) === "500"')])
kick_ok = re.search(r"run\(IA_WF\.WORKER, \{ job_id: s\(job\.jobId\) \}\)", cl) and re.search(r"this\.runWorkflow\(IA_WF\.WORKER, \{ job_id: s\(jobId\) \}", cl)
wreads = set(re.findall(r"\bw\.(\w+)", cl)) | ({"jobs"} if "iaJsonList(w.jobs)" in cl else set())
check("4.4 the form's worker kick { job_id } = IA_V2_WORKER's request_json; it reads %s of the answer (declared)" % sorted(wreads),
      bool(kick_ok) and req_names("IA_V2_WORKER") == ["job_id"] and wreads <= set(resp_names("IA_V2_WORKER")), "undeclared %s" % sorted(wreads - set(resp_names("IA_V2_WORKER"))),
      [cite("client/src/iaV2_onClick_completed.js", r"run\(IA_WF\.WORKER, \{ job_id"), cite("client/src/iaV2_onClick_completed.js", r"const statusOf")])
mb = text(os.path.join(IAV2, "client/src/iaV2_mounted_block.js"))
st1 = literal_keys(mb, r"iaBgRun\(IA_BG_WF\.SUBMIT, \{")
st2 = literal_keys(mb, r"iaBgRun\(IA_BG_WF\.REVERT_SUBMIT, \{")
mreads = set(re.findall(r"\bst\.(\w+)", mb))
mcmd = "command" in mreads
check("4.5 the form's mounted STATUS: %s = IA_V2_SUBMIT's request, %s = IA_REVERT_V2_SUBMIT's; reads %s" % (st1, st2, sorted(mreads)),
      sorted(st1) == sorted(req_names("IA_V2_SUBMIT")) and sorted(st2) == sorted(req_names("IA_REVERT_V2_SUBMIT")) and mreads - {"command"} <= set(resp_names("IA_V2_SUBMIT")) & set(resp_names("IA_REVERT_V2_SUBMIT")),
      "requests %s %s / undeclared %s" % (req_names("IA_V2_SUBMIT"), req_names("IA_REVERT_V2_SUBMIT"), sorted(mreads - set(resp_names("IA_V2_SUBMIT")))),
      [cite("client/src/iaV2_mounted_block.js", r"iaBgRun\(IA_BG_WF\.SUBMIT"), cite("client/src/iaV2_mounted_block.js", r"iaBgRun\(IA_BG_WF\.REVERT_SUBMIT"),
       cite("client/src/iaV2_mounted_block.js", r"const iaBgIsRevert") + ("  (INFO: st.command is not an answer field - dead, harmless: st.action decides)" if mcmd else "")])

# ================================================================================================ 5 the list <-> IA_REVERT_V2_SUBMIT / _WORKER
ls = text(os.path.join(IAV2, "client/src/ia_list_revertCompleted.js"))
lreq = literal_keys(ls, r"const rvRequest = \(ia, operation\) => \(")
lform = re.search(r": \{ id: str\(ia\.id\), item_assembly_status: str\(ia\.item_assembly_status\), stock_movement_no: str\(ia\.stock_movement_no\), organization_id: str\(ia\.organization_id\) \}", ls)
rvg = text(os.path.join(IAV2, "code/revert/submit/guard.js"))
check("5.1 the list's revert request %s = IA_REVERT_V2_SUBMIT's request_json; form = the row's id / item_assembly_status / stock_movement_no / organization_id (RV4)" % lreq,
      sorted(lreq) == sorted(req_names("IA_REVERT_V2_SUBMIT")) and bool(lform) and "form.organization_id" in rvg and "form.item_assembly_status" in rvg, str(req_names("IA_REVERT_V2_SUBMIT")),
      [cite("client/src/ia_list_revertCompleted.js", r"const rvRequest"), cite("code/revert/submit/guard.js", r"submitGuard\(\{ operation")])
lreads = set(re.findall(r"\br\.(\w+)", ls)) - {"label", "success", "partial", "queued", "error"}
rv_routes = set()
for f in sorted(os.listdir(os.path.join(IAV2, "code/revert/submit"))):
    rv_routes |= set(re.findall(r'(?:answer|out)\("([A-Z_]+)"', text(os.path.join(IAV2, "code/revert/submit", f))))
rv_routes |= set(re.findall(r'route: "([A-Z_]+)"', text(os.path.join(IAV2, "code/revert/submit/result.js"))))
rv_final = (rv_routes - {"GO", "QUEUE", "CONTINUE", "REJECT"}) | {"INVALID"}
l_handled = set(re.findall(r'r\.route === "([A-Z_]+)"', ls))
rv_open = re.search(r'const RV_OPEN = \[([^\]]*)\]', ls).group(1).replace('"', "").replace(" ", "").split(",")
rvw_states = re.search(r"states: \[([^\]]*)\]", text(os.path.join(IAV2, "code/revert/worker/_common.js"))).group(1).replace('"', "").replace(" ", "").split(",")
check("5.2 IA_REVERT_V2_SUBMIT answers %s; the list handles QUEUED / STATUS (open = the revert worker's states %s) / NOT_ELIGIBLE / INVALID -> classic, the rest -> the row's message; reads %s (declared)"
      % (sorted(rv_final), rv_open, sorted(lreads)), {"QUEUED", "STATUS", "NOT_ELIGIBLE", "INVALID"} <= l_handled and rv_open == rvw_states and lreads <= set(resp_names("IA_REVERT_V2_SUBMIT"))
      and rv_final <= {"QUEUED", "STATUS", "NOT_ELIGIBLE", "BUSY", "STALE", "STOP", "INVALID"}, "handled %s / open %s vs %s / undeclared %s" % (sorted(l_handled), rv_open, rvw_states, sorted(lreads - set(resp_names("IA_REVERT_V2_SUBMIT")))),
      [cite("client/src/ia_list_revertCompleted.js", r'r\.route === "NOT_ELIGIBLE"'), cite("client/src/ia_list_revertCompleted.js", r"const RV_OPEN"), cite("code/revert/worker/_common.js", r"states: \[")])
key_ok = '("IAV:" + str(ia.organization_id) + ":" + str(ia.id) + ":" + clickToken).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128)' in ls
drain = 'run(IARV_WF.WORKER, { job_id: "" })' in ls
lm = text(os.path.join(IAV2, "client/src/ia_list_mounted_kick.js"))
check("5.3 the list's key IAV:<org>:<id>:<clickToken> (IA_KEY_RE charset, <= 128); it drains IA_REVERT_V2_WORKER { job_id: \"\" }; the list mounted kicks both workers with { job_id: \"\" }",
      key_ok and drain and lm.count('{ job_id: "" }') == 1 and '"__IA_V2_WORKER__"' in lm and '"__IA_REVERT_V2_WORKER__"' in lm and req_names("IA_REVERT_V2_WORKER") == ["job_id"],
      "key %s drain %s" % (key_ok, drain),
      [cite("client/src/ia_list_revertCompleted.js", r"const keyOf"), cite("client/src/ia_list_revertCompleted.js", r"run\(IARV_WF\.WORKER"), cite("client/src/ia_list_mounted_kick.js", r"job_id")])

# ================================================================================================ 6 IA_LOCK_JOIN
import build_worker as BW  # noqa: E402
import build_revert as BR  # noqa: E402
ns = {}
exec(re.search(r'(IA_LOCK_JOIN = """.*?""")', contract(), re.S).group(1), ns)
joined = {}
for wf in ("IA_V2_WORKER", "IA_REVERT_V2_WORKER"):
    rows = [(n["id"], BW.IA_LOCK_JOIN in n["data"]["script"]["code"]) for n in walk(doc(wf)["nodes"]) if n["type"] == "sql-node" and "LEFT JOIN sm_item_assembly g" in n["data"]["script"]["code"]]
    joined[wf] = rows
check("6.1 IA_LOCK_JOIN (with g.is_deleted = 0): build_worker.py == build_revert.py == CONTRACT section 8; IA_ID_COL / IA_PREV_COL equal; all %d + %d lock-joined reads carry it verbatim"
      % (len(joined["IA_V2_WORKER"]), len(joined["IA_REVERT_V2_WORKER"])),
      BW.IA_LOCK_JOIN == BR.IA_LOCK_JOIN == ns["IA_LOCK_JOIN"] and "AND g.is_deleted = 0" in BW.IA_LOCK_JOIN and BW.IA_ID_COL == BR.IA_ID_COL and BW.IA_PREV_COL == BR.IA_PREV_COL
      and all(ok for rows in joined.values() for _, ok in rows) and all(len(r) == 8 for r in joined.values()), str(joined),
      [cite("build_worker.py", r'^IA_LOCK_JOIN = """'), cite("build_revert.py", r'^IA_LOCK_JOIN = """'), cite("CONTRACT.md", r'^IA_LOCK_JOIN = """'), cite("build_worker.py", r"AND g\.is_deleted = 0"),
       cite("build_revert.py", r"AND g\.is_deleted = 0")])

# ================================================================================================ 7 error codes
c = contract()
s10 = c[c.index("## 10. Error codes"):c.index("## 11. The classic")]
rv10 = c[c.index("## RV10. Error codes"):c.index("## Contract deviations")]
NONCODE = {"IA_TEXT", "IA_CLASSIC_MAX_PICKS", "IA_PREV_STATUSES", "IA_RV_PREV_STATUSES", "IA_OPEN_JOB", "IA_KEY_RE", "IA_V2_SUBMIT", "IA_V2_WORKER", "IA_V2_PREPARE", "IA_V2_COMMIT",
           "IA_REVERT_V2_SUBMIT", "IA_REVERT_V2_WORKER", "IA_REVERT_V2_PREPARE", "IA_REVERT_V2_COMMIT", "IA_REVERT", "IA_SAVE"}
codes_c = set(re.findall(r"\b(IA_(?:RV_)?[A-Z][A-Z0-9_]*[A-Z0-9]|JOB_[A-Z_]+[A-Z])\b", s10 + rv10)) - NONCODE
bad = {}
for wf in ("IA_V2_SUBMIT", "IA_V2_WORKER", "IA_V2_PREPARE", "IA_V2_COMMIT", "IA_REVERT_V2_SUBMIT", "IA_REVERT_V2_WORKER", "IA_REVERT_V2_PREPARE", "IA_REVERT_V2_COMMIT", "IA_REVERT", "IA_SAVE"):
    used = set()
    for n in walk(doc(wf)["nodes"]):
        if n["type"] == "code-node":
            used |= set(re.findall(r'["\'](IA_(?:RV_)?[A-Z][A-Z0-9_]*|JOB_[A-Z_]+)["\']', n["data"]["script"]["code"]))
    extra = sorted(x for x in used - NONCODE - codes_c if x not in ("IA_INVENTORY_", "IA_RV_INVENTORY_"))
    if extra:
        bad[wf] = extra
check("7.1 every error code the 10 built workflows name is in CONTRACT section 10 / RV10 (IA_INVENTORY_ / IA_RV_INVENTORY_ = the <engine code> families)", not bad, str(bad),
      [cite("CONTRACT.md", r"^## 10\. Error codes"), cite("CONTRACT.md", r"^## RV10\. Error codes")])
s8 = c[c.index("## 8. IA_V2_WORKER"):c.index("## 9. IA_V2_PREPARE")]
rv5 = c[c.index("## RV5. IA_REVERT_V2_WORKER"):c.index("## RV6.")]
h8 = sorted(set(re.findall(r"IA_[A-Z_]+|JOB_ILLEGAL_TRANSITION", s8[s8.index("Hard codes"):s8.index("**Tick rule**")])))
hrv = sorted(set(re.findall(r"IA_RV_[A-Z_]+|JOB_ILLEGAL_TRANSITION", rv5[rv5.index("Hard codes"):rv5.index("Tick rule")])))
w8 = sorted(re.search(r"hard: \[([^\]]*)\]", text(os.path.join(IAV2, "code/worker/_common.js"))).group(1).replace('"', "").replace(" ", "").split(","))
wrv = sorted(re.search(r"hard: \[([^\]]*)\]", text(os.path.join(IAV2, "code/revert/worker/_common.js"))).group(1).replace('"', "").replace(" ", "").split(","))
check("7.2 the workers' hard codes = CONTRACT section 8 (%d) / RV5 (%d)" % (len(h8), len(hrv)), w8 == h8 and wrv == hrv, "%s vs %s / %s vs %s" % (w8, h8, wrv, hrv),
      [cite("code/worker/_common.js", r"hard: \["), cite("code/revert/worker/_common.js", r"hard: \["), cite("CONTRACT.md", r"Hard codes \(fail at once")])

bad_n = sum(1 for ok, _ in results if not ok)
print("%d interface checks, %d failed" % (len(results), bad_n))
sys.exit(1 if bad_n else 0)
