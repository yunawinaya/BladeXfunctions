// Item Assembly output split (plan 10-27): the finished good received into several bins / batches, one row per receipt, shared by
// the IA form, IA_SAVE, IA_V2_SUBMIT and IA_V2_PREPARE; pure, ES2015
const OS_MAX_ROWS = 20;
const OS_EPS = 5e-9;
const OS_CATEGORIES = ["Unrestricted", "Blocked"];
// add_node_F9KqZLfd of ADD_INVENTORY: the Batch row's columns, in its order
const OS_BATCH_COLS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3",
  "manufacturing_date", "expired_date"];
const osS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const osQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const osDigits = (v) => /^[0-9]{1,20}$/.test(osS(v));
// a date as the date widget gave it ("2026-10-26 00:00:00.000" from a stored record, or a timestamp number), "" = none
const osDate = (v) => (typeof v === "number" && isFinite(v) ? v : osS(v));

// what a split may hold for this output: the classic's rules (code_batch_decide, scIsSerial, scIsNonStock)
const osKind = function osKind(item) {
  const it = item || {};
  if (Number(it.serial_number_management) === 1) return "SERIAL";
  if (it.stock_control === 0 || it.stock_control === "0") return "NONSTOCK";
  if (it.item_batch_management === 1) return it.batch_number_genaration === "According To System Settings" ? "SYSTEM" : "MANUAL";
  return "PLAIN";
};

// the rows of a payload or a stored column: an array, its JSON text or nothing ([]); null = unreadable
const osParse = function osParse(v) {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return null;
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : p === null ? [] : null;
  } catch (e) {
    return null;
  }
};

const osNorm = function osNorm(rows, kind) {
  const batch = kind === "SYSTEM" || kind === "MANUAL";
  return (rows || []).map((r) => {
    const x = r && typeof r === "object" ? r : {};
    return { os_qty: osQ8(x.os_qty), os_storage_location_id: osS(x.os_storage_location_id), os_location_id: osS(x.os_location_id), os_category: osS(x.os_category),
      os_group: kind === "SYSTEM" ? osS(x.os_group) : "", os_batch_no: batch ? osS(x.os_batch_no) : "", os_mfg_date: batch ? osDate(x.os_mfg_date) : "",
      os_exp_date: batch ? osDate(x.os_exp_date) : "" };
  });
};

// ADD_INVENTORY's conversion (code_node_mvszWJ8p): the item's table_uom_conversion row for the UOM, else 1
const osBaseFactor = function osBaseFactor(item, uom) {
  const conv = ((item && item.table_uom_conversion) || []).filter((c) => c && c.alt_uom_id === uom)[0];
  return conv ? parseFloat(conv.base_qty) || 0 : 1;
};

// rows of one group share one batch: System = the group number, Manual = the typed number (case-insensitive), non-batch = none
const osGroupKey = (row, kind) => (kind === "SYSTEM" ? "G" + osS(row.os_group) : kind === "MANUAL" ? "B" + osS(row.os_batch_no).toLowerCase() : "");

const osGroups = function osGroups(rows, kind, item, uom) {
  if (kind !== "SYSTEM" && kind !== "MANUAL") return [];
  const f = osBaseFactor(item, uom);
  const groups = [];
  const at = {};
  rows.forEach((r, i) => {
    const key = osGroupKey(r, kind);
    if (at[key] === undefined) {
      at[key] = groups.length;
      groups.push({ key: key, label: kind === "SYSTEM" ? "group " + r.os_group : "batch " + r.os_batch_no, rows: [], qty: 0, base: 0,
        batch_no: kind === "MANUAL" ? r.os_batch_no : "", mfg: r.os_mfg_date, exp: r.os_exp_date });
    }
    const g = groups[at[key]];
    g.rows.push(i);
    g.qty = osQ8(g.qty + r.os_qty);
    g.base = osQ8(g.base + osQ8(r.os_qty * f));
  });
  return groups;
};

const osSum = (rows) => osQ8((rows || []).reduce((s, r) => s + osQ8(r && r.os_qty), 0));

// ctx: kind, item_qty, item, item_uom, completing (a save that receives: every rule; else only what can never complete)
const osCheck = function osCheck(input, ctx) {
  const kind = ctx.kind;
  const rows = osNorm(input, kind);
  const res = (message, groups) => ({ ok: message === "", message: message, split: rows.length > 0, rows: rows, groups: groups || [] });
  if (rows.length === 0) return res("");
  if (kind === "SERIAL") return res("Serial-numbered items cannot be split across bins: switch Split receipt off.");
  if (kind === "NONSTOCK") return res("This item is not stock-controlled: there is no receipt to split. Switch Split receipt off.");
  if (rows.length > OS_MAX_ROWS) return res("A split receipt can have at most " + OS_MAX_ROWS + " rows.");
  if (!ctx.completing) return res("", osGroups(rows, kind, ctx.item, ctx.item_uom));
  if (rows.length < 2) return res("A split receipt needs at least 2 rows: add a row or switch Split receipt off.");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const at = "Output row " + (i + 1) + ": ";
    if (!(r.os_qty > 0)) return res(at + "enter a quantity above 0.");
    if (!osDigits(r.os_location_id)) return res(at + "choose a bin location.");
    if (OS_CATEGORIES.indexOf(r.os_category) < 0) return res(at + "choose Unrestricted or Blocked.");
    if (kind === "SYSTEM" && !/^[1-9][0-9]?$/.test(r.os_group)) return res(at + "enter a group number (rows with the same group share one batch).");
    if (kind === "MANUAL" && r.os_batch_no === "") return res(at + "enter a batch number.");
  }
  const total = osSum(rows);
  const want = osQ8(ctx.item_qty);
  if (Math.abs(total - want) > OS_EPS) return res("The split total " + total + " is not the output quantity " + want + ": adjust the rows.");
  const groups = osGroups(rows, kind, ctx.item, ctx.item_uom);
  for (let g = 0; g < groups.length; g++) {
    const first = rows[groups[g].rows[0]];
    const other = groups[g].rows.filter((i) => String(rows[i].os_mfg_date) !== String(first.os_mfg_date) || String(rows[i].os_exp_date) !== String(first.os_exp_date))[0];
    if (other !== undefined) {
      return res("Output rows " + (groups[g].rows[0] + 1) + " and " + (other + 1) + " are one batch (" + groups[g].label + ") with different dates: " +
        "give a batch one manufacturing and one expiry date.");
    }
    if (kind === "MANUAL") groups[g].rows.forEach((i) => (rows[i].os_batch_no = groups[g].batch_no));
  }
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    const key = osGroupKey(rows[i], kind) + "|" + rows[i].os_location_id + "|" + rows[i].os_category;
    if (seen[key] !== undefined) {
      return res("Output rows " + (seen[key] + 1) + " and " + (i + 1) + (kind === "PLAIN" ? " go to the same bin and category" : " put the same batch into the same bin and category") +
        ": merge them into one row.");
    }
    seen[key] = i;
  }
  return res("", groups);
};

// a split's row 1 into the header's single fields (single-value readers keep working); no split = the header's own values
const osHeader = function osHeader(rows, header, kind) {
  const h = header || {};
  const r = rows && rows[0];
  const own = { storage_location_id: h.storage_location_id, location_id: h.location_id, inventory_category: h.inventory_category, batch_no: h.batch_no,
    manufacturing_date: h.manufacturing_date, expired_date: h.expired_date };
  if (!r) return own;
  const batch = kind !== "PLAIN";
  return { storage_location_id: r.os_storage_location_id, location_id: r.os_location_id, inventory_category: r.os_category,
    batch_no: batch ? r.os_batch_no : own.batch_no, manufacturing_date: batch ? r.os_mfg_date : own.manufacturing_date, expired_date: batch ? r.os_exp_date : own.expired_date };
};

// System: the generated numbers, one per group in order, onto the groups and their rows (refused unless all present and distinct)
const osAssign = function osAssign(rows, groups, numbers) {
  const nums = (numbers || []).map(osS);
  const res = (message) => ({ ok: message === "", message: message, rows: rows, groups: groups });
  for (let g = 0; g < groups.length; g++) {
    if (!nums[g]) return res("Could not generate a batch number for " + groups[g].label + ". Check the Batch Number Configuration for this item.");
    const twin = nums.indexOf(nums[g]);
    if (twin < g) return res("Batch numbering gave " + groups[twin].label + " and " + groups[g].label + " the same number " + nums[g] + ": save again.");
  }
  const outRows = rows.map((r) => Object.assign({}, r));
  const outGroups = groups.map((g, i) => Object.assign({}, g, { batch_no: nums[i] }));
  outGroups.forEach((g) => g.rows.forEach((i) => (outRows[i].os_batch_no = g.batch_no)));
  return { ok: true, message: "", rows: outRows, groups: outGroups };
};

// one ADD_INVENTORY call per row in table order; ids = Batch row id by lower-case number; non-batch: '-' (ADD inserts no Batch row)
const osReceipts = function osReceipts(rows, groups, kind, ids, header) {
  const batch = kind === "SYSTEM" || kind === "MANUAL";
  const h = header || {};
  const map = ids || {};
  return rows.map((r, i) => {
    const id = batch ? map[r.os_batch_no.toLowerCase()] : null;
    return { row: i + 1, location_id: r.os_location_id, inventory_category: r.os_category, quantity: r.os_qty, batch_number: batch ? r.os_batch_no : "-",
      batch_id: id ? osS(id) : null, manufacturing_date: batch ? r.os_mfg_date || null : h.manufacturing_date || null,
      expired_date: batch ? r.os_exp_date || null : h.expired_date || null };
  });
};

// one Batch row per group, ADD_INVENTORY's columns; initial_quantity = the group's base qty
const osBatchRows = function osBatchRows(groups, header, trxNo) {
  const h = header || {};
  return groups.map((g) => ({ batch_number: g.batch_no, material_id: osS(h.item_id), initial_quantity: g.base, transaction_no: osS(trxNo), plant_id: osS(h.issuing_operation_faci),
    organization_id: osS(h.organization_id), remark: osS(h.remarks), remark2: osS(h.remarks_2), remark3: osS(h.remarks_3), manufacturing_date: g.mfg || null,
    expired_date: g.exp || null }));
};

// ---- IA_SAVE (and IA_V2_SUBMIT): the workflow steps around the rules above
// a SQL row's j column (text or object); 16+ digit numbers kept as text (ids)
const osJ = function osJ(rows) {
  const r = Array.isArray(rows) ? rows[0] : rows;
  const v = r && r.j !== undefined ? r.j : null;
  if (v && typeof v === "object") return v;
  const t = osS(v);
  if (!t) return null;
  try {
    return JSON.parse(t.replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};

// every save: the rows it writes - the payload's, else (a mobile payload: no key) the stored ones, which it may then not move (plant,
// item, bin); normalised keeping every field (a completion checks them by the item's kind). stored = the stored row ({output_split,
// plant, item_id, bin}); opts: edit (an Edit of a stored IA), tenantId
const osMerge = function osMerge(a, stored, opts) {
  const o = opts || {};
  const x = a || {};
  const has = Object.prototype.hasOwnProperty.call(x, "output_split");
  const out = (route, message, rows) => ({ route: route, message: message, split: rows.length ? "YES" : "NO", output_split: rows, count: String(rows.length),
    binIds: rows.map((r) => r.os_location_id).filter(osDigits).join(",") || "0", tenantId: osDigits(o.tenantId) ? osS(o.tenantId) : "0" });
  const stop = (message) => out("STOP", message, []);
  if (!has && o.edit && !stored) return stop("The stored output split could not be read: open the Item Assembly again and save.");
  const kept = stored ? osParse(stored.output_split) : [];
  const given = has ? osParse(x.output_split) : kept;
  if (given === null) return stop("The output split could not be read: open the Item Assembly again and save.");
  if (given.length > OS_MAX_ROWS) return stop("A split receipt can have at most " + OS_MAX_ROWS + " rows.");
  if (!has && given.length && (osS(x.issuing_operation_faci) !== osS(stored.plant) || osS(x.item_id) !== osS(stored.item_id) || osS(x.location_id) !== osS(stored.bin))) {
    return stop("This Item Assembly's output is split across bins: change its plant, item or bin on the desktop.");
  }
  return out("OK", "", osNorm(given, "SYSTEM"));
};

// a completion: every row's bin a live bin of the IA's plant; its storage location is the bin's. bins = [{id, plant, sl, active}]
const osBinCheck = function osBinCheck(rows, bins, plant) {
  const by = {};
  (bins || []).forEach((b) => {
    if (b && osS(b.id)) by[osS(b.id)] = b;
  });
  for (let i = 0; i < rows.length; i++) {
    const b = by[rows[i].os_location_id];
    if (!b || osS(b.plant) !== osS(plant)) return { ok: false, message: "Output row " + (i + 1) + ": its bin location is not a bin of this plant: choose it again.", rows: rows };
    if (Number(b.active) !== 1) return { ok: false, message: "Output row " + (i + 1) + ": its bin location is not active: choose another.", rows: rows };
  }
  return { ok: true, message: "", rows: rows.map((r) => Object.assign({}, r, { os_storage_location_id: osS(by[r.os_location_id].sl) })) };
};

// code_node_OScheck: a completion's rows checked for the item (from the items read) and the bins; a System split's groups to number
const osCompletion = function osCompletion(merged, a, items, read, uid) {
  const none = { route: "OK", message: "", kind: "", split: "NO", output_split: [], groups: [], gen: "NO", genGroups: [], cacheKey: "" };
  const rows = (merged && merged.output_split) || [];
  if (!rows.length) return none;
  const h = a || {};
  const item = (items || []).filter((it) => it && osS(it.id) === osS(h.item_id))[0] || null;
  const kind = osKind(item);
  const stop = (message) => Object.assign({}, none, { route: "STOP", message: message, kind: kind, split: "YES" });
  const chk = osCheck(rows, { kind: kind, item_qty: h.item_qty, item: item, item_uom: h.item_uom, completing: true });
  if (!chk.ok) return stop(chk.message);
  const bc = osBinCheck(chk.rows, (read && read.bins) || [], h.issuing_operation_faci);
  if (!bc.ok) return stop(bc.message);
  const gen = kind === "SYSTEM";
  return { route: "OK", message: "", kind: kind, split: "YES", output_split: bc.rows, groups: chk.groups, gen: gen ? "YES" : "NO",
    genGroups: gen ? chk.groups.map((g, i) => ({ index: i, label: g.label, item_id: osS(h.item_id), document_date: h.item_assembly_date || null,
      manufacturing_date: g.mfg || null, expired_date: g.exp || null })) : [],
    cacheKey: gen ? osS(uid) + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) : "" };
};

// code_node_OSfinal: a System split's generated numbers ([{index, batch_number}], or its JSON text) onto its groups and rows
const osFinal = function osFinal(chk, generated) {
  const c = chk || {};
  const base = { route: "OK", message: "", split: c.split === "YES" ? "YES" : "NO", kind: osS(c.kind), output_split: c.output_split || [], groups: c.groups || [] };
  if (base.split !== "YES" || c.gen !== "YES") return base;
  let list = generated;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch (e) {
      list = null;
    }
  }
  const nums = [];
  (Array.isArray(list) ? list : []).forEach((x) => {
    if (x && x.index !== undefined && x.index !== null) nums[Number(x.index)] = x.batch_number;
  });
  const as = osAssign(base.output_split, base.groups, base.groups.map((g, i) => nums[i]));
  if (!as.ok) return Object.assign({}, base, { route: "STOP", message: as.message });
  return Object.assign({}, base, { output_split: as.rows, groups: as.groups });
};

// code_node_OSreceipts: the Batch rows read back (exactly one per batch, this item's) -> one receipt per row with its batch id; STOP = 0/n
const osReceiptPlan = function osReceiptPlan(final, plan, read, header) {
  const f = final || {};
  const h = header || {};
  const rows = f.output_split || [];
  const groups = f.groups || [];
  const n = rows.length;
  const ids = {};
  if ((plan || {}).needBatch === "YES") {
    const got = (read && Array.isArray(read.rows) ? read.rows : []).filter((b) => b && osS(b.material_id) === osS(h.item_id));
    const count = {};
    got.forEach((b) => {
      const k = osS(b.batch_number).toLowerCase();
      count[k] = (count[k] || 0) + 1;
      ids[k] = osS(b.id);
    });
    const bad = groups.filter((g) => count[osS(g.batch_no).toLowerCase()] !== 1)[0];
    if (bad || got.length !== groups.length) {
      return { route: "STOP", message: "The output batches could not be created (" + (bad ? bad.label : "a batch") + "): no output was received. This Item Assembly needs review.",
        receipts: [], n: String(n), marker: "0/" + n };
    }
  }
  return { route: "OK", message: "", receipts: osReceipts(rows, groups, f.kind, ids, h), n: String(n), marker: "" };
};
if (typeof module !== "undefined") module.exports = { OS_MAX_ROWS, OS_EPS, OS_CATEGORIES, OS_BATCH_COLS, osS, osQ8, osKind, osParse, osNorm, osBaseFactor, osGroupKey, osGroups, osSum, osCheck, osHeader, osAssign, osReceipts, osBatchRows, osJ, osMerge, osBinCheck, osCompletion, osFinal, osReceiptPlan };
