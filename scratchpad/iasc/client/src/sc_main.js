// sc_main - Item Assembly form, the Small Cycle controller (scratchpad/iasc/CONTRACT.md section 9). Bound to no widget: the
// forwarders and the patched v36 handlers run it with this.triggerEvent("sc_main", { scOp, ... }). With SC_ENABLED false or
// a workflow id "0" it does nothing.
const SC_ENABLED = __SC_ENABLED__;
const SC_WF_PROJECTION = "__SO_IA_PROJECTION__"; // SO_IA_PROJECTION
const SC_WF_RELINK = "__IA_SC_RELINK__"; // IA_SC_RELINK
const SC_EPS = 0.0000001;
const SC_ECHO_MS = 3000;
const SC_ITEM_FIELDS = "material_name,material_desc,based_uom,serial_number_management,item_batch_management,batch_number_genaration,table_uom_conversion,table_default_bin,stock_control";
const SC_EDIT_WIDGETS = ["bom_consumption_mode", "planned_output_qty"];
const SC_BUTTONS = ["sc_btn_line", "sc_btn_unlink", "sc_btn_relink", "sc_btn_suggest", "sc_btn_bom", "sc_btn_refresh"];

// the resolver and the projection (code/shared, verbatim)
/*@@SC_BOM@@*/
/*@@SC_PROJ@@*/

// the v36 onChange_assembledItem helpers, verbatim: reads, non-stock links, plant defaults, batch fields, autoAllocate
/*@@IA_EXPLODE_HELPERS@@*/

const scArgs = arguments[0] || {};
const scOn = () => SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK);
const scDigits = (v) => /^[0-9]{1,20}$/.test(scS(v));
const scSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scState = () => this.models["_data"] || {};
const scStore = (patch) => {
  this.models["_data"] = Object.assign({}, this.models["_data"], patch);
};
const scModeOf = (v) => {
  const m = scS(v.bom_consumption_mode);
  return m === "STANDARD" || m === "FLAT" ? m : "";
};
const scEnhanced = (v) => scModeOf(v) !== "" && scS(v.bom_snapshot_json) !== "";
const scLinked = (v) => scDigits(v.source_so_line_id);
const scSnap = (v) => (scEnhanced(v) ? scSnapOf(v.bom_snapshot_json) : null);
const scOrg = (v) => scS(v.organization_id) || scS(getOrganizationId());
const scHtml = (t) => scS(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const scNumText = (v) => String(scQ8(v));
const scAlert = (message, title, type) => this.$alert(message, title || "", { confirmButtonText: "OK", type: type || "warning" }).catch(() => {});
const scAsk = (message, title, ok, cancel) =>
  this.$confirm(message, title, { confirmButtonText: ok, cancelButtonText: cancel, dangerouslyUseHTMLString: true, type: "warning" }).then(
    () => true,
    () => false,
  );
// a run of preparation; an older one still in flight never writes over a newer one
const scBegin = () => {
  const n = (Number(scState().sc_seq) || 0) + 1;
  scStore({ sc_seq: n });
  return n;
};
const scCurrent = (n) => Number(scState().sc_seq) === n;
// our own writes of item_qty come back through onChange_itemQty: that echo is ignored once
const scQtyEcho = (qty) => scStore({ sc_qty_echo: { qty: scQ8(qty), until: Date.now() + SC_ECHO_MS } });
const scIsQtyEcho = (qty) => {
  const e = scState().sc_qty_echo;
  if (!e || Date.now() > Number(e.until) || Math.abs(scQ8(e.qty) - scQ8(qty)) > SC_EPS) return false;
  scStore({ sc_qty_echo: null });
  return true;
};
const scSetMode = async (mode) => {
  scStore({ sc_mode: mode });
  await this.setData({ bom_consumption_mode: mode });
};
const scSetQty = async (qty) => {
  scQtyEcho(qty);
  await this.setData({ item_qty: qty });
};

const scRun = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });
// SO_IA_PROJECTION: its result_json, or null (a failed call is never shown as zero)
const scProjection = async (params) => {
  try {
    const res = await scRun(SC_WF_PROJECTION, params);
    const d = (res && res.data) || {};
    if (scS(d.code) !== "200") return null;
    const r = scParseJ(d.result_json);
    return r && typeof r === "object" ? r : null;
  } catch (e) {
    console.error("Small Cycle: the Sales Order figures could not be read", e);
    return null;
  }
};
// an Add / Clone (unsaved) or an Edit of a Draft (excluded from the totals): its own quantity is proposed once
const scEditable = (v) => {
  const page = scS(v.page_status);
  return page === "Add" || page === "Clone" || (page === "Edit" && scS(v.item_assembly_status) === "Draft");
};
const scSummary = (v) => {
  const editDraft = scS(v.page_status) === "Edit" && scS(v.item_assembly_status) === "Draft" && scDigits(v.id);
  const propose = scEditable(v) && scQ8(v.item_qty) > 0;
  return scProjection({ operation: "SUMMARY", so_id: scS(v.source_so_id), so_line_id: scS(v.source_so_line_id), item_id: scS(v.item_id),
    exclude_ia_id: editDraft ? scS(v.id) : "", organization_id: scOrg(v), proposal_qty: propose ? scQ8(v.item_qty).toFixed(8) : "",
    proposal_uom_id: propose ? scS(v.item_uom) : "", baseline: scS(v.source_so_context_json) });
};

// fail-closed reads (a failed read throws; a clamped answer is read again in halves)
const scReadIds = async (collection, ids, fields) => {
  const rows = [];
  await Promise.all(
    iaChunks(iaUniq(ids), IA_READ_CHUNK).map(async (chunk) => {
      let query = db.collection(collection);
      if (fields) query = query.field(fields);
      const res = await query
        .filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: chunk }, { prop: "is_deleted", operator: "equal", value: 0 }] }])
        .limit(chunk.length)
        .get();
      if (!res || !Array.isArray(res.data)) throw new Error(collection + " could not be read");
      rows.push(...res.data);
    }),
  );
  return rows;
};
const scReadMany = async (collection, prop, values, conditions) => {
  const rows = [];
  const read = async (chunk) => {
    const res = await db
      .collection(collection)
      .filter([{ type: "branch", operator: "all", children: [{ prop: prop, operator: "in", value: chunk }].concat(conditions) }])
      .limit(IA_READ_MAX)
      .get();
    if (!res || !Array.isArray(res.data)) throw new Error(collection + " could not be read");
    if (res.data.length >= IA_READ_MAX && chunk.length > 1) {
      const half = Math.ceil(chunk.length / 2);
      await Promise.all([read(chunk.slice(0, half)), read(chunk.slice(half))]);
      return;
    }
    if (res.data.length >= IA_READ_MAX) throw new Error(collection + ": more than " + IA_READ_MAX + " rows for one id");
    rows.push(...res.data);
  };
  await Promise.all(iaChunks(iaUniq(values), IA_READ_CHUNK).map(read));
  return rows;
};
// the resolver's reads, kept for the rest of this run (items, BOMs by parent item)
const scIo = (org) => {
  const items = {};
  const boms = {};
  return {
    items: items,
    boms: boms,
    readItems: async (ids) => {
      const want = iaUniq(ids).filter((id) => !Object.prototype.hasOwnProperty.call(items, id));
      if (want.length) (await scReadIds("item", want, SC_ITEM_FIELDS)).forEach((it) => (items[scS(it.id)] = it));
      return iaUniq(ids).filter((id) => items[id]).map((id) => items[id]);
    },
    readBoms: async (ids) => {
      const want = iaUniq(ids).filter((id) => !Object.prototype.hasOwnProperty.call(boms, id));
      if (want.length) {
        const got = await scReadMany("bill_of_materials", "parent_material_code", want, [
          { prop: "organization_id", operator: "equal", value: org },
          { prop: "is_deleted", operator: "equal", value: 0 },
          { prop: "is_active", operator: "equal", value: 1 },
        ]);
        want.forEach((id) => (boms[id] = []));
        got.forEach((b) => {
          const p = scS(b.parent_material_code);
          if (boms[p]) boms[p].push(b);
        });
      }
      return [].concat(...iaUniq(ids).map((id) => boms[id] || []));
    },
  };
};
const scUomMap = async (rows, items) => {
  const ids = iaUniq(rows.flatMap((r) => {
    const it = items[scS(r.item_selection)];
    return [r.quantity_uom, it && it.based_uom].concat(scConvs(it).map((c) => c.alt_uom_id));
  }));
  const res = ids.length ? await fetchByIds("unit_of_measurement", ids) : { data: [] };
  return new Map((res.data || []).map((u) => [u.id, u]));
};
const scUomOptions = (row, item, uomMap) =>
  JSON.stringify([row.quantity_uom, item && item.based_uom].concat(scConvs(item).map((c) => c.alt_uom_id))
    .filter(Boolean).filter((id, i, arr) => arr.indexOf(id) === i).map((id) => uomMap.get(id)).filter(Boolean));
// table lines in the v36 explode's shape (+ sc_ref_key) from resolver / snapshot rows
const scLines = (rows, items, uomMap, v, org, plantId, keyed) =>
  rows.map((r, index) => {
    const item = items[scS(r.item_selection)];
    return {
      item_selection: r.item_selection, item_name: r.item_name, item_desc: r.item_desc, requested_qty: r.requested_qty,
      total_quantity: Number(r.nonStock) === 1 ? r.requested_qty : 0, quantity_uom: r.quantity_uom, uom_options: scUomOptions(r, item, uomMap),
      item_remark: r.item_remark || "", project_id: v.project_id || "", organization_id: org, issuing_plant: plantId, line_index: index + 1, balance_id: "",
      temp_qty_data: "", temp_hu_data: "", stock_summary: "", sc_ref_key: keyed ? r.key : "",
    };
  });
// writes the lines as the v36 explode does: the table, the UOM options, the non-stock links, then today's auto-allocation
const scWriteLines = async (lines, items, uomMap, plantId, org, header) => {
  // with the header (snapshot, root BOM, item fields) in the same write: never a snapshot without its lines
  await this.setData(Object.assign({}, header || {}, { stock_movement: lines }));
  lines.forEach((row, rowIndex) => {
    let options = [];
    try {
      options = JSON.parse(row.uom_options);
    } catch (e) {}
    this.setOptionData([`stock_movement.${rowIndex}.quantity_uom`], options);
  });
  iaNsRemember(lines.filter((row) => iaIsNonStock(items[scS(row.item_selection)])).map((row) => row.item_selection));
  iaNsLinks(lines.map((row, rowIndex) => [rowIndex, row.item_selection]));
  if (!plantId) {
    this.$message.warning("Select a Plant to auto-allocate stock for these components.");
    return;
  }
  const itemMap = new Map(Object.keys(items).map((id) => [id, items[id]]));
  await autoAllocate(lines, itemMap, uomMap, plantId, org);
};
// snapshot rows at an output quantity, as resolver rows
const scSnapRows = (snap, qty) => {
  const ref = {};
  scRecompute(snap, qty).forEach((x) => (ref[x.key] = x.qty));
  return snap.rows.map((r) => ({ key: scS(r.key), item_selection: scS(r.itemId), item_name: scS(r.name), item_desc: scS(r.desc), requested_qty: ref[scS(r.key)] || 0,
    quantity_uom: scS(r.uomId), item_remark: scS(r.remark), nonStock: Number(r.nonStock) === 1 ? 1 : 0, serial: Number(r.serial) === 1 ? 1 : 0 }));
};

// --- the Sales Order Link section (sc_section): one read-only row per fact in sc_info; a row without a fact is hidden ---
const SC_PANEL = ["sc_info_so", "sc_info_customer", "sc_info_ordered", "sc_info_delivered", "sc_info_produced", "sc_info_open", "sc_info_suggest", "sc_info_cover",
  "sc_info_bom", "sc_info_over", "sc_info_warn"];
const scUomNames = async (ids) => {
  const want = iaUniq(ids);
  const res = want.length ? await fetchByIds("unit_of_measurement", want, "uom_name") : { data: [] };
  const names = {};
  (res.data || []).forEach((u) => (names[scS(u.id)] = scS(u.uom_name)));
  return names;
};
const scActive = (sum) => {
  const h = (sum && sum.header) || null;
  const l = (sum && sum.line) || null;
  const hs = scS(h && h.so_status);
  const ls = scS(l && l.line_status);
  return !!h && !!l && Number(h.is_deleted) !== 1 && Number(l.is_deleted) !== 1 && (hs === "Issued" || hs === "Processing") && ls !== "Completed" && ls !== "Cancelled";
};
// the facts kept between ops (small: never the BOM or the IA list)
const scKeep = (sum, factor) => {
  if (!sum) return scStore({ sc_sum: null });
  const t = sum.totals || {};
  const h = sum.header || {};
  const l = sum.line || {};
  scStore({ sc_sum: { soNo: scS(h.so_no), soId: scS(h.id), customer: scS(h.customer_name), lineIndex: scS(l.line_index), lineId: scS(l.id), uomId: scS(sum.uomId),
    ordered: t.ordered, delivered: t.delivered, undelivered: t.undelivered, produced: t.produced, openOthers: t.openOthers, planned: t.planned,
    suggestion: t.suggestion === undefined ? null : t.suggestion, complete: t.complete !== false, active: scActive(sum), factor: factor,
    warnings: (sum.warnings || []).map((w) => ({ code: scS(w.code), text: scS(w.text) })),
    relink: (sum.candidates || []).map((c) => ({ id: scS(c.id), lineIndex: scS(c.line_index), ordered: c.so_quantity, delivered: c.delivered_qty, uomId: scS(c.so_item_uom) })) } });
};
// this IA's quantity -> the line UOM factor (null when the FG cannot convert)
const scFactor = async (v, lineUom) => {
  if (!scS(lineUom) || scS(lineUom) === scS(v.item_uom)) return 1;
  try {
    const fg = (await scReadIds("item", [v.item_id], SC_ITEM_FIELDS))[0];
    const a = spToBase(fg, v.item_uom);
    const b = spToBase(fg, lineUom);
    return a === null || b === null ? null : a / b;
  } catch (e) {
    return null;
  }
};
const scRender = async (v) => {
  const sum = scState().sc_sum || null;
  // the warnings name units by id: the line's, the baseline's (a unit change) and any other IA's (a long id in the text)
  const ids = ((sum && sum.warnings) || []).reduce((all, w) => all.concat(scS(w.text).match(/\b[0-9]{15,20}\b/g) || []), [v.item_uom, sum && sum.uomId]);
  const names = await scUomNames(ids.concat([(scParseJ(v.source_so_context_json) || {}).uomId]));
  const swap = (text) => Object.keys(names).reduce((t, id) => (names[id] ? t.split(id).join(names[id]) : t), scS(text));
  const lineQty = (n) => scNumText(n) + (names[scS(sum.uomId)] ? " " + names[scS(sum.uomId)] : "");
  const editable = scEditable(v);
  const row = {};
  if (!scLinked(v)) row.sc_info_so = "not linked";
  else if (!sum) row.sc_info_so = "figures unavailable right now: press Refresh Figures to try again";
  else {
    row.sc_info_so = (sum.soNo || "?") + (sum.lineIndex ? " · line " + sum.lineIndex : "");
    row.sc_info_customer = sum.customer;
    row.sc_info_ordered = lineQty(sum.ordered);
    row.sc_info_delivered = lineQty(sum.delivered);
    row.sc_info_produced = lineQty(sum.produced);
    // read-only: this IA is inside the totals already, so nothing of its own is added
    row.sc_info_open = lineQty(sum.openOthers) + " in " + (editable ? "other " : "") + "open IAs";
    if (editable) {
      if (sum.suggestion === null || !sum.complete) row.sc_info_suggest = "unavailable: a unit conversion is missing";
      else if (!sum.active) row.sc_info_suggest = lineQty(0) + ": the line has no remaining demand";
      else {
        // the suggestion takes off the larger of delivered and produced
        const done = scNum(sum.delivered) > scNum(sum.produced) ? scNumText(sum.delivered) + " delivered" : scNumText(sum.produced) + " produced";
        row.sc_info_suggest = lineQty(sum.suggestion) + " = " + scNumText(sum.ordered) + " ordered \u2212 " + done + " \u2212 " + scNumText(sum.openOthers) + " in progress";
      }
      if (sum.active && sum.complete && sum.factor !== null && sum.factor !== undefined) {
        const covered = scQ8(Math.max(scNum(sum.delivered), scNum(sum.produced)) + scNum(sum.openOthers) + scQ8(v.item_qty) * scNum(sum.factor));
        const left = scQ8(scNum(sum.ordered) - covered);
        if (left > 0) row.sc_info_cover = lineQty(left) + " still needed";
        else if (left === 0) row.sc_info_cover = "fully covered";
        else row.sc_info_over = "\u26a0 This Item Assembly makes " + lineQty(-left) + " more than ordered. You can still save.";
      }
    }
  }
  const snap = scSnap(v);
  if (snap) {
    const n = (snap.expand || []).length;
    row.sc_info_bom = [snap.mode === "FLAT" ? "Flat" : "Standard", scS(snap.root.version), snap.mode === "FLAT" ? n + (n === 1 ? " sub-assembly" : " sub-assemblies") + " expanded" : "",
      scS(snap.preparedAt) ? "prepared " + scS(snap.preparedAt).slice(0, 10) : ""].filter((x) => x).join(" · ");
  } else if (scLinked(v) || scModeOf(v) === "FLAT") row.sc_info_bom = "not prepared yet" + (editable ? ": press Prepare BOM" : "");
  // over the order is its own message, kept live there
  const warnings = ((sum && sum.warnings) || []).filter((w) => w.code !== "EXCESS");
  if (warnings.length) row.sc_info_warn = warnings.map((w) => "\u26a0 " + swap(w.text)).join("   ");
  const data = {};
  SC_PANEL.forEach((m) => (data[m] = row[m] || ""));
  await this.setData(data);
  const on = SC_PANEL.filter((m) => row[m]);
  const off = SC_PANEL.filter((m) => !row[m]);
  if (on.length) this.display(on);
  if (off.length) this.hide(off);
};
// the panel from the facts kept by the last SUMMARY; a linked IA whose figures were never read here reads them first
const scRenderOrRead = async (v) => (scLinked(v) && scState().sc_sum === undefined ? scRefresh(v) : scRender(v));
const scRefresh = async (v) => {
  if (!scLinked(v)) {
    scKeep(null);
    return scRender(v);
  }
  const sum = await scSummary(v);
  scKeep(sum, sum ? await scFactor(v, sum.uomId) : null);
  await scRender(v);
  return sum;
};

// --- which Small Cycle widgets this page shows ---
const scDisplay = (v, page, status) => {
  const editable = page === "Add" || page === "Clone" || (page === "Edit" && status === "Draft");
  const linked = scLinked(v);
  const smallCycle = linked || scModeOf(v) === "FLAT" || scEnhanced(v);
  const show = [];
  const hide = [];
  const put = (on, list) => list.forEach((m) => (on ? show : hide).push(m));
  if (editable) {
    put(true, ["sc_section", "bom_consumption_mode", "sc_actions", "sc_btn_line"]);
    put(smallCycle, ["planned_output_qty", "sc_info", "sc_btn_bom"]);
    put(linked, ["sc_btn_unlink", "sc_btn_suggest", "sc_btn_refresh"]);
    put(false, ["sc_btn_relink"]);
  } else {
    const sum = scState().sc_sum;
    const orphan = !!sum && (sum.warnings || []).some((w) => w.code === "LINE_REMOVED") && (sum.relink || []).length > 0;
    put(smallCycle, ["sc_section", "bom_consumption_mode", "planned_output_qty", "sc_info", "sc_actions"]);
    put(linked && smallCycle, ["sc_btn_refresh"]);
    put(linked && orphan && (status === "Completed" || status === "Fully Posted"), ["sc_btn_relink"]);
    put(false, ["sc_btn_line", "sc_btn_unlink", "sc_btn_suggest", "sc_btn_bom"]);
  }
  if (show.length) this.display(show);
  if (hide.length) this.hide(hide);
  this.disabled(SC_EDIT_WIDGETS, !editable);
};
const scRedisplay = (v) => scDisplay(v, scS(scState().sc_page) || scS(v.page_status), scS(scState().sc_status) || scS(v.item_assembly_status));

// --- preparation ---
// req: { mode, itemId, newItem, expand (null = ask in the dialog), saved (ticks to pre-set), prev ({ item_id, bom_consumption_mode }),
//        legacyAfter (STANDARD without a link: today's lines, no snapshot kept), diffFrom (the old snapshot: confirm the differences) }
const scRestore = async (req) => {
  const p = req.prev || {};
  if (p.source_so_line_id) {
    // the link dropped for this change comes back with the earlier item
    scStore({ sc_sum: undefined });
    await this.setData({ source_so_id: p.source_so_id, source_so_line_id: p.source_so_line_id });
  }
  if (p.bom_consumption_mode !== undefined) await scSetMode(p.bom_consumption_mode);
  if (p.item_id !== undefined && p.item_id !== "") {
    scStore({ sc_item: p.item_id });
    await this.setData({ item_id: p.item_id });
  } else if (req.newItem) {
    // no earlier item to put back: no line may stay under an item it was not prepared for
    await this.setData({ stock_movement: [], bom_snapshot_json: "", source_bom_id: "" });
  }
};
const scFailed = async (req, message) => {
  this.hideLoading();
  await scAlert(scHtml(message) + " Nothing else was changed.", "BOM Not Prepared", "error");
  await scRestore(req);
};
const scDiff = (oldSnap, snap, qty) => {
  const before = {};
  scRecompute(oldSnap, qty).forEach((x) => (before[x.key] = x));
  const name = {};
  oldSnap.rows.concat(snap.rows).forEach((r) => (name[scS(r.key)] = scS(r.name) || scS(r.itemId)));
  const out = [];
  const after = {};
  scRecompute(snap, qty).forEach((x) => {
    after[x.key] = x;
    if (!before[x.key]) out.push("Added: " + name[x.key] + " (" + x.qty + ")");
    else if (Math.abs(before[x.key].qty - x.qty) > 0.0005) out.push("Changed: " + name[x.key] + " " + before[x.key].qty + " → " + x.qty);
  });
  Object.keys(before).forEach((k) => {
    if (!after[k]) out.push("Removed: " + name[k]);
  });
  if (oldSnap.mode !== snap.mode || scS(oldSnap.root.version) !== scS(snap.root.version)) out.unshift("BOM: " + scS(oldSnap.root.version) + " → " + scS(snap.root.version));
  return out;
};
const scPrepare = async (req) => {
  const seq = scBegin();
  const v = this.getValues();
  const org = scOrg(v);
  const plantId = scS(v.issuing_operation_faci);
  this.showLoading("Preparing the BOM...");
  let r;
  let io;
  let fg;
  try {
    io = scIo(org);
    fg = (await io.readItems([req.itemId]))[0];
    if (!fg) return scFailed(req, "The item could not be read.");
    const input = { mode: req.mode, itemId: scS(req.itemId), itemUomId: req.newItem ? scS(fg.based_uom) : scS(v.item_uom) || scS(fg.based_uom),
      outputQty: scQ8(v.item_qty), expand: req.expand || [], fg: fg, preparedAt: new Date().toISOString(), preparedBy: scS(this.getVarGlobal("nickname")) };
    r = await scResolve(input, io);
    if (!r.ok) return scFailed(req, r.message);
    if (!scCurrent(seq)) return this.hideLoading();
    if (req.mode === "FLAT" && req.expand === null) {
      const seen = {};
      const saved = {};
      (req.saved || []).forEach((id) => (saved[scS(id)] = 1));
      const rows = [];
      r.tree.forEach((t) => {
        if (!t.expandable || seen[t.itemId]) return;
        seen[t.itemId] = 1;
        rows.push({ component: "— ".repeat(Math.max(0, t.depth - 1)) + t.name, level: t.depth, bom: scS(t.version),
          under: scS(io.items[t.parentItemId] && io.items[t.parentItemId].material_name) || scS(t.parentItemId), item_id: t.itemId, expand: saved[t.itemId] ? 1 : 0 });
      });
      this.hideLoading();
      if (rows.length) {
        scStore({ sc_pending: { mode: "FLAT", itemId: scS(req.itemId), newItem: !!req.newItem, prev: req.prev || null, diff: !!req.diffFrom } });
        await this.setData({ "sc_expand_dialog.sc_expand_table": rows });
        await this.openDialog("sc_expand_dialog");
        return;
      }
      this.$message.info("No component of this BOM has a BOM of its own, so Flat lists the same components as Standard.");
    }
  } catch (e) {
    console.error("Small Cycle: preparation failed", e);
    return scFailed(req, "The BOM could not be prepared (" + scS(e && e.message) + ").");
  }
  try {
    const oldSnap = req.diffFrom ? scSnapOf(req.diffFrom) : null;
    if (oldSnap) {
      const diff = scDiff(oldSnap, r.snapshot, v.item_qty);
      this.hideLoading();
      if (!diff.length) {
        this.$message.info("The BOM has not changed since it was prepared.");
        return;
      }
      const ok = await scAsk("Preparing the BOM again changes the components:<br><br>" + diff.map((d) => "• " + scHtml(d)).join("<br>")
        + "<br><br>The component lines and their picks are rebuilt.", "BOM Changed", "Rebuild", "Keep");
      if (!ok) return scRestore(req);
      this.showLoading("Preparing the BOM...");
    }
    const uomMap = await scUomMap(r.rows, io.items);
    if (!scCurrent(seq)) return this.hideLoading();
    const lines = scLines(r.rows, io.items, uomMap, v, org, plantId, !req.legacyAfter);
    const header = req.legacyAfter ? { bom_snapshot_json: "", source_bom_id: "" } : { bom_snapshot_json: JSON.stringify(r.snapshot), source_bom_id: scS(r.snapshot.root.bomId) };
    if (req.newItem) {
      Object.assign(header, { item_name: scS(fg.material_name), item_desc: scS(fg.material_desc), item_uom: scS(fg.based_uom) });
      const own = getItemDefaultBin(fg.table_default_bin, plantId);
      const plant = own ? { storageLocation: null, binLocation: null } : await fetchPlantDefaults(plantId);
      Object.assign(header, { storage_location_id: (own && own.storageLocation) || plant.storageLocation || "", location_id: (own && own.binLocation) || plant.binLocation || "" });
    }
    scStore({ sc_item: scS(req.itemId) });
    if (scS(v.bom_consumption_mode) !== req.mode) await scSetMode(req.mode);
    this.hideLoading();
    await scWriteLines(lines, io.items, uomMap, plantId, org, header);
    if (req.newItem) applyBatchFields(fg);
    if (!req.legacyAfter) await scCapNotice(r.rows);
  } catch (e) {
    this.hideLoading();
    console.error("Small Cycle: writing the prepared lines failed", e);
    this.$message.error("The prepared lines could not be written (" + scS(e && e.message) + "): prepare the BOM again.");
  }
  const after = this.getValues();
  scRedisplay(after);
  await scRenderOrRead(after);
};
// an IA with serial-numbered components completes through the classic save, which takes at most 250 picks (IA V2 refuses serial
// items): told at preparation, the picks made so far plus one per serial line being a lower bound
const SC_CLASSIC_MAX_PICKS = 250;
const scCapNotice = async (rows) => {
  const serials = (rows || []).filter((r) => Number(r.serial) === 1).length;
  if (!serials) return;
  const picks = (this.getValues().stock_movement || []).reduce((n, l) => n + [].concat(scParseJ(l.temp_qty_data) || []).filter((p) => scNum(p && p.sm_quantity) > 0).length, 0);
  if (picks + serials <= SC_CLASSIC_MAX_PICKS) return;
  await scAlert("This Item Assembly has serial-numbered components, so it can only be completed through the classic save, which takes at most "
    + SC_CLASSIC_MAX_PICKS + " picks. It already has at least " + (picks + serials) + ": split it into smaller Item Assemblies.", "Too Big to Complete", "warning");
};
// an IA that already has lines is linked without touching them: keys by item + UOM occurrence, references at item_qty
const scStamp = async (v) => {
  const org = scOrg(v);
  const io = scIo(org);
  const fg = (await io.readItems([v.item_id]))[0];
  if (!fg) throw new Error("the item could not be read");
  const r = await scResolve({ mode: "STANDARD", itemId: scS(v.item_id), itemUomId: scS(v.item_uom) || scS(fg.based_uom), outputQty: scQ8(v.item_qty), expand: [], fg: fg,
    preparedAt: new Date().toISOString(), preparedBy: scS(this.getVarGlobal("nickname")) }, io);
  if (!r.ok) return r;
  const ref = {};
  r.rows.forEach((x) => (ref[x.key] = x));
  const counts = {};
  const updates = { bom_snapshot_json: JSON.stringify(r.snapshot), source_bom_id: scS(r.snapshot.root.bomId) };
  (v.stock_movement || []).forEach((l, i) => {
    const base = scS(l.item_selection) + "|" + scS(l.quantity_uom);
    counts[base] = (counts[base] || 0) + 1;
    const x = ref[base + "|" + counts[base]];
    updates[`stock_movement.${i}.sc_ref_key`] = x ? x.key : "";
    if (x) updates[`stock_movement.${i}.requested_qty`] = x.requested_qty;
  });
  await this.setData(updates);
  return r;
};

// --- today's auto-allocation for some lines only (QTY): their own old picks are released and every OTHER line's staged
// loose picks of the same material are deducted first (the rule onChange_componentQty applies to one line) ---
const scAllocate = async (targets, lines, plantId, organizationId) => {
  const ids = iaUniq(targets.map((t) => lines[t.index].item_selection));
  const [itemsRes, looseRes, batchRes, huSubRes, reservationRes] = await Promise.all([
    fetchByIds("item", ids, "material_name,serial_number_management,item_batch_management,table_default_bin,stock_control"),
    fetchBalances("item_balance", ids, plantId, organizationId),
    fetchBalances("item_batch_balance", ids, plantId, organizationId),
    iaReadMany("handling_unit_atu7sreg_sub", "material_id", ids, [{ prop: "is_deleted", operator: "equal", value: 0 }]),
    iaReadMany("on_reserved_gd", "material_id", ids, [
      { prop: "plant_id", operator: "equal", value: plantId },
      { prop: "organization_id", operator: "equal", value: organizationId },
      { prop: "is_deleted", operator: "equal", value: 0 },
    ]),
  ]);
  const itemMap = new Map((itemsRes.data || []).map((item) => [String(item.id), item]));
  const huReservedMap = new Map();
  (reservationRes.data || [])
    .filter((r) => parseFloat(r.open_qty || 0) > 0 && r.status === "Allocated" && r.handling_unit_id)
    .forEach((r) => {
      const key = `${r.handling_unit_id}|${r.batch_id || ""}`;
      huReservedMap.set(key, (huReservedMap.get(key) || 0) + parseFloat(r.open_qty || 0));
    });
  const huIds = iaUniq((huSubRes.data || []).map((sub) => sub.handling_unit_id));
  const huRes = huIds.length ? await fetchByIds("handling_unit", huIds) : { data: [] };
  const held = new Map();
  (huRes.data || []).forEach((hu) => {
    (hu.table_hu_items || []).filter((x) => x.is_deleted !== 1).forEach((x) => {
      const qty = Math.max(0, (parseFloat(x.quantity) || 0) - (huReservedMap.get(`${hu.id}|${x.batch_id || ""}`) || 0));
      if (qty <= 0) return;
      const key = `${x.material_id}|${x.location_id || hu.location_id}|${x.batch_id || "no_batch"}`;
      held.set(key, (held.get(key) || 0) + qty);
    });
  });
  const mine = {};
  targets.forEach((t) => (mine[t.index] = 1));
  const staged = new Map();
  lines.forEach((line, idx) => {
    if (mine[idx]) return;
    let picks = [];
    try {
      picks = JSON.parse(line.temp_qty_data || "[]");
    } catch (e) {}
    (Array.isArray(picks) ? picks : []).filter((p) => p && !p.handling_unit_id).forEach((p) => {
      const key = `${p.material_id}|${p.location_id}|${p.batch_id || "no_batch"}`;
      staged.set(key, (staged.get(key) || 0) + (parseFloat(p.sm_quantity) || 0));
    });
  });
  const byMaterial = new Map();
  [...(looseRes.data || []), ...(batchRes.data || [])].forEach((balance) => {
    const item = itemMap.get(String(balance.material_id));
    const batched = item && item.item_batch_management === 1;
    if (batched !== !!balance.batch_id && !(batched && balance.batch_id)) {
      if (batched || balance.batch_id) return;
    }
    const key = `${balance.material_id}|${balance.location_id}|${balance.batch_id || "no_batch"}`;
    const available = Math.max(0, (parseFloat(balance.unrestricted_qty) || 0) - (held.get(key) || 0) - (staged.get(key) || 0));
    if (available <= 0) return;
    const list = byMaterial.get(String(balance.material_id)) || [];
    list.push({ balance, available });
    byMaterial.set(String(balance.material_id), list);
  });
  byMaterial.forEach((list, materialId) => {
    const item = itemMap.get(materialId);
    const own = getItemDefaultBin(item && item.table_default_bin, plantId);
    const preferred = own ? own.binLocation : null;
    list.sort((a, b) => {
      const byBin = (b.balance.location_id === preferred ? 1 : 0) - (a.balance.location_id === preferred ? 1 : 0);
      return byBin !== 0 ? byBin : String(a.balance.create_time || "").localeCompare(String(b.balance.create_time || ""));
    });
  });
  const updates = {};
  const shortfalls = [];
  const picked = [];
  targets.forEach((t) => {
    const row = lines[t.index];
    const item = itemMap.get(String(row.item_selection));
    if (!item || item.serial_number_management === 1 || iaIsNonStock(item)) return;
    let remaining = scQ8(t.qty);
    const picks = [];
    for (const c of byMaterial.get(String(row.item_selection)) || []) {
      if (remaining <= 0) break;
      if (c.available <= 0) continue;
      const take = scQ8(Math.min(c.available, remaining));
      if (take <= 0) continue;
      c.available = scQ8(c.available - take);
      remaining = scQ8(remaining - take);
      const b = c.balance;
      picks.push({ material_id: b.material_id, location_id: b.location_id, storage_location_id: b.storage_location_id || null, batch_id: b.batch_id || null, balance_id: b.id,
        sm_quantity: take, category: "Unrestricted", plant_id: plantId, organization_id: organizationId, is_deleted: 0, expired_date: b.expired_date || null,
        manufacturing_date: b.manufacturing_date || null, unrestricted_qty: parseFloat(b.unrestricted_qty) || 0, balance_quantity: parseFloat(b.balance_quantity) || 0 });
    }
    const total = scQ8(picks.reduce((sum, p) => sum + p.sm_quantity, 0));
    updates[`stock_movement.${t.index}.total_quantity`] = total;
    updates[`stock_movement.${t.index}.temp_qty_data`] = picks.length ? JSON.stringify(picks) : "";
    updates[`stock_movement.${t.index}.temp_hu_data`] = "";
    picked.push({ index: t.index, picks: picks, total: total, row: row });
    if (remaining > 0) shortfalls.push(`${row.item_name || row.item_selection} (${remaining})`);
  });
  const all = picked.flatMap((p) => p.picks);
  const [binRes, batchRes2, uomRes] = await Promise.all([
    all.length ? fetchByIds("bin_location", iaUniq(all.map((p) => p.location_id)), "bin_location_combine") : Promise.resolve({ data: [] }),
    all.some((p) => p.batch_id) ? fetchByIds("batch", iaUniq(all.map((p) => p.batch_id)), "batch_number") : Promise.resolve({ data: [] }),
    picked.length ? fetchByIds("unit_of_measurement", iaUniq(picked.map((p) => p.row.quantity_uom)), "uom_name") : Promise.resolve({ data: [] }),
  ]);
  const binMap = new Map((binRes.data || []).map((x) => [x.id, x.bin_location_combine]));
  const batchMap = new Map((batchRes2.data || []).map((x) => [x.id, x.batch_number]));
  const uomMap = new Map((uomRes.data || []).map((x) => [x.id, x.uom_name]));
  picked.forEach(({ index, picks, total, row }) => {
    if (!picks.length) {
      updates[`stock_movement.${index}.stock_summary`] = "";
      return;
    }
    const uomName = uomMap.get(row.quantity_uom) || "";
    const details = picks.map((p, i) => {
      let line = `${i + 1}. ${binMap.get(p.location_id) || p.location_id}: ${p.sm_quantity} ${uomName} (UNR)`;
      if (p.batch_id) line += `\n[${batchMap.get(p.batch_id) || p.batch_id}]`;
      return line;
    }).join("\n");
    updates[`stock_movement.${index}.stock_summary`] = `Total: ${total} ${uomName}\n\nDETAILS:\n${details}`;
  });
  if (Object.keys(updates).length) await this.setData(updates);
  if (shortfalls.length) {
    this.$message.warning(`Not enough loose stock for: ${shortfalls.join(", ")}. Open Transfer Stock on those lines to pick from handling units.`);
  }
};

// --- the ops ---
const scOpQty = async () => {
  const v = this.getValues();
  if (!scArgs.scSelf && scIsQtyEcho(v.item_qty)) return;
  const snap = scSnap(v);
  if (!snap) {
    if (scS(v.item_id) && (scLinked(v) || scModeOf(v) === "FLAT")) await scPrepare({ mode: scModeOf(v) || "STANDARD", itemId: v.item_id, newItem: false, expand: scModeOf(v) === "FLAT" ? null : [], prev: null });
    return;
  }
  const ref = {};
  scRecompute(snap, v.item_qty).forEach((x) => (ref[x.key] = x));
  const rowOf = {};
  snap.rows.forEach((r) => (rowOf[scS(r.key)] = r));
  const lines = v.stock_movement || [];
  const updates = {};
  const realloc = [];
  const kept = [];
  const serials = [];
  lines.forEach((l, i) => {
    const x = ref[scS(l.sc_ref_key)];
    if (!x || x.itemId !== scS(l.item_selection) || x.uomId !== scS(l.quantity_uom)) return;
    const old = scNum(l.requested_qty);
    if (Math.abs(old - x.qty) <= SC_EPS) return;
    updates[`stock_movement.${i}.requested_qty`] = x.qty;
    const name = scS(l.item_name) || scS(l.item_selection);
    const r = rowOf[x.key];
    // serial numbers are picked one by one in Transfer Stock: never re-allocated here
    if (Number(r.serial) === 1) return serials.push(name);
    const untouched = Math.abs(scNum(l.total_quantity) - old) <= SC_EPS && !scS(l.temp_hu_data);
    if (!untouched) return kept.push(name);
    if (Number(r.nonStock) === 1) {
      updates[`stock_movement.${i}.total_quantity`] = x.qty;
      return;
    }
    realloc.push({ index: i, qty: x.qty });
  });
  if (!Object.keys(updates).length) return scRenderOrRead(v);
  // the references first: an echo of this change arriving while the question is open then finds nothing to do
  await this.setData(updates);
  let again = realloc.length > 0;
  if (realloc.some((t) => scS(lines[t.index].temp_qty_data))) {
    again = await scAsk("The quantity changed, so the reference quantities were recalculated from the prepared BOM. Please choose one for the " + realloc.length
      + " line(s) still at their old reference:<br><br><strong>Re-allocate:</strong> pick them again for the new reference.<br><strong>Keep picks:</strong> leave their picks as they are.",
      "Quantity Changed", "Re-allocate", "Keep picks");
  }
  const plantId = scS(v.issuing_operation_faci);
  if (again && plantId) await scAllocate(realloc, lines, plantId, scOrg(v));
  const notes = [];
  if (kept.length) notes.push("These lines keep the quantities you entered: " + kept.join(", ") + ".");
  if (serials.length) notes.push("Pick the serial numbers again for: " + serials.join(", ") + ".");
  if (notes.length) this.$message.info(notes.join(" "));
  await scRenderOrRead(this.getValues());
};
const scOpItem = async () => {
  const v = this.getValues();
  const value = scS(scArgs.value);
  const snap = scSnap(v);
  const prevItem = scS(scState().sc_item) || (snap ? scS(snap.itemId) : "") || scS((scParseJ(v.source_so_context_json) || {}).itemId);
  // our own write coming back (a Keep Item restore, the entry's data) or the same item again: nothing changed
  if (value && value === prevItem) return;
  // nothing known to compare with: never ask to drop a link for it (the save refuses an item changed under a link)
  if (!prevItem && scLinked(v)) return;
  const link = { source_so_id: scS(v.source_so_id), source_so_line_id: scS(v.source_so_line_id) };
  if (scLinked(v)) {
    const ok = await scAsk("Changing the item removes the link to Sales Order " + scHtml((scState().sc_sum || {}).soNo || "") + " line "
      + scHtml((scState().sc_sum || {}).lineIndex || "") + ". Continue?", "Item Changed", "Change Item", "Keep Item");
    if (!ok) {
      if (prevItem) {
        scStore({ sc_item: prevItem });
        await this.setData({ item_id: prevItem });
      }
      return;
    }
    // the context stays: the save adds the UNLINK to its history
    await this.setData({ source_so_id: "", source_so_line_id: "" });
    scKeep(null);
  }
  if (value && scModeOf(v) === "FLAT") {
    await scPrepare({ mode: "FLAT", itemId: value, newItem: true, expand: null, saved: [], prev: Object.assign({ item_id: prevItem }, link.source_so_line_id ? link : {}) });
    return;
  }
  const clear = { bom_snapshot_json: "", source_bom_id: "", planned_output_qty: null };
  (v.stock_movement || []).forEach((l, i) => {
    if (scS(l.sc_ref_key)) clear[`stock_movement.${i}.sc_ref_key`] = "";
  });
  await this.setData(clear);
  scStore({ sc_item: value });
  await scSleep(0);
  this.triggerEvent("onChange_assembledItem", { value: value, scLegacy: true });
  scRedisplay(this.getValues());
};
const scOpMode = async () => {
  const v = this.getValues();
  const mode = scS(scArgs.value);
  const st = scState();
  const snap = scSnapOf(v.bom_snapshot_json);
  const old = st.sc_mode !== undefined && st.sc_mode !== null ? scS(st.sc_mode) : snap ? snap.mode : "";
  if (mode === old) return;
  if (!scS(v.item_id)) {
    this.$message.warning("Select the BOM item first.");
    return scSetMode(old);
  }
  const hasLines = (v.stock_movement || []).length > 0;
  if (mode === "FLAT") {
    if (hasLines && !(await scAsk("Flat replaces the component lines and their picks with the BOM expanded into its sub-assemblies' components. Continue?", "BOM Mode", "Continue", "Cancel"))) {
      return scSetMode(old);
    }
    scStore({ sc_mode: "FLAT" });
    return scPrepare({ mode: "FLAT", itemId: v.item_id, newItem: false, expand: null, saved: snap && snap.mode === "FLAT" ? snap.expand : [], prev: { bom_consumption_mode: old } });
  }
  if (mode !== "STANDARD") return scSetMode(old);
  // only Flat lines are rebuilt: Standard after legacy / Standard changes no line (a missed echo of our own write lands here too)
  if (old !== "FLAT") {
    scStore({ sc_mode: "STANDARD" });
    return scRedisplay(v);
  }
  if (hasLines && !(await scAsk("Standard rebuilds the component lines from the BOM; the Flat lines and their picks are replaced. Continue?", "BOM Mode", "Continue", "Cancel"))) {
    return scSetMode(old);
  }
  scStore({ sc_mode: "STANDARD" });
  return scPrepare({ mode: "STANDARD", itemId: v.item_id, newItem: false, expand: [], prev: { bom_consumption_mode: old }, legacyAfter: !scLinked(v) });
};
const scOpPlant = async () => {
  if (this.isCopy && Number(scState().sc_cloned) !== 1) return;
  const seq = scBegin();
  const v = this.getValues();
  const snap = scSnap(v);
  const plantId = scS(scArgs.value);
  if (!snap || !plantId) return;
  const org = scOrg(v);
  const rows = scSnapRows(snap, v.item_qty);
  const itemsRes = await fetchByIds("item", rows.map((r) => r.item_selection), SC_ITEM_FIELDS);
  const items = {};
  (itemsRes.data || []).forEach((it) => (items[scS(it.id)] = it));
  const uomMap = await scUomMap(rows, items);
  if (!scCurrent(seq)) return;
  await scWriteLines(scLines(rows, items, uomMap, v, org, plantId, true), items, uomMap, plantId, org);
};
const scOpPlanned = async () => scRenderOrRead(this.getValues());
const scIaQtyFromLine = async (v, qty, lineUom) => {
  if (qty === null || qty === undefined) return null;
  const f = await scFactor(v, lineUom);
  return f === null || !(f > 0) ? null : scQ8(scNum(qty) / f);
};
const scOpSuggest = async () => {
  let v = this.getValues();
  if (!scLinked(v)) return;
  const sum = await scRefresh(v);
  const keep = scState().sc_sum;
  if (!sum || !keep) return scAlert("The Sales Order figures could not be read. Nothing was changed; please try again.", "Use Suggested Qty", "error");
  const qty = await scIaQtyFromLine(v, keep.suggestion, keep.uomId);
  if (qty === null) return scAlert("No suggestion can be given: the item has no unit conversion between the Sales Order line and this Item Assembly.", "Use Suggested Qty", "warning");
  if (!(qty > 0)) return scAlert("Nothing is left to plan for this Sales Order line (suggested 0). Nothing was changed.", "Use Suggested Qty", "info");
  await this.setData({ planned_output_qty: qty });
  v = this.getValues();
  if (Math.abs(scQ8(v.item_qty) - qty) > SC_EPS) {
    await scSetQty(qty);
    scArgs.scSelf = true;
    await scOpQty();
  } else await scRender(v);
};
const scOpSelectLine = async () => {
  const v = this.getValues();
  if (!scS(v.item_id)) return this.$message.warning("Select the BOM item first.");
  this.showLoading("Reading the Sales Order lines...");
  const r = await scProjection({ operation: "CANDIDATES", so_id: "", so_line_id: "", item_id: scS(v.item_id), exclude_ia_id: "", organization_id: scOrg(v),
    proposal_qty: "", proposal_uom_id: "", baseline: "" });
  this.hideLoading();
  if (!r) return scAlert("The Sales Order lines could not be read. Nothing was changed; please try again.", "Select SO Line", "error");
  const cands = (r.candidates || []).filter((c) => scS(c.lineId) !== scS(v.source_so_line_id));
  if (!cands.length) return this.$message.info("No open Sales Order line (Issued or Processing) is waiting for this item.");
  const names = await scUomNames(cands.map((c) => c.uomId));
  scStore({ sc_dialog: "LINK" });
  await this.setData({ "sc_line_dialog.sc_line_table": cands.map((c) => ({ so_no: scS(c.soNo), line_no: scS(c.lineIndex), customer: scS(c.customerName), ordered: c.ordered,
    delivered: c.delivered, suggestion: c.suggestion, uom: names[scS(c.uomId)] || scS(c.uomId), line_id: scS(c.lineId), so_id: scS(c.soId), uom_id: scS(c.uomId) })) });
  await this.openDialog("sc_line_dialog");
  if (scS(r.capped) === "YES") this.$message.info("The 200 newest lines are listed.");
};
const scCloseLines = async () => {
  await this.closeDialog("sc_line_dialog");
  await this.setData({ "sc_line_dialog.sc_line_table": [] });
};
const scOpPickLine = async () => {
  const all = this.getValues();
  const row = scArgs.row || ((all.sc_line_dialog || {}).sc_line_table || [])[Number(scArgs.rowIndex)];
  if (!row || !scDigits(row.line_id)) return;
  await scCloseLines();
  if (scS(scState().sc_dialog) === "RELINK") return scRelink(row);
  let v = this.getValues();
  const old = scParseJ(v.source_so_context_json) || {};
  const now = new Date().toISOString();
  const by = scS(this.getVarSystem("uid")) || scS(this.getVarGlobal("nickname"));
  // a preview of the baseline for the panel; the save rebuilds it from its own read and writes the LINK / RELINK history
  const ctx = { v: 1, soId: scS(row.so_id), lineId: scS(row.line_id), soNo: scS(row.so_no), lineIndex: scS(row.line_no), customerId: "", itemId: scS(v.item_id),
    orderedQty: scS(row.ordered), uomId: scS(row.uom_id), headerStatus: "", lineStatus: "", linkedAt: now, linkedBy: by, history: Array.isArray(old.history) ? old.history : [] };
  await this.setData({ source_so_id: scS(row.so_id), source_so_line_id: scS(row.line_id), source_so_context_json: JSON.stringify(ctx) });
  if (!scModeOf(v)) await scSetMode("STANDARD");
  v = this.getValues();
  // the new line's figures once, before the writes whose echoes render the panel from them
  scStore({ sc_sum: undefined });
  await scRefresh(v);
  // the lines are stamped at the quantity they were built for; a quantity filled from the suggestion then goes through QTY
  const qty = scQ8(v.item_qty) <= 0 ? await scIaQtyFromLine(v, row.suggestion, row.uom_id) : null;
  if (!scEnhanced(v)) {
    if (!(v.stock_movement || []).length) {
      if (qty !== null && qty > 0) {
        await this.setData({ planned_output_qty: qty });
        await scSetQty(qty);
      } else if (scS(v.planned_output_qty) === "") await this.setData({ planned_output_qty: scQ8(v.item_qty) });
      return scPrepare({ mode: scModeOf(v) || "STANDARD", itemId: v.item_id, newItem: false, expand: scModeOf(v) === "FLAT" ? null : [], prev: null });
    }
    try {
      const r = await scStamp(v);
      if (!r.ok) await scAlert(scHtml(r.message) + " The lines were kept; press Prepare BOM once the BOM is fixed.", "BOM Not Prepared", "warning");
    } catch (e) {
      await scAlert("The BOM could not be read (" + scHtml(e && e.message) + "). The lines were kept; press Prepare BOM to try again.", "BOM Not Prepared", "warning");
    }
  }
  if (qty !== null && qty > 0) {
    await this.setData({ planned_output_qty: qty });
    await scSetQty(qty);
    scArgs.scSelf = true;
    await scOpQty();
  } else if (scS(v.planned_output_qty) === "") await this.setData({ planned_output_qty: scQ8(v.item_qty) });
  v = this.getValues();
  scRedisplay(v);
  await scRender(v);
};
const scRelink = async (row) => {
  const v = this.getValues();
  const ok = await scAsk("Re-link Item Assembly " + scHtml(v.stock_movement_no) + " to line " + scHtml(row.line_no) + " of Sales Order " + scHtml(row.so_no)
    + "? Only the link changes; its stock and costs stay as they are.", "Re-link", "Re-link", "Cancel");
  if (!ok) return;
  let d = {};
  try {
    const res = await scRun(SC_WF_RELINK, { ia_id: scS(v.id), so_line_id: scS(row.line_id), item_id: scS(v.item_id), organization_id: scOrg(v) });
    d = (res && res.data) || {};
  } catch (e) {
    d = { code: "500", message: scS(e && (e.message || e.msg)) };
  }
  if (scS(d.code) !== "200") return scAlert(scHtml(d.message || "The re-link failed.") + " Nothing was changed.", "Re-link", "error");
  this.$message.success(scS(d.message) || "Re-linked to the Sales Order line.");
  await this.setData({ source_so_line_id: scS(row.line_id) });
  if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  const after = this.getValues();
  await scRefresh(after);
  scRedisplay(after);
};
const scOpRelink = async () => {
  const v = this.getValues();
  if (!scState().sc_sum) await scRefresh(v);
  const sum = scState().sc_sum;
  const list = (sum && sum.relink) || [];
  if (!list.length) return this.$message.info("No current line of this Sales Order is for this item.");
  const names = await scUomNames(list.map((c) => c.uomId));
  scStore({ sc_dialog: "RELINK" });
  await this.setData({ "sc_line_dialog.sc_line_table": list.map((c) => ({ so_no: sum.soNo, line_no: c.lineIndex, customer: sum.customer, ordered: c.ordered, delivered: c.delivered,
    suggestion: null, uom: names[c.uomId] || c.uomId, line_id: c.id, so_id: sum.soId, uom_id: c.uomId })) });
  await this.openDialog("sc_line_dialog");
};
const scOpUnlink = async () => {
  const v = this.getValues();
  if (!scLinked(v)) return;
  const sum = scState().sc_sum || {};
  const ok = await scAsk("Remove the link to line " + scHtml(sum.lineIndex || "") + " of Sales Order " + scHtml(sum.soNo || "") + "? The components stay as they are.",
    "Unlink", "Unlink", "Cancel");
  if (!ok) return;
  // the context stays: the save adds the UNLINK to its history
  const updates = { source_so_id: "", source_so_line_id: "" };
  if (scModeOf(v) !== "FLAT") {
    Object.assign(updates, { bom_snapshot_json: "", source_bom_id: "", planned_output_qty: null });
    (v.stock_movement || []).forEach((l, i) => {
      if (scS(l.sc_ref_key)) updates[`stock_movement.${i}.sc_ref_key`] = "";
    });
  }
  await this.setData(updates);
  scKeep(null);
  const after = this.getValues();
  scRedisplay(after);
  await scRender(after);
};
const scOpBom = async () => {
  const v = this.getValues();
  const mode = scModeOf(v) || (scLinked(v) ? "STANDARD" : "");
  if (!mode) return;
  if (!scS(v.item_id)) return this.$message.warning("Select the BOM item first.");
  const snap = scSnap(v);
  return scPrepare({ mode: mode, itemId: v.item_id, newItem: false, expand: mode === "FLAT" ? null : [], saved: snap && snap.mode === "FLAT" ? snap.expand : [],
    prev: null, diffFrom: snap ? v.bom_snapshot_json : null });
};
const scExpandRowsNow = () => ((this.getValues().sc_expand_dialog || {}).sc_expand_table || []);
const scOpExpandAll = async () => this.setData({ "sc_expand_dialog.sc_expand_table": scExpandRowsNow().map((r) => Object.assign({}, r, { expand: 1 })) });
const scOpExpandOk = async () => {
  const p = scState().sc_pending;
  const ticks = scExpandRowsNow().filter((r) => Number(r.expand) === 1 || r.expand === true).map((r) => scS(r.item_id));
  await this.closeDialog("sc_expand_dialog");
  await this.setData({ "sc_expand_dialog.sc_expand_table": [] });
  scStore({ sc_pending: null });
  if (!p) return;
  const v = this.getValues();
  return scPrepare({ mode: "FLAT", itemId: p.itemId, newItem: !!p.newItem, expand: ticks, prev: p.prev, diffFrom: p.diff ? v.bom_snapshot_json || null : null });
};
const scOpExpandClose = async () => {
  const p = scState().sc_pending;
  await this.closeDialog("sc_expand_dialog");
  await this.setData({ "sc_expand_dialog.sc_expand_table": [] });
  scStore({ sc_pending: null });
  if (p) await scRestore(p);
};
// Clone of an enhanced IA: the link, its context and the plan are dropped; FLAT keeps its ticks and is prepared again from
// the live BOM; STANDARD becomes a plain (legacy) clone of the lines
const scClone = async (v) => {
  const snap = scSnapOf(v.bom_snapshot_json);
  const updates = { source_so_id: "", source_so_line_id: "", source_so_context_json: "", planned_output_qty: null };
  if (scModeOf(v) !== "FLAT") {
    Object.assign(updates, { bom_snapshot_json: "", source_bom_id: "" });
    (v.stock_movement || []).forEach((l, i) => {
      if (scS(l.sc_ref_key)) updates[`stock_movement.${i}.sc_ref_key`] = "";
    });
  }
  await this.setData(updates);
  scStore({ sc_cloned: 1 });
  if (scModeOf(v) === "FLAT" && scS(v.item_id)) {
    await scPrepare({ mode: "FLAT", itemId: v.item_id, newItem: false, expand: snap && snap.mode === "FLAT" ? snap.expand : [], prev: null });
  }
};
// the Sales Order line entry (SO Linked IAs page): the line is checked, the item fields set, the quantity = the suggestion
const scEntry = async (v) => {
  const sum = await scSummary(v);
  if (sum && !sum.eligibleNew) {
    scStore({ sc_mode: "" });
    await this.setData({ source_so_id: "", source_so_line_id: "", source_so_context_json: "", bom_consumption_mode: "" });
    scKeep(null);
    scRedisplay(this.getValues());
    await scAlert(scHtml(sum.reason) + " This Item Assembly is not linked to it: it continues as an ordinary Item Assembly for the item.", "Sales Order Line", "warning");
    // today's item fields and BOM lines (the v36 handler), as if the item had been picked by hand
    this.triggerEvent("onChange_assembledItem", { value: v.item_id, scLegacy: true });
    return;
  }
  let fg = null;
  try {
    fg = (await scReadIds("item", [v.item_id], SC_ITEM_FIELDS))[0] || null;
  } catch (e) {
    fg = null;
  }
  if (!fg) return scAlert("The item could not be read: select it again.", "Sales Order Line", "error");
  // the figures kept once: the writes below echo back through onChange and render the panel from them
  const fa = spToBase(fg, fg.based_uom);
  const fb = sum ? spToBase(fg, sum.uomId) : null;
  scKeep(sum, fa === null || fb === null ? null : fa / fb);
  const header = { item_name: scS(fg.material_name), item_desc: scS(fg.material_desc), item_uom: scS(fg.based_uom) };
  const plantId = scS(v.issuing_operation_faci);
  const own = getItemDefaultBin(fg.table_default_bin, plantId);
  const plant = own ? { storageLocation: null, binLocation: null } : await fetchPlantDefaults(plantId);
  Object.assign(header, { storage_location_id: (own && own.storageLocation) || plant.storageLocation || "", location_id: (own && own.binLocation) || plant.binLocation || "" });
  if (sum) {
    const h = sum.header || {};
    const l = sum.line || {};
    const now = new Date().toISOString();
    const by = scS(this.getVarSystem("uid")) || scS(this.getVarGlobal("nickname"));
    header.source_so_context_json = JSON.stringify({ v: 1, soId: scS(h.id), lineId: scS(l.id), soNo: scS(h.so_no), lineIndex: scS(l.line_index), customerId: scS(h.customer_id),
      itemId: scS(l.item_name), orderedQty: scS(l.so_quantity), uomId: scS(l.so_item_uom), headerStatus: scS(h.so_status), lineStatus: scS(l.line_status), linkedAt: now, linkedBy: by,
      history: [] });
  }
  await this.setData(header);
  applyBatchFields(fg);
  scStore({ sc_item: scS(v.item_id) });
  if (sum && sum.totals && sum.totals.suggestion !== null) {
    const a = spToBase(fg, sum.uomId);
    const b = spToBase(fg, fg.based_uom);
    const qty = a === null || b === null ? null : scQ8((scNum(sum.totals.suggestion) * a) / b);
    if (qty !== null && qty > 0) {
      await this.setData({ planned_output_qty: qty });
      await scSetQty(qty);
    } else if (qty === 0) this.$message.info("Nothing is left to plan for this Sales Order line (suggested 0): enter the quantity yourself.");
  } else this.$message.warning("The Sales Order figures are unavailable, so no quantity was suggested.");
  await scPrepare({ mode: "STANDARD", itemId: v.item_id, newItem: false, expand: [], prev: null });
};
const scOpMount = async () => {
  await scSleep(0);
  const page = scS(scArgs.pageStatus);
  const status = scS(scArgs.status);
  const v = this.getValues();
  const snap = scSnapOf(v.bom_snapshot_json);
  scStore({ sc_page: page, sc_status: status, sc_mode: scModeOf(v), sc_item: scS(v.item_id), sc_sum: undefined, sc_pending: null });
  if (page === "Clone" && (scLinked(v) || scModeOf(v) === "FLAT" || scEnhanced(v))) {
    await scClone(v);
    const after = this.getValues();
    scDisplay(after, page, status);
    return scRender(after);
  }
  if (page === "Clone") scStore({ sc_cloned: 1 });
  const entry = page === "Add" && scS(this.getParamsVariables("sc_entry")) === "1" && scLinked(v) && scS(v.item_id) !== "";
  scDisplay(v, page, status);
  if (entry) return scEntry(v);
  if (scLinked(v)) {
    await scRefresh(v);
    return scDisplay(this.getValues(), page, status);
  }
  if (snap || scModeOf(v) === "FLAT") return scRender(v);
};

(async () => {
  if (!scOn()) return;
  const ops = { QTY: scOpQty, ITEM: scOpItem, MODE: scOpMode, PLANT: scOpPlant, PLANNED: scOpPlanned, SUGGEST: scOpSuggest, SELECT_LINE: scOpSelectLine,
    PICK_LINE: scOpPickLine, LINE_CLOSE: scCloseLines, RELINK: scOpRelink, UNLINK: scOpUnlink, BOM: scOpBom, EXPAND_ALL: scOpExpandAll, EXPAND_OK: scOpExpandOk,
    EXPAND_CLOSE: scOpExpandClose, REFRESH: async () => scRefresh(this.getValues()), MOUNT: scOpMount };
  const op = ops[scS(scArgs.scOp)];
  if (!op) return console.error("Small Cycle: unknown op", scArgs.scOp);
  try {
    await op();
  } catch (error) {
    this.hideLoading();
    console.error("Small Cycle error:", error);
    this.$message.error((error && error.message) || "The Small Cycle action failed");
  }
})();
