// SI 2k test library (copied from scratchpad/pi2k/sim/lib.js): placeholder injection as the platform does it (JSON text
// into code), code-node output filtering (declared keys only, null keys dropped at every depth, "" kept), recorded-run readers.
"use strict";
const fs = require("fs");
const path = require("path");

class Mapped extends Array {}

function getPath(obj, parts) {
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === undefined || cur === null) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(parts[i])) {
      const rest = parts.slice(i);
      const out = new Mapped();
      for (const el of cur) out.push(getPath(el, rest));
      return out;
    }
    cur = cur[parts[i]];
  }
  return cur;
}

// ctx: { params, out: { nodeId: result-with-.data }, loops: { loopId: item }, system: {...} }
function resolve(ref, ctx) {
  const m = ref.match(/^(node|workflowparams|system|global):(.+)$/);
  if (!m) throw new Error("bad ref " + ref);
  const [, kind, p] = m;
  if (kind === "system") return (ctx.system || {})[p];
  if (kind === "global") return (ctx.global || {})[p];
  if (kind === "workflowparams") return getPath(ctx.params, p.split("."));
  const parts = p.split(".");
  const id = parts[0];
  if (ctx.loops && ctx.loops[id] !== undefined) return getPath(ctx.loops[id], parts.slice(1));
  if (!(id in ctx.out)) return undefined;
  return getPath(ctx.out[id], parts.slice(1));
}

// code-node injection: each placeholder becomes the JSON text of its value (null when it does not resolve)
function injectJs(text, ctx, used) {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
    const v = resolve(ref, ctx);
    if (used) used[ref] = v === undefined ? null : v;
    return v === undefined ? "null" : JSON.stringify(v);
  });
}

// sql / if-expression injection: raw text
function injectRaw(text, ctx) {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
    const v = resolve(ref, ctx);
    return v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

// the platform's code-node output: null keys dropped at every depth ("" kept)
function dropNulls(v) {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined) o[k] = dropNulls(v[k]);
    return o;
  }
  return v;
}

function runCode(script, ctx, declared, used) {
  const src = injectJs(script, ctx, used);
  let res;
  try {
    res = new Function("console", src)({ log: () => {}, error: () => {}, warn: () => {} });
  } catch (e) {
    throw new Error("code failed: " + e.message + "\n" + src.slice(0, 400));
  }
  const kept = {};
  for (const k of declared || Object.keys(res || {})) if (res && k in res && res[k] !== undefined && res[k] !== null) kept[k] = dropNulls(JSON.parse(JSON.stringify(res[k])));
  return kept;
}

// ---------------------------------------------------------------- the sub-workflows (dev mirror, verbatim logic)
function checkRequiredField(entryText, requiredFieldsText) {
  const validateField = (value, field) => {
    if (value === undefined || value === null) return true;
    if (typeof value === "string") return value.trim() === "";
    if (typeof value === "number") return value <= 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return !value;
  };
  const validateForm = (data, requiredFields) => {
    const missingFields = [];
    requiredFields.forEach((field) => {
      const value = data[field.name];
      if (!field.isArray) {
        if (validateField(value, field)) missingFields.push(field.label);
        return;
      }
      if (!Array.isArray(value)) {
        missingFields.push(`${field.label}`);
        return;
      }
      if (value.length === 0) {
        missingFields.push(`${field.label}`);
        return;
      }
      if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
        value.forEach((item, index) => {
          field.arrayFields.forEach((subField) => {
            const subValue = item[subField.name];
            if (validateField(subValue, subField)) missingFields.push(`${subField.label} (in ${field.label} #${index + 1})`);
          });
        });
      }
    });
    return missingFields;
  };
  const entry = JSON.parse(entryText);
  const requiredFields = JSON.parse(requiredFieldsText);
  const missingFields = validateForm(entry, requiredFields);
  return missingFields.length === 0 ? { status: "Passed", message: "" } : { status: "Failed", message: "Validation Error: " + missingFields.join(", ") };
}

function validateQuantity(lineItemText, itemFields, quantityFields) {
  const lineItem = JSON.parse(lineItemText);
  const itemIDFields = itemFields.split(",")[0];
  const itemNameFields = itemFields.split(",")[1];
  const itemDescFields = itemFields.split(",")[2];
  let status = "Passed";
  const message = [];
  for (const [index, item] of lineItem.entries()) {
    if (item[itemIDFields] || item[itemDescFields] || item[itemNameFields]) {
      if (parseFloat(item[quantityFields]) <= 0) {
        status = "Failed";
        message.push(`The following items have quantity less than or equal to zero: ${item[itemNameFields]}`);
      }
    } else if (parseFloat(item[quantityFields]) > 0) {
      status = "Failed";
      message.push(`The following items have quantity but missing item code/item name/item description: Line ${index + 1}`);
    }
  }
  return { status: status, message: message.join("\n") || "" };
}

// CHECK_APPROVAL, PO case, for one documentConfig
function checkApprovalPO(poDataIn, documentConfig) {
  const poData = JSON.parse(JSON.stringify(poDataIn));
  const isFirstIssue = poData.po_status === "Issued" && poData.previous_status !== "Issued";
  const issuedTriggered = Number(documentConfig.po_issued) === 1 && isFirstIssue;
  const hasPreq = Array.isArray(poData.preq_id) ? poData.preq_id.length > 0 : !!poData.preq_id;
  const convertTriggered = Number(documentConfig.po_convert) === 1 && hasPreq && isFirstIssue;
  const minPriceTriggered = Number(documentConfig.po_min_price) === 1 && poData.min_price_result === "failed";
  const maxPriceTriggered = Number(documentConfig.po_max_price) === 1 && poData.max_price_result === "failed";
  const amountTriggered = Number(documentConfig.po_amount) === 1 && poData.amount_result === "over";
  poData.approval_condition = {
    po_issued: issuedTriggered ? 1 : 0,
    po_convert: convertTriggered ? 1 : 0,
    po_min_price: minPriceTriggered ? 1 : 0,
    po_max_price: maxPriceTriggered ? 1 : 0,
    po_amount: amountTriggered ? 1 : 0,
  };
  const needApproval = issuedTriggered || convertTriggered || minPriceTriggered || maxPriceTriggered || amountTriggered ? "Yes" : "No";
  const approvalDocumentStatus = documentConfig.po_document_status || "draft";
  if (needApproval === "Yes" && isFirstIssue && approvalDocumentStatus === "draft") {
    if (poData.purchase_order_no === "issued") poData.purchase_order_no = "draft";
    poData.po_status = "Draft";
  }
  return { needApproval, poData };
}

// ---------------------------------------------------------------- recorded runs
// Big integers (snowflake ids) are stored unquoted in a run's JSON but reach code nodes as strings: quote them before
// parsing so nothing is rounded to a double.
function quoteBig(text) {
  // string-aware: digits inside a string (an escaped JSON text in a run's nodes_data) are left alone
  return text.replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"'));
}

function parseJ(x) {
  if (typeof x === "string") {
    try {
      return JSON.parse(quoteBig(x));
    } catch (e) {
      return x;
    }
  }
  return x;
}

function loadRun(file) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const nodes = {};
  let outer = [];
  try {
    outer = typeof r.nodes_data === "string" && r.nodes_data ? JSON.parse(r.nodes_data) : r.nodes_data || [];
  } catch (e) {
    outer = [];
  }
  for (const x of Array.isArray(outer) ? outer : []) {
    const req = parseJ(x.request_json_data);
    const res = parseJ(x.response_json_data);
    nodes[x.node_id] = { type: x.node_type, req: req, out: res, inBytes: (x.request_json_data || "").length, outBytes: (x.response_json_data || "").length };
  }
  const rq = parseJ(r.request_json_data) || {};
  const wp = parseJ(rq.workflowparams) || parseJ(rq.request_json) || {};
  return { meta: r, nodes: nodes, allData: parseJ(wp.allData) };
}

function readWorkflow(file) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const idx = {};
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      if (typeof n.id === "string" && n.type) idx[n.id] = n;
      Object.values(n).forEach(walk);
    }
  })(doc);
  return { doc, idx };
}

function declared(node) {
  return (node.data.response_json || []).map((r) => r.name);
}

module.exports = { dropNulls, quoteBig, Mapped, getPath, resolve, injectJs, injectRaw, runCode, checkRequiredField, validateQuantity, checkApprovalPO, loadRun, readWorkflow, declared, parseJ };
