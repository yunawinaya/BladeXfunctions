"""Picking V2 client wiring: the form (new Save-as-Completed handler + mounted job state) and the list page (Auto Pick).

The workflow ids come from ids.json; while they are "0" the handlers keep their __PLACEHOLDER__ ids and run the classic
save, so the form can be deployed before the workflows.   usage: python3 client_patch.py [--write]
"""
import json, os, re, sys, random, string
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from fmt import render

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
WRITE = "--write" in sys.argv
IDS = json.load(open(os.path.join(HERE, "ids.json")))


def ids_into(js):
    for name in ("PICKING_ASYNC_SUBMIT", "PICKING_ASYNC_WORKER"):
        if IDS.get(name) and IDS[name] != "0":
            js = js.replace("__%s__" % name, IDS[name])
    return js


def all_keys(doc):
    return set(re.findall(r'"key": ?"([a-z0-9]{8})"', json.dumps(doc)))


def new_key(taken):
    rng = random.Random(20261012)
    while True:
        k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in taken and not k.isdigit():
            return k


MOUNTED_HELPER = '''// Picking V2: the Picking's latest background confirmation, read through PICKING_ASYNC_SUBMIT (STATUS: the browser
// cannot read gd_async_job). While it is open the save buttons are hidden; FAILED / under review / a reduced line is
// reported once.
const pkV2ShowJobState = async () => {
  const id = this.getValue("id");
  if (!id) return;
  let organizationId = String(this.getValue("organization_id") || "");
  if (!organizationId) {
    organizationId = String(this.getVarGlobal("deptParentId") || "");
    if (!organizationId || organizationId === "0") organizationId = String(this.getVarSystem("deptIds") || "").split(",")[0];
  }
  const job = await new Promise((resolve) => {
    try {
      this.runWorkflow(
        "__PICKING_ASYNC_SUBMIT__",
        { picking_id: String(id), organization_id: organizationId, operation: "STATUS" },
        (res) => resolve((res && res.data) || null),
        (err) => {
          console.error("Picking V2: job state could not be read", err);
          resolve(null);
        },
      );
    } catch (e) {
      resolve(null);
    }
  });
  if (!job || !job.job_id) return;
  if (["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PICKING"].includes(job.job_status)) {
    this.hide(["button_save_as_draft", "button_created", "button_inprogress", "button_completed"]);
    this.$message.warning("This Picking is being saved in the background (" + (job.result_message || job.job_status) + "). Reopen it in a moment.");
    return;
  }
  const seenKey = "pkv2_seen_" + job.job_id;
  let seen = false;
  try {
    seen = window.localStorage.getItem(seenKey) === "1";
    window.localStorage.setItem(seenKey, "1");
  } catch (e) {
    seen = false;
  }
  if (seen) return;
  if (job.job_status === "FAILED") this.$message.error("The last confirmation was not saved: " + (job.result_message || "unknown reason"));
  else if (job.job_status === "REQUIRES_REVIEW") this.$message.error("The last confirmation stopped half-way and is under review: " + job.result_message + " Please contact support.");
  else if (job.job_status === "COMPLETED" && job.result_code === "PK_CLAMPED") this.$message.warning(job.result_message);
};

// Main execution function'''


def patch_form():
    path = R + "Picking/PickingFullJSON.json"
    raw = open(path, encoding="utf-8").read()
    doc = json.loads(raw)
    assert render(doc, "ind") == raw, "the form file is not a clean ind render"
    es = doc["config"]["eventScript"]
    taken = all_keys(doc)
    handler = ids_into(open(R + "Picking/AsyncV2/pkV2_onSave_Completed.js", encoding="utf-8").read().rstrip("\n"))
    existing = [e for e in es if e.get("name") == "pkV2_onSave_Completed"]
    if existing:
        key = existing[0]["key"]
        existing[0]["func"] = handler
    else:
        key = new_key(taken)
        at = [i for i, e in enumerate(es) if e["key"] == "l16o826u"][0]
        es.insert(at + 1, {"key": key, "name": "pkV2_onSave_Completed", "func": handler, "type": "js"})
    # the Completed button
    hits = []
    def walk(n):
        if isinstance(n, dict):
            if n.get("model") == "button_completed" and isinstance(n.get("events"), dict):
                hits.append(n)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc["list"])
    assert len(hits) == 1
    hits[0]["events"]["onClick"] = key
    # mounted
    m = [e for e in es if e["key"] == "mounted"][0]
    src = m["func"]
    if "pkV2ShowJobState" in src:
        i = src.index("// Picking V2: a confirmation saved in the background")
        j = src.index("// Main execution function")
        src = src[:i] + ids_into(MOUNTED_HELPER) + src[j + len("// Main execution function"):]
        src = src.replace("\n        await pkV2ShowJobState();", "\n        pkV2ShowJobState();")
        m["func"] = src
    else:
        assert src.count("// Main execution function") == 1
        src = src.replace("// Main execution function", MOUNTED_HELPER)
        anchor = '''        await disabledField(status);
        await showStatusHTML(status);
        await disabledPickedQtyField();'''
        assert src.count(anchor) == 1
        src = src.replace(anchor, anchor + "\n        pkV2ShowJobState();")
        m["func"] = src
    text = render(doc, "ind")
    print("form: handler key %s, %d -> %d bytes" % (key, len(raw), len(text)))
    if WRITE:
        open(path, "w", encoding="utf-8").write(text)
        open(R + "Picking/PickingOnMounted.js", "w", encoding="utf-8").write(src)


def patch_list():
    path = R + "Picking/PickingListPageFullJSON.json"
    live = json.load(open(os.path.join(HERE, "picking_list_live.json"), encoding="utf-8"))  # dev enabled v216 (2026-10-12)
    es = live["config"]["eventScript"]
    h = [e for e in es if e["key"] == "3ttfcme4"][0]
    assert h["name"] == "AutoPickingComplete"
    h["func"] = ids_into(open(R + "Picking/AsyncV2/pkV2_listAutoPick.js", encoding="utf-8").read().rstrip("\n"))
    text = render(live, "ind")
    print("list page: dev v216 + AutoPickingComplete, %d bytes" % len(text))
    if WRITE:
        open(path, "w", encoding="utf-8").write(text)


patch_form()
patch_list()
if not WRITE:
    print("(dry run: --write to save)")
