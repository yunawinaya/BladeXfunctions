"""The Location Transfer form for the IA transfer request (ENH-20261027-001; plan top section, WP5), patched onto the live form v113
(scratchpad/iatr/base/lot_form_v113.json: Zhen Xiang's 10-22 designer edits on top of the smv2 client build; = dev = prod 10-28).

phase "fields" (publish B1, no behaviour): the request's data fields, hidden - they create the columns the workflows read:
  header inputs (varchar)  transfer_purpose, source_ia_id, source_ia_no, source_ia_fp, source_ia_rev, requested_by, requested_at,
                           replaces_id - clones of lot_v2_job_id, in the header grid after lot_idem_key (hidden V2 fields live there)
  header textarea          request_log (longtext) - a clone of remarks, after the action bar (a hidden textarea under the title
                           leaves a gap: the IA form, v55)
  header date              required_date (datetime) - a clone of issue_date, after request_log
  line inputs              source_ia_line_id, source_ref_key - clones of the lines' hidden balance_id, appended last
  status select            + "Requested" in its blade_dict filter (the user adds the dictionary entry)
Every widget a clone with a fresh 8-character key (seeded), no events bound; nothing else changes (test/test_lot_ui.js proves it).

phase "full" (= fields + the behaviour; publish with the workflows): only for a request (transfer_purpose IA_SUPPLY) -
  widgets   requested_status (the Requested badge, cyan), iatr_info (its source IA, dates, requester; UI only) + button_view_ia,
            and its buttons in the action bar: Save Picks (the Draft save -> the classic keeps it Requested), Dispatch (lot_ia_dispatch:
            confirm the posting date -> the In Progress save -> LOT V2 STAGE), Cancel Request (ia_create_transfer_request:
            IA_TRANSFER_REQUEST CANCEL), Receive (lot_ia_receive: confirm -> the Completed save -> LOT V2 COMPLETE)
  mounted   the badge; a request's own buttons only; its info, Requested Qty shown, item / bin / storage locked, row actions hidden
            while Requested; a failed background save is told for Requested too
  V2 saves  (the 3 copies) a request's picks go to the classic, every other save of it to SUBMIT whatever its size, a NOT_ELIGIBLE
            answer shown (never the classic: it can't move a request's stock); the new buttons / UI models in SAVE_BUTTONS / NOT_RECORD
  Apply Target Location: refused for a request (its destination is its Item Assembly's)
Ordinary transfers: every patched handler runs its v113 text (each change is a guarded branch; the test undoes them -> v114).

usage: python3 scratchpad/iatr/lot_client/patch_lot_ui.py [--write]   (IATR_UI_OUT=<dir> writes there; writes out/fields + out/full)"""
import copy
import hashlib
import json
import os
import random
import re
import string
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IATR = os.path.dirname(HERE)
BASE = os.path.join(IATR, "base", "lot_form_v113.json")
BASE_MD5 = "94fdecce55bccb596e805d999cd0df12"
OUT = os.environ.get("IATR_UI_OUT") or os.path.join(HERE, "out")
SEED = 20261028
HEADER_INPUTS = [("transfer_purpose", "Transfer Purpose"), ("source_ia_id", "Source Item Assembly ID"), ("source_ia_no", "Source Item Assembly"),
                 ("source_ia_fp", "Source Demand Fingerprint"), ("source_ia_rev", "Request Revision"), ("requested_by", "Requested By"),
                 ("requested_at", "Requested At"), ("replaces_id", "Replaces Request")]
LINE_INPUTS = [("source_ia_line_id", "Source IA Line ID"), ("source_ref_key", "Source Reference Key")]
STATUS_LEAF_ID = 1797900000001


class Keys:
    """fresh 8-character keys: never one the base holds, never starting with a digit (scratchpad/iasc/client/build_client_sc.py's rule)"""

    def __init__(self, base_text, seed):
        self.taken = set(re.findall(r"[a-z0-9]{8}", base_text))
        self.rng = random.Random(seed)

    def new(self):
        while True:
            k = "".join(self.rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in self.taken and not k[0].isdigit():
                self.taken.add(k)
                return k


def widget(tpl, keys, model, name, **opts):
    """a clone of `tpl` with a fresh key, its own remote ids, no events bound, the given options"""
    w = copy.deepcopy(tpl)
    k = keys.new()
    w.update({"key": k, "model": model, "name": name})
    o = w["options"]
    if "remoteFunc" in o:
        o["remoteFunc"] = "func_" + k
    if "remoteOption" in o:
        o["remoteOption"] = "option_" + k
    for kk, v in opts.items():
        o[kk] = v
    if isinstance(w.get("events"), dict):
        w["events"] = {e: "" for e in w["events"]}
    return w


def find(n, model):
    """every widget with this model (dicts carrying a type)"""
    out = []
    if isinstance(n, dict):
        if n.get("model") == model and "type" in n:
            out.append(n)
        for v in n.values():
            out.extend(find(v, model))
    elif isinstance(n, list):
        for v in n:
            out.extend(find(v, model))
    return out


def one(form, model):
    got = find(form["list"], model)
    assert len(got) == 1, (model, len(got))
    return got[0]


def parent_list(n, target):
    """the list holding `target` (by identity)"""
    if isinstance(n, dict):
        for v in n.values():
            r = parent_list(v, target)
            if r is not None:
                return r
    elif isinstance(n, list):
        if any(x is target for x in n):
            return n
        for v in n:
            r = parent_list(v, target)
            if r is not None:
                return r
    return None


def fields(form, raw):
    keys = Keys(raw, SEED)
    job, remarks, issue, sm, status = (one(form, m) for m in ("lot_v2_job_id", "remarks", "issue_date", "stock_movement", "stock_movement_status"))
    assert (job["type"], job["options"]["hidden"], job["options"]["dataBind"]) == ("input", True, True)
    assert (remarks["type"], remarks["options"]["dataBind"]) == ("textarea", True) and (issue["type"], issue["options"]["dataBind"]) == ("date", True)
    bal = [c for c in sm["tableColumns"] if c.get("model") == "balance_id"]
    assert len(bal) == 1 and (bal[0]["type"], bal[0]["options"]["hidden"], bal[0]["options"]["dataBind"]) == ("input", True, True)
    added = []
    # header inputs: after lot_idem_key, in its column
    col = parent_list(form["list"], one(form, "lot_idem_key"))
    at = [w.get("model") for w in col].index("lot_idem_key")
    new = [widget(job, keys, m, n) for m, n in HEADER_INPUTS]
    col[at + 1:at + 1] = new
    added += new
    # the log (longtext) and the required date (datetime): hidden, after the action bar
    top = form["list"]
    bar = [w.get("model") for w in top].index("flex_t6y2yh5r")
    log = widget(remarks, keys, "request_log", "Request Log", hidden=True, disabled=True)
    req = widget(issue, keys, "required_date", "Required Date", hidden=True, disabled=True, required=False)
    top[bar + 1:bar + 1] = [log, req]
    added += [log, req]
    # line inputs: appended to the lines table
    lines = [widget(bal[0], keys, m, n) for m, n in LINE_INPUTS]
    sm["tableColumns"].extend(lines)
    added += lines
    # the status select: "Requested" in its dictionary filter
    br = status["options"]["datasource"]["rules"]["list"][0]["children"][1]
    assert br["type"] == "branch" and br["operator"] == "any" and all(c["prop"] == "dict_key" for c in br["children"])
    assert "Requested" not in [c["value"] for c in br["children"]] and str(STATUS_LEAF_ID)[:10] not in raw
    leaf = copy.deepcopy(br["children"][-1])
    leaf.update({"id": STATUS_LEAF_ID, "value": "Requested"})
    br["children"].append(leaf)
    return added


SRC = os.path.join(HERE, "src")
IATR_WF = "1985966508400201729"  # IA_TRANSFER_REQUEST (the spare "Workflow 5": same id on dev and prod)
V2_SAVE = ["lotV2_onClick_save_draft", "lotV2_onClick_save_inprogress", "lotV2_onClick_save_completed"]
NEW_BUTTONS = ["button_save_picks", "button_dispatch", "button_cancel_request", "button_receive"]
NEW_UI = ["requested_status", "iatr_info", "button_view_ia", "iatr_link", "iatr_ia_no"]
BADGE_FROM = ("Processing Button", ".processing-button", "#8B5CF6", "#EDE9FE", "#5B21B6", '<div class="processing-button">Processing</div>')
# cyan: amber is In Progress on the list
BADGE_TO = ("Requested Button", ".requested-button", "#0891B2", "#CFFAFE", "#155E75", '<div class="requested-button">Requested</div>')
GUARD = 'String(this.getValue("transfer_purpose") || "") === "IA_SUPPLY"'
ROW_CSS = """      const styleId = "lot-hide-row-actions";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
                .fm-virtual-table__row-cell .scope-action { display: none !important; }
                .fm-virtual-table__row-cell .scope-index { display: flex !important; }
              `;
        document.head.appendChild(style);
      }"""
# mounted: (old, new) - each old text found exactly once
MOUNTED = [
    # the user, 10-29: the Production Order switch and number are never shown (no transfer uses them on dev or prod; v113 showed the switch,
    # off, on every Add / Edit through CONFIG.fields.all); a production order's transfer keeps its lines locked
    ('      "movement_reason",\n      "is_production_order",\n    ],\n', '      "movement_reason",\n    ],\n'),
    ('    this.display(["production_order_id", "is_production_order"]);\n', '    // the Production Order switch and number: never shown (the user, 10-29)\n'),
    ('    Processing: "lot_processing_status",\n  };\n',
     '    Processing: "lot_processing_status",\n    // IA transfer request (scratchpad/iatr)\n    Requested: "requested_status",\n  };\n'),
    ('    buttons: ["button_save_as_draft", "button_inprogress", "button_completed"],\n',
     '    buttons: ["button_save_as_draft", "button_inprogress", "button_completed", "button_save_picks", "button_dispatch", "button_cancel_request", "button_receive"],\n'),
    ('const configureButtons = (pageStatus, stockMovementStatus) => {\n  this.hide(CONFIG.fields.buttons);\n',
     'const configureButtons = (pageStatus, stockMovementStatus) => {\n  this.hide(CONFIG.fields.buttons);\n'
     '  // IA transfer request (scratchpad/iatr): a request\'s own buttons only - its picks saved, dispatched, cancelled, received\n'
     '  if (' + GUARD + ') {\n'
     '    if (pageStatus === "Edit" && stockMovementStatus === "Requested") this.display(["button_save_picks", "button_dispatch", "button_cancel_request"]);\n'
     '    else if (pageStatus === "Edit" && stockMovementStatus === "In Progress") this.display(["button_receive"]);\n'
     '    return;\n  }\n'),
    ('  if (/^[0-9]{1,20}$/.test(jobId) && (data.stock_movement_status === "Draft" || data.stock_movement_status === "In Progress")) {\n',
     '  if (/^[0-9]{1,20}$/.test(jobId) && (data.stock_movement_status === "Draft" || data.stock_movement_status === "In Progress" || data.stock_movement_status === "Requested")) {\n'),
    ('const lotBackgroundView = (pageStatus, data) => {\n',
     '// IA transfer request (scratchpad/iatr): what a request shows - its source, dates and requester, the Requested Qty; its demand and\n'
     '// destination are its Item Assembly\'s (locked); while Requested its rows can\'t be removed (the row actions hidden, as In Progress does)\n'
     'const showTransferRequest = (data) => {\n'
     '  if (String(data.transfer_purpose || "") !== "IA_SUPPLY") return;\n'
     '  const parts = ["Transfer request for Item Assembly " + (data.source_ia_no || data.source_ia_id || "")];\n'
     '  if (data.required_date) parts.push("required " + String(data.required_date).slice(0, 10));\n'
     '  if (data.requested_by) parts.push("requested by " + data.requested_by + (data.requested_at ? " on " + String(data.requested_at).slice(0, 16) : ""));\n'
     '  if (Number(data.source_ia_rev) > 1) parts.push("revision " + data.source_ia_rev);\n'
     '  this.setData({ iatr_info: parts.join(" · "), iatr_link: 1, iatr_ia_no: data.source_ia_no || data.source_ia_id || "" });\n'
     '  this.display(["iatr_info", "button_view_ia", "stock_movement.requested_qty", "iatr_link", "iatr_ia_no"]);\n'
     '  this.disabled(["iatr_link", "iatr_ia_no"], true);\n'
     '  this.disabled(["stock_movement.item_selection", "stock_movement.location_id", "stock_movement.storage_location_id"], true);\n'
     '  if (data.stock_movement_status === "Requested") {\n'
     '    setTimeout(() => {\n' + ROW_CSS + '\n    }, 500);\n  }\n};\n\n'
     'const lotBackgroundView = (pageStatus, data) => {\n'),
    ('        showProductionOrder(data);\n        showStatusHTML(data.stock_movement_status);\n        hideSerialNumberRecordTab();\n        break;\n\n      case "View":\n',
     '        showProductionOrder(data);\n        showTransferRequest(data);\n        showStatusHTML(data.stock_movement_status);\n        hideSerialNumberRecordTab();\n        break;\n\n      case "View":\n'),
    ('        showStatusHTML(data.stock_movement_status);\n        showProductionOrder(data);\n        hideSerialNumberRecordTab();\n        break;\n    }\n',
     '        showStatusHTML(data.stock_movement_status);\n        showProductionOrder(data);\n        showTransferRequest(data);\n        hideSerialNumberRecordTab();\n        break;\n    }\n'),
]
# the V2 save handlers: (old, new) in each of the 3 copies
V2 = [
    ('const SAVE_BUTTONS = ["button_save_as_draft", "button_inprogress", "button_completed"];\n',
     'const SAVE_BUTTONS = ["button_save_as_draft", "button_inprogress", "button_completed", "button_save_picks", "button_dispatch", "button_cancel_request", "button_receive"];\n'),
    ('  "cancel_status", "flex_2det1nd2", "flex_t6y2yh5r"].concat(SAVE_BUTTONS);\n',
     '  "cancel_status", "flex_2det1nd2", "flex_t6y2yh5r", "requested_status", "iatr_info", "button_view_ia", "iatr_link", "iatr_ia_no"].concat(SAVE_BUTTONS);\n'),
    ('  const stored = isNew ? "Draft" : s(v.stock_movement_status);\n',
     '  const stored = isNew ? "Draft" : s(v.stock_movement_status);\n'
     '  // IA transfer request (scratchpad/iatr): a request\'s picks are saved by the classic; every other save of it goes to SUBMIT whatever\n'
     '  // its size (dispatch = STAGE, receipt = COMPLETE; anything else SUBMIT refuses, with the reason)\n'
     '  if (!isNew && s(v.transfer_purpose) === "IA_SUPPLY") {\n'
     '    if (stored === "Requested" && saveAs === "Draft") return { why: "a request\'s picks are saved by the classic save" };\n'
     '    const a = stored === "Requested" && saveAs === "In Progress" ? "STAGE" : stored === "In Progress" && saveAs === "Completed" ? "COMPLETE" : "EDIT";\n'
     '    return { action: a, isNew: false, page: page, purpose: true };\n  }\n'),
    ('  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") return classic(r.route + ": " + (s(r.reason) || message));\n',
     '  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") {\n'
     '    // a request\'s stock moves only in the background (the classic refuses them): say why instead\n'
     '    if (ctx.purpose) {\n      release();\n      this.$message.error("This transfer request can\'t be saved: " + (s(r.reason) || message || r.route) + ".");\n      return;\n    }\n'
     '    return classic(r.route + ": " + (s(r.reason) || message));\n  }\n'),
    ('    const ctx = { action: route.action, isNew: route.isNew, page: route.page, saveAs: button.saveAs, record: record, gen: Number(data_().lot_gen) || 1 };\n',
     '    const ctx = { action: route.action, isNew: route.isNew, page: route.page, saveAs: button.saveAs, record: record, gen: Number(data_().lot_gen) || 1,\n'
     '      purpose: route.purpose === true };\n'),
    # the user, 10-29: opened from its Item Assembly (View Transfer Request), a save refreshed the IA form - a refresh re-initialises a form
    # without its mounted, so its badge, buttons and sections were gone; that form redraws its request section instead (the list as before)
    ('const closeDialog = () => {\n  if (this.parentGenerateForm) {\n    this.parentGenerateForm.$refs.SuPageDialogRef.hide();\n    this.parentGenerateForm.refresh();\n  }\n};\n\n'
     'const refreshList = () => {\n  if (this.parentGenerateForm) this.parentGenerateForm.refresh();\n};\n',
     '// the opener after a save: the Location Transfer list is refreshed; an Item Assembly form (View Transfer Request) is not - a refresh\n'
     '// re-initialises a form without its mounted (badge, buttons, sections gone) - it redraws its transfer request section instead\n'
     'const refreshParent = () => {\n  const p = this.parentGenerateForm;\n  if (!p) return;\n  const m = p.models;\n'
     '  if (m && typeof m === "object" && Object.prototype.hasOwnProperty.call(m, "item_assembly_status") && typeof p.triggerEvent === "function") {\n'
     '    p.triggerEvent("tr_main", { trOp: "RELOAD" });\n    return;\n  }\n  p.refresh();\n};\n\n'
     'const closeDialog = () => {\n  if (this.parentGenerateForm) {\n    this.parentGenerateForm.$refs.SuPageDialogRef.hide();\n    refreshParent();\n  }\n};\n\n'
     'const refreshList = () => refreshParent();\n'),
    # the user, 10-29: a save finished while the form waited said "saved." twice - kickLoop asked the worker again about the finished job
    ('    if (js === "COMPLETED") return finish(name + " saved.");\n',
     '    // already done: one toast, the form closed - kickLoop would ask the worker about a finished job and say "saved." again\n'
     '    if (js === "COMPLETED") {\n      release();\n      this.$message.success(name + " saved.");\n      closeDialog();\n      return;\n    }\n'),
]
APPLY_OLD = 'this.setData({\n  dialog_apply_location: {\n'
APPLY_HEAD = ('// IA transfer request (scratchpad/iatr): a request\'s destination is its Item Assembly\'s\n'
              'if (' + GUARD + ') {\n'
              '  this.$message.warning("A transfer request\'s destination is set by its Item Assembly: refresh the request from there to change it.");\n'
              '} else {\n')


def replace_once(text, old, new, where):
    assert text.count(old) == 1, (where, text.count(old), old[:90])
    return text.replace(old, new)


def behaviour(form, raw):
    keys = Keys(json.dumps(form), SEED + 1)
    ev = {e["name"]: e for e in form["config"]["eventScript"]}
    assert all(n in ev for n in V2_SAVE + ["mounted", "onTableSmfunc_applyTargetLocation"])
    added = []
    # the Requested badge, next to the others in the title row
    proc = one(form, "lot_processing_status")
    html = proc["options"]["defaultValue"]
    for a, b in zip(BADGE_FROM, BADGE_TO):
        html = replace_once(html, a, b, "badge")
    badge = widget(proc, keys, "requested_status", "Requested Status", defaultValue=html, hidden=True)
    title = parent_list(form["list"], proc)
    title.insert([w.get("model") for w in title].index("lot_processing_status") + 1, badge)
    added.append(badge)
    # the request's info line + View Item Assembly, right after the header grid (UI only)
    top = form["list"]
    txt = one(form, "delivery_method_text")
    info = widget(txt, keys, "iatr_info", "Transfer Request", dataBind=False, hidden=True, defaultValue="")
    draft_btn, ip_btn, done_btn = one(form, "button_save_as_draft"), one(form, "button_inprogress"), one(form, "button_completed")

    def button(tpl, model, name, on_click, permission=None):
        b = widget(tpl, keys, model, name, buttonName=name, hidden=True)
        b["events"]["onClick"] = on_click
        if permission:
            b["options"]["permission"] = permission
        else:
            b["options"].pop("permission", None)
        return b
    # the new handlers (appended to the events, keys from the stream)
    names = {}
    for nm in ("lotIatr_onClick_dispatch", "lotIatr_onClick_receive", "lotIatr_onClick_cancelRequest", "lotIatr_onClick_viewIa"):
        func = open(os.path.join(SRC, nm + ".js"), encoding="utf-8").read().rstrip("\n").replace("__IA_TRANSFER_REQUEST__", IATR_WF)
        assert "__" not in func.replace("__proto__", ""), nm
        k = keys.new()
        form["config"]["eventScript"].append({"key": k, "name": nm, "func": func, "type": "js"})
        names[nm] = k
    view = button(draft_btn, "button_view_ia", "View Item Assembly", names["lotIatr_onClick_viewIa"])
    grid = [w.get("model") for w in top].index("grid_x46134mc")
    top[grid + 1:grid + 1] = [info, view]
    added += [info, view]
    # the request's buttons, after the save buttons in the action bar
    bar = parent_list(form["list"], done_btn)
    new = [button(draft_btn, "button_save_picks", "Save Picks", draft_btn["events"]["onClick"]),
           button(ip_btn, "button_dispatch", "Dispatch", names["lotIatr_onClick_dispatch"], "lot_ia_dispatch"),
           button(draft_btn, "button_cancel_request", "Cancel Request", names["lotIatr_onClick_cancelRequest"], "ia_create_transfer_request"),
           button(done_btn, "button_receive", "Receive", names["lotIatr_onClick_receive"], "lot_ia_receive")]
    at = [w.get("model") for w in bar].index("button_completed")
    bar[at + 1:at + 1] = new
    added += new
    # the user, 10-29: a request's Item Assembly as a production order's transfer shows its order - the link and the number, UI only,
    # right after Production Order No (filled, shown and locked by showTransferRequest)
    po_no = one(form, "production_order_id")
    link = widget(one(form, "is_production_order"), keys, "iatr_link", "Link to Item Assembly", dataBind=False, hidden=True, defaultValue=0)
    ia_no = widget(one(form, "source_ia_no"), keys, "iatr_ia_no", "Item Assembly No", dataBind=False, hidden=True, defaultValue="")
    hdr = parent_list(form["list"], po_no)
    at = [w is po_no for w in hdr].index(True)
    hdr[at + 1:at + 1] = [link, ia_no]
    added += [link, ia_no]
    # the patched handlers
    m = ev["mounted"]["func"]
    for old, new_text in MOUNTED:
        m = replace_once(m, old, new_text, "mounted")
    ev["mounted"]["func"] = m
    for nm in V2_SAVE:
        f = ev[nm]["func"]
        for old, new_text in V2:
            f = replace_once(f, old, new_text, nm)
        ev[nm]["func"] = f
    ap = ev["onTableSmfunc_applyTargetLocation"]["func"]
    i = ap.index(APPLY_OLD)
    body = ap[i:]
    ev["onTableSmfunc_applyTargetLocation"]["func"] = ap[:i] + APPLY_HEAD + "\n".join(("  " + l if l else l) for l in body.split("\n")) + "\n}"
    return added


RR_LINE = [("defect_reason", "Defect Reason", "balance_id"), ("defect_qty", "Defect Qty", "bundle_ratio"), ("defect_detail", "Defect Detail", "temp_excess_data")]


def rr_fields(form):
    """reserved requests (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 3): the replacement link and the line defects, hidden and inert.
    Their keys are drawn after every existing widget's, so no published key moves (columns pair by key)."""
    keys = Keys(json.dumps(form), SEED + 9)
    sm = one(form, "stock_movement")
    col = parent_list(form["list"], one(form, "replaces_id"))
    at = [w.get("model") for w in col].index("replaces_id")
    rep = widget(one(form, "lot_v2_job_id"), keys, "replacement_for_id", "Replacement For")
    col[at + 1:at + 1] = [rep]
    added = [rep]
    for model, name, tpl_model in RR_LINE:
        tpl = [c for c in sm["tableColumns"] if c.get("model") == tpl_model]
        assert len(tpl) == 1 and tpl[0]["options"]["hidden"] is True and tpl[0]["options"]["dataBind"] is True, tpl_model
        w = widget(tpl[0], keys, model, name)
        sm["tableColumns"].append(w)
        added.append(w)
    return added


# reserved requests (RESERVED_REQUEST_PLAN.md Task 10), phase full: the Receive dialog, the receipts with the Completed save, the pick
# dialog's add-back, the request's line (its replacement, its bins to count); each text change a (old, new) pair, so the test undoes them
IATR_REASON_TABLE = "2113116113794039809"  # Category Transfer Reason (category_transfer_reason)
RR_EVENTS = ["lotRr_onConfirm_receive", "lotRr_onCancel_receive"]
RR_WIDGETS = ["iatr_receive_dialog", "iatr_receive_note", "iatr_receive_table"]
RR_NOTE = ("Enter what arrived good and what is defective on each line (each batch of a batch item): Good + Defect must equal what was dispatched - "
           "anything lost counts as Defect. Good is reserved for the Item Assembly at the staging bin; Defect goes to Blocked there, with its reason.")
RR_V2 = [
    ('"requested_status", "iatr_info", "button_view_ia", "iatr_link", "iatr_ia_no"].concat(SAVE_BUTTONS);\n',
     '"requested_status", "iatr_info", "button_view_ia", "iatr_link", "iatr_ia_no", "iatr_receive_dialog"].concat(SAVE_BUTTONS);\n'),
    ('    NOT_RECORD.forEach((k) => delete record[k]);\n',
     '    NOT_RECORD.forEach((k) => delete record[k]);\n'
     '    // reserved requests (scratchpad/iatr, Task 10): a request\'s receipt carries the Receive dialog\'s good / defect / reason (SUBMIT checks it)\n'
     '    if (route.purpose === true && button.saveAs === "Completed" && this.models["_iatr_receipts"]) record.iatr_receipts = this.models["_iatr_receipts"];\n'),
]
RR_INFO = r'''// reserved requests (scratchpad/iatr, Task 10): a replacement names the request it follows; a dispatch made away from the reservation names
// the bins to count (LOT_V2_COMMIT's DISPATCH entry in the request's log); names read, the line written again with them
const rrInfo = async (data, parts) => {
  const s = (x) => (x === undefined || x === null ? "" : String(x)).trim();
  const ids = (list) => Array.from(new Set(list.map(s).filter((x) => /^[0-9A-Za-z]{1,20}$/.test(x))));
  const read = (name, list, field) => (list.length ? db.collection(name).filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: list }] }])
    .field(field).get().then((r) => (r && r.data) || [], () => []) : Promise.resolve([]));
  const more = [];
  try {
    let log = [];
    try {
      const x = JSON.parse(s(data.request_log) || "[]");
      log = Array.isArray(x) ? x : [];
    } catch (e) {
      log = [];
    }
    const count = log.filter((x) => x && x.op === "DISPATCH" && Array.isArray(x.count)).reduce((a, x) => a.concat(x.count), [])
      .filter((c) => c && typeof c === "object" && Array.isArray(c.reserved) && c.reserved.length);
    const keys = count.reduce((a, c) => a.concat([c.from || {}], c.reserved), []);
    const prevId = ids([data.replacement_for_id])[0] || "";
    const [prev, bins, batches, items] = await Promise.all([
      prevId ? db.collection("sm_location_transfer").where({ id: prevId }).field("stock_movement_no").get().then((r) => (r && r.data) || [], () => []) : Promise.resolve([]),
      read("bin_location", ids(keys.map((k) => k && k.bin)), "bin_location_combine"),
      read("batch", ids(keys.map((k) => k && k.batch)), "batch_number"),
      read("Item", ids(count.map((c) => c.item)), "material_name,material_code")]);
    if (prevId) more.push("replacement for " + (s((prev[0] || {}).stock_movement_no) || "an earlier request"));
    if (count.length) {
      const named = (rows, f) => rows.reduce((m, r) => Object.assign(m, { [s(r.id)]: f(r) }), {});
      const bin = named(bins, (r) => s(r.bin_location_combine));
      const bat = named(batches, (r) => s(r.batch_number));
      const it = named(items, (r) => s(r.material_name) || s(r.material_code));
      const label = (k) => (bin[s(k && k.bin)] || s(k && k.bin)) + (s(k && k.batch) ? " / " + (bat[s(k.batch)] || s(k.batch)) : "");
      more.push("bins to count: " + count.map((c) => c.reserved.map(label).join(", ") + " (" + (it[s(c.item)] || s(c.item)) + " picked from " + label(c.from) + " instead)").join("; "));
    }
  } catch (e) {
    console.error("Transfer request: its replacement / bins to count could not be read", e);
  }
  if (more.length) this.setData({ iatr_info: parts.concat(more).join(" · ") });
};

'''
RR_MOUNTED = [
    ("const showTransferRequest = (data) => {\n", RR_INFO + "const showTransferRequest = (data) => {\n"),
    # (its own line is written after this one: rrInfo awaits its reads first)
    ('  if (Number(data.source_ia_rev) > 1) parts.push("revision " + data.source_ia_rev);\n',
     '  if (Number(data.source_ia_rev) > 1) parts.push("revision " + data.source_ia_rev);\n  rrInfo(data, parts);\n'),
]
RR_PICK = [
    ("          );\n        }\n      }\n      return freshDbData;\n    };\n",
     "          );\n        }\n      }\n"
     "      // reserved requests (scratchpad/iatr, Task 10): this request line's own Item Assembly holds back into the free stock it shows, where\n"
     "      // they are - that stock is reserved for this request (the design's step 3); another line's or document's never, nor the staging bin's\n"
     "      if (String(allData.transfer_purpose || \"\") === \"IA_SUPPLY\" && String(lineItemData.source_ia_line_id || \"\")) {\n"
     "        const rrS = (x) => (x === undefined || x === null ? \"\" : String(x));\n"
     "        const rrBase = (r) => {\n"
     "          const uom = rrS(r.item_uom);\n"
     "          if (!uom || uom === rrS(itemData.based_uom)) return 1;\n"
     "          const c = (Array.isArray(itemData.table_uom_conversion) ? itemData.table_uom_conversion : []).find((x) => x && rrS(x.alt_uom_id) === uom);\n"
     "          return c && parseFloat(c.base_qty) > 0 ? parseFloat(c.base_qty) : 0;\n"
     "        };\n"
     "        for (const row of freshDbData) {\n"
     "          let own = 0;\n"
     "          for (const r of activeReservations) {\n"
     "            if (rrS(r.doc_type) !== \"Item Assembly\" || rrS(r.doc_id) !== rrS(allData.source_ia_id) || rrS(r.doc_line_id) !== rrS(lineItemData.source_ia_line_id)) continue;\n"
     "            if (rrS(r.handling_unit_id) || (rrS(r.from_category) || \"Unrestricted\") !== \"Unrestricted\") continue;\n"
     "            if (rrS(r.bin_location) !== rrS(row.location_id) || rrS(r.bin_location) === rrS(lineItemData.location_id) || rrS(r.batch_id) !== rrS(row.batch_id)) continue;\n"
     "            own += (parseFloat(r.open_qty) || 0) * rrBase(r);\n"
     "          }\n"
     "          if (!(own > 0)) continue;\n"
     "          row.unrestricted_qty = (parseFloat(row.unrestricted_qty) || 0) + own;\n"
     "          row.reserved_qty = Math.max(0, (parseFloat(row.reserved_qty) || 0) - own);\n"
     "        }\n"
     "      }\n"
     "      return freshDbData;\n    };\n"),
]


def rr_src(name):
    func = open(os.path.join(SRC, name), encoding="utf-8").read().rstrip("\n")
    assert "__" not in func.replace("__proto__", ""), name
    return func


def rr_behaviour(form):
    """reserved requests (RESERVED_REQUEST_PLAN.md Task 10), phase full: keys drawn after every other key (rr_fields' included), so no
    published key moves. Receive opens the Receive dialog for a reserved request (lotRr_onClick_receive.js replaces the v7 receive text);
    its confirm puts the receipts where the Completed save adds them to the record; the pick dialog adds the request line's own Item
    Assembly holds back; the request's line names its replacement and its bins to count"""
    keys = Keys(json.dumps(form), SEED + 10)
    ev = {e["name"]: e for e in form["config"]["eventScript"]}
    names = {}
    for nm in RR_EVENTS:
        k = keys.new()
        form["config"]["eventScript"].append({"key": k, "name": nm, "func": rr_src(nm + ".js"), "type": "js"})
        names[nm] = k
    # the Receive dialog (a copy of the pick dialog) and its table (a copy of table_hu, as the pick dialog's own: a json column no save
    # writes; the dialog stays out of the V2 record, RR_V2): item / batch / dispatched read-only, good / defect / reason the inputs
    th = one(form, "table_hu")
    col = {c["model"]: c for c in th["tableColumns"]}
    assert (th["options"]["generateSubTable"], th["options"]["rowActions"]) == (False, [])
    assert [(col[m]["type"], col[m]["options"]["tableColumn"]) for m in ("handling_no", "item_quantity", "material_id", "handling_unit_id")] == \
        [("input", True), ("number", True), ("select", True), ("input", True)]

    def column(tpl, model, name, **opts):
        return widget(tpl, keys, model, name, required=False, **opts)

    reasons = {"rules": {"collectionId": IATR_REASON_TABLE, "list": [
        {"id": 1749795510765, "parentId": 1749795510764, "isTop": True, "prop": "organization_id", "operator": "equal", "valueType": "field",
         "value": "{{global:firstLvDeptId}}", "type": "leaf", "level": 1, "propLabel": "Organization", "valueLabel": "", "operatorLabel": "Equal", "valueTypeLabel": "公式"}]},
        "source": "Category Transfer Reason:Table:" + IATR_REASON_TABLE}
    props = dict(copy.deepcopy(col["material_id"]["options"]["props"]), value="reason", label="reason")
    cols = [column(col["handling_no"], "item", "Item", disabled=True, hidden=False), column(col["handling_no"], "batch", "Batch", disabled=True, hidden=False),
            column(col["item_quantity"], "dispatched", "Dispatched", disabled=True, hidden=False),
            column(col["item_quantity"], "good", "Good", disabled=False, hidden=False, defaultValue=0),
            column(col["item_quantity"], "defect", "Defect", disabled=False, hidden=False, defaultValue=0),
            column(col["material_id"], "reason", "Reason", disabled=False, hidden=False, defaultValue="", datasource=reasons, props=props, remote=True),
            column(col["handling_unit_id"], "line_id", "Line ID", disabled=True, hidden=True), column(col["handling_unit_id"], "line_no", "Line", disabled=True, hidden=True),
            column(col["handling_unit_id"], "batch_id", "Batch ID", disabled=True, hidden=True)]
    table = widget(th, keys, "iatr_receive_table", "Receipt", isAdd=False, isDelete=False, paging=True, pageSize=10, defaultValue=[], virtualTable=False,
                   tableHeightMode="auto")
    table["tableColumns"] = cols
    note = widget(one(form, "delivery_method_text"), keys, "iatr_receive_note", "Note", dataBind=False, hidden=False, defaultValue=RR_NOTE)
    dialog = widget(one(form, "sm_item_balance"), keys, "iatr_receive_dialog", "Receive", title="Receive Transfer Request", width="80%", showOk=True,
                    okText="Receive", cancelText="Cancel")
    dialog["list"] = [note, table]
    dialog["events"] = {"onCancel": names["lotRr_onCancel_receive"], "onConfirm": names["lotRr_onConfirm_receive"]}
    form["list"].append(dialog)
    # the patched handlers
    rc = ev["lotIatr_onClick_receive"]
    old = rr_src("lotIatr_onClick_receive.js")
    assert rc["func"] == old, "the receive handler is not v118's"
    rc["func"] = rr_src("lotRr_onClick_receive.js")
    m = ev["mounted"]["func"]
    for o, nw in RR_MOUNTED:
        m = replace_once(m, o, nw, "mounted (RR)")
    ev["mounted"]["func"] = m
    for nm in V2_SAVE:
        f = ev[nm]["func"]
        for o, nw in RR_V2:
            f = replace_once(f, o, nw, nm + " (RR)")
        ev[nm]["func"] = f
    js = [r for r in ev["onClick_select_stock"]["rules"] if r.get("action") == "js"]
    assert len(js) == 1
    f = js[0]["options"]["func"]
    for o, nw in RR_PICK:
        f = replace_once(f, o, nw, "onClick_select_stock (RR)")
    js[0]["options"]["func"] = f
    return [dialog, note, table]


def build(phase="fields"):
    raw = open(BASE, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "base/lot_form_v113.json is not the pinned v113"
    form = json.loads(raw)
    added = fields(form, raw)
    # rrfields (B22): the live full form (v118) + the reserved requests' fields, no new behaviour - the columns before the workflows
    if phase in ("full", "rrfields"):
        added += behaviour(form, raw)
    added += rr_fields(form)
    if phase == "full":
        added += rr_behaviour(form)
    keys = []

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("key"), str) and ("model" in n or "type" in n):
                keys.append(n["key"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(form["list"])
    keys += [e["key"] for e in form["config"]["eventScript"]]
    assert len(keys) == len(set(keys)), "a key is used twice"
    return form, added


if __name__ == "__main__":
    if "--patches" in sys.argv:
        # the exact text changes, for the test's undo
        print(json.dumps({"mounted": MOUNTED, "v2": V2, "apply_old": APPLY_OLD, "apply_head": APPLY_HEAD, "v2_handlers": V2_SAVE, "iatr_wf": IATR_WF,
                          "rr": {"widgets": RR_WIDGETS, "events": RR_EVENTS, "mounted": RR_MOUNTED, "v2": RR_V2, "pick": RR_PICK,
                                 "receive": [rr_src("lotIatr_onClick_receive.js"), rr_src("lotRr_onClick_receive.js")]}}))
        sys.exit(0)
    for phase in ("fields", "rrfields", "full"):
        form, added = build(phase)
        text = json.dumps(form, ensure_ascii=False, separators=(",", ":"))
        path = os.path.join(OUT, phase, "LOTform.json")
        print("LOT form %s: %d widgets added (%s), md5 %s%s" % (phase, len(added), ", ".join(w["model"] for w in added), hashlib.md5(text.encode("utf-8")).hexdigest(),
                                                               " -> " + path if "--write" in sys.argv else " (dry)"))
        if "--write" in sys.argv:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "w", encoding="utf-8").write(text)
