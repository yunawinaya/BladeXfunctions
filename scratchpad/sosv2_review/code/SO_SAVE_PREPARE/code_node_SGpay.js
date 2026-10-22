// SO Save V2 - shared helpers (included at the top of every code node by scripts/build-so-save-v2.mjs)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
const soParse = (t) => {
  if (t && typeof t === "object") return t;
  try {
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
};
// "YYYY-MM-DD HH:MM:SS" (the DB clock, MYT on dev) + seconds
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// a request's fingerprint (not security): two FNV-1a lanes over the text, 16 hex
const soHash = function soHash(text) {
  const t = String(text);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2 * (i & 7)) >>> 0;
  }
  const h = (n) => ("0000000" + n.toString(16)).slice(-8);
  return h(a) + h(b);
};
// a SO's lines with their bundle children, as one list (children carry no `children` of their own here)
const soFlatLines = (rows) => list(rows).flatMap((r) => [r].concat(list(r.children)));
// the SAVE_SO job statuses that hold a sales order
const SO_JOB_OPEN = ["QUEUED", "PREPARING", "CASCADE_PREPARING", "AWAITING_CONFIRMATION", "READY_TO_COMMIT", "COMMITTING_SO", "RELEASING", "AFTER", "REQUIRES_REVIEW"];

// ---- lifted classic nodes (generated)
const __json = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
const __pick = function (o, path) { let v = o; for (const k of path) { if (v === undefined || v === null) return undefined; v = v[k]; } return v; };
const __V = function (tokens, SRC, P) {
  const V = {};
  for (const t of tokens) {
    const i = t.indexOf(":"); const kind = t.slice(0, i); const ref = t.slice(i + 1).split(".");
    if (kind === "workflowparams") V[t] = __json(__pick(P, ref));
    else if (kind === "node") V[t] = __json(__pick(SRC[ref[0]], ref[1] === "data" ? ref.slice(2) : ref.slice(1)));
    else V[t] = __json(__pick((P && P.__system) || {}, ref));
  }
  return V;
};
const __T_cdPlan = ["workflowparams:passNo","workflowparams:raiseGdQty","node:code_cd_diff.data.changes","node:search_cd_gds.data.data","node:search_cd_pps.data.data","node:sql_node_CdItems.data","node:get_cd_setup.data.data"];
const cdPlan = function (V) {
// Owns only the rules the downstream documents cannot know: which delivery a line
// belongs to, and how far a quantity may move given what other deliveries already
// took. Pick blocks, invoiced/packed lines, serial shortfalls, over-delivery and
// stock availability are all left to GDheadWorkflow / PPheadWorkflow, which produce
// better messages than a second implementation would.
// A literal string in a workflow-node's body_params is evaluated by MVEL, and a value
// that collides with a builtin -- "append" does -- arrives as a function reference, not
// a string. The pass is discriminated by an int, which MVEL cannot resolve to anything.
const isAppend = Number(V["workflowparams:passNo"]) === 2;
const raiseAnswer = V["workflowparams:raiseGdQty"];
const changes = V["node:code_cd_diff.data.changes"] || [];
const rawGds = V["node:search_cd_gds.data.data"];
const rawPps = V["node:search_cd_pps.data.data"];
const rawItems = V["node:sql_node_CdItems.data"];
const rawSetup = V["node:get_cd_setup.data.data"];

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const gds = asArray(rawGds);
const pps = asArray(rawPps);
const items = asArray(rawItems);
const setup = asArray(rawSetup)[0] || {};

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const sid = (v) => String(v === null || v === undefined ? "" : v);
// 8dp is the maximum configurable column precision: every GD / Picking Plan column this
// node writes is precision 8, so rounding there keeps the client's scale and kills residue.
const q8 = (v) => Number((num(v) || 0).toFixed(8));
const flat = (rows) =>
  (Array.isArray(rows) ? rows : []).flatMap((r) =>
    [r].concat(Array.isArray(r && r.children) ? r.children : [])
  );
const parseArr = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) { return []; }
};
// The allocation key Picking itself uses (PickingProcessWorkflow code_node_iES7iMKA).
const allocKey = (e) =>
  sid(e.location_id || "no-loc") + "_" + sid(e.batch_id || "no-batch") + "_" +
  sid(e.handling_unit_id || "no-hu");

// Get Items hands table_uom_conversion back as a JSON_ARRAYAGG string.
const parseConv = (v) => {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
};
const itemById = {};
items.forEach((i) => {
  if (i && i.id)
    itemById[sid(i.id)] = { ...i, table_uom_conversion: parseConv(i.uom_conversion_json) };
});

// Order UOM -> base UOM. The ITEM is the authority (same lookup GLOBAL_AUTO_ALLOCATION
// and GD_funcProcessGDLineItem use); the row's own base_qty/gd_qty ratio is only a
// derived cache, so it is the last resort -- an already-inconsistent row would
// otherwise propagate its wrong factor into every later edit.
const baseFactorFor = (item, uomId, curQty, curBase) => {
  if (item) {
    if (sid(item.based_uom) === sid(uomId)) { return 1; }   // order UOM IS the base UOM
    const rows = Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion : [];
    const conv = rows.find((c) => sid(c.alt_uom_id) === sid(uomId));
    if (conv && parseFloat(conv.base_qty)) { return parseFloat(conv.base_qty); }
  }
  return curQty > 0 && curBase > 0 ? curBase / curQty : 1;
};

// For a unit CHANGE that fallback is the factor of the OLD unit -- exactly the wrong
// answer -- so the item master is the only source and an unresolvable unit is refused
// rather than guessed. 0 means "no conversion on the item".
const strictFactor = (item, uomId) => {
  if (!item) { return 0; }
  if (sid(item.based_uom) === sid(uomId)) { return 1; }
  const rows = Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion : [];
  const conv = rows.find((c) => sid(c.alt_uom_id) === sid(uomId));
  return conv && parseFloat(conv.base_qty) ? parseFloat(conv.base_qty) : 0;
};

const OFF = {
  blockCode: "", blocked: 0, blockSignal: 0, blockKind: "", blockMessage: "",
  gdDrafts: [], ppDrafts: [], allocRequests: [], affectedSoLineIds: ["0"], hasWork: 0
};
if (!changes.length) return OFF;

const block = (msg) => ({
  blockCode: "406", blocked: 1, blockSignal: 1, blockKind: "block", blockMessage: msg,
  gdDrafts: [], ppDrafts: [], allocRequests: [], affectedSoLineIds: ["0"], hasWork: 0
});

// ---- index the downstream lines by SO line -------------------------------------
const gdLinesBySoLine = {};
const gdById = {};
gds.forEach((gd) => {
  gdById[sid(gd.id)] = gd;
  flat(gd.table_gd).forEach((ln) => {
    if (!ln || !ln.so_line_item_id) return;
    const k = sid(ln.so_line_item_id);
    (gdLinesBySoLine[k] = gdLinesBySoLine[k] || []).push({ gd: gd, line: ln });
  });
});
const ppLinesBySoLine = {};
const ppById = {};
pps.forEach((pp) => {
  ppById[sid(pp.id)] = pp;
  flat(pp.table_to).forEach((ln) => {
    if (!ln || !ln.so_line_item_id) return;
    const k = sid(ln.so_line_item_id);
    (ppLinesBySoLine[k] = ppLinesBySoLine[k] || []).push({ pp: pp, line: ln });
  });
});

const affected = [];
const allocRequests = [];
const gdEdits = {};   // gdId -> { gd, rows: {gdLineId: patch}, drops: Set-ish map }
const ppEdits = {};
let needRaise = 0;
const raiseLines = [];

const editFor = (bag, key, doc) => {
  if (!bag[key]) bag[key] = { doc: doc, rows: {}, drops: {} };
  return bag[key];
};

// Trim an allocation down to `target`, spending unpicked quantity before picked.
// Cutting into picked quantity is exactly the case GD answers with its 413.
const trimAllocation = (entries, pickedEntries, target, qtyField) => {
  // A delivery counts its allocation in gd_quantity, a plan in to_quantity. Reading
  // the wrong key makes every entry look like zero: nothing is trimmed, and the
  // filter at the end then drops the WHOLE allocation -- the plan arrives with a
  // reduced to_qty and no allocation at all, which its own reconcile refuses.
  const F = qtyField || "gd_quantity";
  const list = entries.map((e) => Object.assign({}, e));
  const pickedLeft = {};
  pickedEntries.forEach((p) => {
    const k = allocKey(p);
    pickedLeft[k] = q8((pickedLeft[k] || 0) + num(p[F]));
  });
  let total = list.reduce((s, e) => s + num(e[F]), 0);
  let remove = q8(total - target);
  let cutIntoPicked = false;
  const take = (freeOnly) => {
    for (let i = list.length - 1; i >= 0 && remove > 0.0005; i--) {
      const qty = num(list[i][F]);
      if (qty <= 0) continue;
      const k = allocKey(list[i]);
      const picked = Math.min(qty, pickedLeft[k] || 0);
      const avail = freeOnly ? q8(qty - picked) : qty;
      if (avail <= 0) continue;
      const cut = Math.min(avail, remove);
      list[i][F] = q8(qty - cut);
      remove = q8(remove - cut);
      if (!freeOnly && cut > q8(qty - picked)) cutIntoPicked = true;
      if (picked > 0 && !freeOnly) {
        pickedLeft[k] = q8(Math.max(0, picked - Math.max(0, cut - q8(qty - picked))));
      }
    }
  };
  take(true);
  if (remove > 0.0005) { take(false); }
  return {
    entries: list.filter((e) => num(e[F]) > 0),
    cutIntoPicked: cutIntoPicked
  };
};

for (const ch of changes) {
  const soLineId = sid(ch.soLineId);
  const label = ch.desc || ch.itemCode || ("SO line " + (ch.lineIndex || soLineId));
  const gdHits = gdLinesBySoLine[soLineId] || [];
  const ppHits = ppLinesBySoLine[soLineId] || [];

  if (isAppend) {
    // Handled by code_cd_payloads: a new line joins the single Created GD.
    affected.push(soLineId);
    continue;
  }

  // A background job holds that delivery (async save or completion): neither delivered nor editable until it ends.
  const busy = gdHits.filter((h) => sid(h.gd.gd_status) === "Processing");
  if (busy.length && ch.kind !== "price") {
    return block("Item " + label + " is on delivery " + Array.from(new Set(busy.map((h) => sid(h.gd.delivery_no)))).join(", ") +
      ", which is being processed in the background. Save the Sales Order again when it has finished.");
  }

  // Every quantity already stored downstream is counted in ch.prevUom, while ch.nextQty
  // arrives in ch.nextUom. `conv` carries an old-unit number onto the new unit so the
  // two sides are comparable; it is the identity whenever the unit did not move.
  // code_cd_diff stamps prevUom/nextUom on EVERY change, not only a "uom" one, so the
  // two units differ on a swap as well -- they simply belong to two different items.
  // uomMoved is "the line lands on a different unit" and drives the restamp below;
  // uomRestate is the narrower "the stored quantities have to be carried across a
  // ratio", which only a same-item unit change can ask for.
  const isSwap = ch.kind === "swap";
  const uomMoved = !!sid(ch.prevUom) && !!sid(ch.nextUom) &&
                   sid(ch.prevUom) !== sid(ch.nextUom);
  const uomRestate = uomMoved && !isSwap;
  const chItem = itemById[sid(ch.nextItem)] || itemById[sid(ch.prevItem)] || null;
  let uomRatio = 1;
  let nextUomFactor = 0;
  if (uomRestate) {
    const prevUomFactor = strictFactor(chItem, ch.prevUom);
    nextUomFactor = strictFactor(chItem, ch.nextUom);
    if (!prevUomFactor || !nextUomFactor) {
      return block("The unit of measure on " + label + " was changed to one the item has " +
        "no conversion for, so the delivery quantity cannot be restated. Add the UOM " +
        "conversion on the item first.");
    }
    uomRatio = prevUomFactor / nextUomFactor;
  } else if (isSwap && uomMoved) {
    // A swap discards the whole allocation and re-serves it against the new item, so
    // there is nothing to carry across and uomRatio stays the identity. Asking the NEW
    // item to resolve the OLD item's unit is what used to refuse every item change:
    // the two units are unrelated, so strictFactor could only ever return 0. Only the
    // unit the line lands on has to resolve, and it is still the item master's call.
    nextUomFactor = strictFactor(chItem, ch.nextUom);
    if (!nextUomFactor) {
      return block("Item " + label + " is ordered in a unit its own item master has no " +
        "conversion for, so the delivery quantity cannot be set. Add the UOM " +
        "conversion on the item first.");
    }
  }
  const conv = (v) => q8(num(v) * uomRatio);

  const completed = gdHits.filter((h) => sid(h.gd.gd_status) === "Completed");
  const created = gdHits.filter((h) => sid(h.gd.gd_status) === "Created");
  const completedQty = conv(completed.reduce((s, h) => s + num(h.line.gd_qty), 0));

  if (completedQty > 0 && ch.kind === "swap") {
    return block("Item " + label + " has already been delivered on " +
      completed.map((h) => sid(h.gd.delivery_no)).join(", ") +
      ", so the item on that line can no longer be changed.");
  }
  if (completedQty > 0 && uomRestate) {
    return block("Item " + label + " has already been delivered on " +
      completed.map((h) => sid(h.gd.delivery_no)).join(", ") +
      ", so the unit of measure on that line can no longer be changed.");
  }
  if (ch.kind !== "added" && q8(ch.nextQty) + 0.0005 < completedQty) {
    return block("Item " + label + " has already been delivered " + completedQty + " on " +
      completed.map((h) => sid(h.gd.delivery_no)).join(", ") +
      ". The order quantity cannot be reduced to " + q8(ch.nextQty) + ".");
  }
  // A COMPLETED plan is a closed document: PPheadWorkflow's gate is
  // `allData.to_status == 'Created'`, so its reconcile never runs and a quantity
  // written to it would skip the pick reversal entirely. ppLive below drops such
  // plans, which used to let an SO shrink below what one still holds and leave
  // planned_qty above so_quantity with nothing said. Refused here instead, the same
  // way a delivered GD is -- reducing below a plan at Created is still fine, and is
  // what the 413 exists for.
  const ppDone = ppHits.filter((h) => sid(h.pp.to_status) === "Completed");
  const ppDoneQty = conv(ppDone.reduce((s, h) => s + num(h.line.to_qty), 0));
  const ppDoneNos = ppDone.map((h) => sid(h.pp.to_id || h.pp.to_no)).join(", ");

  if (ppDoneQty > 0 && ch.kind === "swap") {
    return block("Item " + label + " is planned on " + ppDoneNos +
      ", which is completed, so the item on that line can no longer be changed. " +
      "Revert or cancel that Picking Plan first.");
  }
  if (ppDoneQty > 0 && uomRestate) {
    return block("Item " + label + " is planned on " + ppDoneNos +
      ", which is completed, so the unit of measure on that line can no longer be " +
      "changed. Revert or cancel that Picking Plan first.");
  }
  if (ch.kind !== "added" && q8(ch.nextQty) + 0.0005 < ppDoneQty) {
    return block("Item " + label + " has " + ppDoneQty + " planned on " + ppDoneNos +
      ", which is completed. The order quantity cannot be reduced to " +
      q8(ch.nextQty) + ". Revert or cancel that Picking Plan first.");
  }

  const createdGdIds = [];
  created.forEach((h) => {
    const k = sid(h.gd.id);
    if (createdGdIds.indexOf(k) < 0) createdGdIds.push(k);
  });
  if (createdGdIds.length > 1) {
    return block("Item " + label + " is claimed by more than one delivery still at Created (" +
      created.map((h) => sid(h.gd.delivery_no)).join(", ") +
      "). Edit those deliveries one at a time.");
  }

  let touched = 0;

  // ---- Goods Delivery -----------------------------------------------------------
  for (const h of created) {
    touched = 1;
    const line = h.line;
    const gdLineId = sid(line.id);
    const ed = editFor(gdEdits, sid(h.gd.id), h.gd);
    const curQty = conv(line.gd_qty);
    const curOrder = conv(line.gd_order_quantity);
    // Only used to spend unpicked quantity first when trimming; whether a trim actually
    // reverses a pick is GD's call, from its Picking records.
    const pickedEntries = parseArr(line.picked_temp_qty_data);
    const entries = parseArr(line.temp_qty_data);
    const initDel = conv(line.gd_initial_delivered_qty);

    if (ch.kind === "removed") {
      ed.drops[gdLineId] = 1;
      continue;
    }

    // Price reserves no stock, so it gets its own exit before any of the quantity
    // arithmetic below. Running a price-only edit through that would re-derive gd_qty
    // from the ceiling and silently trim a delivery whose stored quantity already sits
    // above it. Completed deliveries are deliberately left alone -- their money is
    // history, and the invoice reads its prices off the SO line regardless.
    if (ch.kind === "price") {
      ed.rows[gdLineId] = Object.assign(ed.rows[gdLineId] || {}, {
        unit_price: num(ch.nextPrice).toFixed(8),
        total_price: num(ch.nextAmount).toFixed(8)
      });
      continue;
    }

    // Target delivery quantity, anchored on gd_order_quantity so a retry is a no-op.
    // SHARED by the swap and qty branches: code_cd_diff tests the item before the
    // quantity, so an edit that changes BOTH arrives here as a swap -- computing the
    // quantity only in the qty branch silently delivered the old one.
    // A reduction clamps (a partial delivery stays partial); an increase adds the delta.
    const delta = q8(ch.nextQty - curOrder);
    const ceiling = q8(Math.max(0, ch.nextQty - conv(ch.deliveredQty)));
    const raised = q8(Math.min(curQty + Math.max(0, delta), ceiling));
    if (raised > curQty + 0.0005 && raiseAnswer !== "Yes" && raiseAnswer !== "No") {
      needRaise = 1;
      raiseLines.push(label + ": " + curQty + " -> " + raised);
      continue;
    }
    const finalQty = raised > curQty + 0.0005 && raiseAnswer === "No"
      ? q8(Math.min(curQty, ceiling))
      : raised;

    // Nothing left for this delivery to carry -- an empty temp_qty_data is a 400 on the
    // GD side, so the row goes rather than being written at zero.
    if (finalQty <= 0.0005) {
      ed.drops[gdLineId] = 1;
      continue;
    }

    const patch = { gd_order_quantity: q8(ch.nextQty).toFixed(8) };
    // A swap or a quantity edit usually moves the money too; restamp it in the same pass
    // rather than making the user save twice.
    if (ch.priceChanged) {
      patch.unit_price = num(ch.nextPrice).toFixed(8);
      patch.total_price = num(ch.nextAmount).toFixed(8);
    }

    if (ch.kind === "swap" || ch.kind === "uom") {
      // Both discard the whole allocation and re-serve it: a different item, or the same
      // item counted in a different unit, invalidates the old base ratio either way.
      const nextItemId = sid(isSwap ? ch.nextItem : line.material_id);
      const item = itemById[nextItemId] || {};
      // The unit the line CARRIES after this edit -- restamped on a unit change, so the
      // base ratio has to come from the new unit and not from the row's current one.
      const newUom = uomMoved ? sid(ch.nextUom) : sid(line.gd_order_uom_id || ch.uomId);
      const newFactor = uomMoved
        ? nextUomFactor
        : baseFactorFor(item, newUom, curQty, q8(line.base_qty));
      Object.assign(patch, {
        gd_qty: finalQty.toFixed(8),
        temp_qty_data: "[]",
        temp_hu_data: "[]",
        view_stock: "",
        _reallocate: 1,
        _baseFactor: newFactor
      });
      if (isSwap) {
        Object.assign(patch, {
          material_id: sid(ch.nextItem),
          material_name: sid(item.material_name || item.material_code || ""),
          gd_material_desc: ch.desc
        });
      }
      if (uomMoved) {
        // GD_funcProcessGDLineItem sets both UOM columns from the SO line, and
        // code_node_GKc0ALEe divides/multiplies gd_qty by the two conversions to get
        // packing_qty and net_weight -- but formats neither, so they are written to
        // decimal(65,3) already rounded here.
        patch.gd_order_uom_id = newUom;
        patch.good_delivery_uom_id = newUom;
        patch.packing_conversion = num(ch.packingConv).toFixed(8);
        patch.weight_conversion = num(ch.weightConv).toFixed(8);
        patch.packing_uom = sid(ch.packingUom);
        patch.gd_initial_delivered_qty = initDel.toFixed(8);
      }
      allocRequests.push({
        key: sid(h.gd.id) + "|" + gdLineId,
        gd_id: sid(h.gd.id), gd_line_id: gdLineId,
        material_id: nextItemId, quantity: finalQty,
        plant_id: sid(h.gd.plant_id), organization_id: sid(h.gd.organization_id),
        existingAllocationData: [], orderUomId: newUom,
        parent_line_id: soLineId, currentDocId: sid(h.gd.id),
        label: label, gd_no: sid(h.gd.delivery_no)
      });
    } else {
      const baseFactor = baseFactorFor(itemById[sid(line.material_id)],
                                       line.gd_order_uom_id || ch.uomId,
                                       curQty, q8(line.base_qty));
      if (finalQty > curQty + 0.0005) {
        patch.gd_qty = finalQty.toFixed(8);
        patch._reallocate = 1;
        patch._baseFactor = baseFactor;
        allocRequests.push({
          key: sid(h.gd.id) + "|" + gdLineId,
          gd_id: sid(h.gd.id), gd_line_id: gdLineId,
          material_id: sid(line.material_id), quantity: q8(finalQty - curQty),
          plant_id: sid(h.gd.plant_id), organization_id: sid(h.gd.organization_id),
          // The row's own entries are handed back as existing so the allocator never
          // re-serves stock this delivery already holds, and picked entries stay put.
          existingAllocationData: entries.map((e) => ({
            location_id: e.location_id, batch_id: e.batch_id,
            handling_unit_id: e.handling_unit_id, quantity: num(e.gd_quantity)
          })),
          orderUomId: sid(line.gd_order_uom_id || ch.uomId),
          parent_line_id: soLineId, currentDocId: sid(h.gd.id),
          label: label, gd_no: sid(h.gd.delivery_no)
        });
      } else {
        // Restated even when the delivery quantity does not move -- the row is being
        // written anyway, and a base_qty that disagrees with gd_qty hands
        // ReorderRedisWorkflow a wrong UOM factor (it divides one by the other).
        patch.gd_qty = finalQty.toFixed(8);
        patch.base_qty = q8(finalQty * baseFactor).toFixed(8);
        if (finalQty < curQty - 0.0005) {
          const trimmed = trimAllocation(entries, pickedEntries, finalQty, "gd_quantity");
          patch.temp_qty_data = JSON.stringify(trimmed.entries);
          patch._viewStock = 1;   // the allocation moved, so the summary is stale
        }
      }
    }

    // code_node_GKc0ALEe recomputes packing_qty and net_weight from gd_qty but only
    // FORMATS base_qty and gd_delivered_qty, so a stale pair would survive the save --
    // and ReorderRedisWorkflow reads base_qty/gd_qty as the line's UOM factor.
    patch.gd_delivered_qty = q8(initDel + finalQty).toFixed(8);
    patch.gd_undelivered_qty = q8(Math.max(0, ch.nextQty - initDel - finalQty)).toFixed(8);
    ed.rows[gdLineId] = Object.assign(ed.rows[gdLineId] || {}, patch);
  }

  // ---- Picking Plan -------------------------------------------------------------
  const ppLive = ppHits.filter((h) => {
    const st = sid(h.pp.to_status);
    return st !== "Cancelled" && st !== "Completed" && st !== "Draft";
  });
  for (const h of ppLive) {
    touched = 1;
    const line = h.line;
    const ppLineId = sid(line.id);
    const ed = editFor(ppEdits, sid(h.pp.id), h.pp);
    const curQty = q8(line.to_qty);
    const curOrder = q8(line.to_order_quantity);
    const pickedQty = q8(line.picked_qty);
    const entries = parseArr(line.temp_qty_data);
    const pickedEntries = parseArr(line.picked_temp_qty_data);

    if (ch.kind === "removed") { ed.drops[ppLineId] = 1; continue; }
    if (ch.kind === "price") {
      ed.rows[ppLineId] = Object.assign(ed.rows[ppLineId] || {}, {
        unit_price: num(ch.nextPrice).toFixed(8),
        total_price: num(ch.nextAmount).toFixed(8)
      });
      continue;
    }
    if (ch.kind === "swap") {
      // A plan holds its allocation against a specific item -- bins, batches, and
      // whatever has been picked out of them. Nothing here can re-allocate the new
      // item at the plan's plant, and a line handed over with an empty allocation is
      // rejected before the plan's own reconcile ever reads it. Refused with the plan
      // named, rather than failing somewhere inside its save.
      return block("Item " + label + " is planned on " +
        sid(h.pp.to_id || h.pp.to_no) +
        ". Change the item on that Picking Plan first, or cancel it.");
    }
    if (uomRestate) {
      // The plan counts its allocation in the OLD unit and the base quantity has moved,
      // so restating it needs a fresh allocation at the plan's plant -- which only the
      // delivery path can request here. Refused with the plan named.
      return block("Item " + label + " is planned on " +
        sid(h.pp.to_id || h.pp.to_no) +
        ". Change the unit of measure on that Picking Plan first, or cancel it.");
    }
    const patch = { to_order_quantity: q8(ch.nextQty).toFixed(8) };
    if (ch.priceChanged) {
      patch.unit_price = num(ch.nextPrice).toFixed(8);
      patch.total_price = num(ch.nextAmount).toFixed(8);
    }
    const ceiling = q8(Math.max(0, ch.nextQty - num(ch.deliveredQty)));
    if (q8(ch.nextQty) < curOrder - 0.0005) {
      const target = q8(Math.min(curQty, ceiling));
      if (target < curQty - 0.0005) {
        patch.to_qty = target.toFixed(8);
        patch.temp_qty_data = JSON.stringify(
          trimAllocation(entries, pickedEntries, target, "to_quantity").entries
        );
        patch._viewStock = 1;   // the allocation moved, so the summary is stale
      }
    }
    ed.rows[ppLineId] = Object.assign(ed.rows[ppLineId] || {}, patch);
  }

  if (touched) affected.push(soLineId);
}

// A confirm must be answered before anything is written, so it outranks the work.
if (needRaise) {
  return {
    blockCode: "414", blocked: 1, blockSignal: 3, blockKind: "confirmRaise",
    blockMessage: "The order quantity went up on:<br><br>" + raiseLines.join("<br>") +
      "<br><br>Add the extra quantity to the delivery that is already Created, or leave it outstanding for a later delivery?",
    gdDrafts: [], ppDrafts: [], allocRequests: [], affectedSoLineIds: ["0"], hasWork: 0
  };
}
// A pick REVERSAL is deliberately NOT detected here. GD's code_pick_reconcile works off
// the Picking's own records, whereas the GD line's picked_qty column is only maintained
// when allow_full_picking is on -- a detector here is blind in the default configuration.
// GD returns its 413 before its own write, so the cascade relays that question instead.

// ---- materialise the drafts ------------------------------------------------------
const applyRows = (doc, tableKey, ed, isBundleParent) => {
  const copy = JSON.parse(JSON.stringify(doc));
  const walk = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const id = sid(row.id);
      if (ed.drops[id]) return null;
      const patched = Object.assign({}, row, ed.rows[id] || {});
      if (Array.isArray(row.children)) {
        patched.children = walk(row.children).filter((c) => c);
      }
      // A bundle parent whose children are all gone has nothing left to deliver.
      if (isBundleParent(patched) && Array.isArray(patched.children) && !patched.children.length) {
        return null;
      }
      return patched;
    }).filter((r) => r);
  copy[tableKey] = walk(copy[tableKey]);
  return copy;
};

const gdDrafts = [];
Object.keys(gdEdits).forEach((gdId) => {
  const ed = gdEdits[gdId];
  const draft = applyRows(ed.doc, "table_gd", ed,
    (r) => r.item_bundle_id && !r.material_id);
  const stockRows = flat(draft.table_gd).filter((r) => r && r.material_id);
  if (!stockRows.length) {
    gdDrafts.push({ empty: 1, gd_no: sid(ed.doc.delivery_no) });
    return;
  }
  draft.gd_status = "Created";
  gdDrafts.push({
    gd_id: gdId, gd_no: sid(ed.doc.delivery_no), empty: 0,
    // Ordered so the delivery most likely to refuse runs while nothing is written yet.
    pickWeight: flat(draft.table_gd).reduce((s, r) => s + num(r && r.picked_qty), 0),
    allData: draft
  });
});
const emptied = gdDrafts.filter((g) => g.empty === 1);
if (emptied.length) {
  return block("Removing that line would leave delivery " +
    emptied.map((g) => g.gd_no).join(", ") +
    " with nothing to deliver. Cancel that delivery first.");
}
gdDrafts.sort((a, b) => b.pickWeight - a.pickWeight);

const ppDrafts = [];
Object.keys(ppEdits).forEach((ppId) => {
  const ed = ppEdits[ppId];
  const draft = applyRows(ed.doc, "table_to", ed, (r) => r.item_bundle_id && !r.material_id);
  const stockRows = flat(draft.table_to).filter((r) => r && r.material_id);
  if (!stockRows.length) return;
  draft.to_status = "Created";
  ppDrafts.push({ pp_id: ppId, pp_no: sid(ed.doc.to_id || ed.doc.to_no), allData: draft });
});

return {
  blockCode: "", blocked: 0, blockSignal: 0, blockKind: "", blockMessage: "",
  gdDrafts: gdDrafts, ppDrafts: ppDrafts, allocRequests: allocRequests,
  affectedSoLineIds: affected.length ? affected : ["0"],
  hasWork: gdDrafts.length || ppDrafts.length ? 1 : 0
};

};
const run_cdPlan = function (SRC, P) { return __json(cdPlan(__V(__T_cdPlan, SRC, P))); };
const __T_cdAllocReq = ["workflowparams:passNo","node:code_cd_plan.data.allocRequests","node:code_cd_diff.data.changes","node:search_cd_gds.data.data","node:get_cd_setup.data.data"];
const cdAllocReq = function (V) {
// Builds the GLOBAL_ALLOCATION request list. Append mode allocates each new line from
// scratch; adjust mode's requests were already built by code_cd_plan. Either way this
// node owns every picking_setup-derived parameter, so the loop hands the allocator a
// complete request.
// A literal string in a workflow-node's body_params is evaluated by MVEL, and a value
// that collides with a builtin -- "append" does -- arrives as a function reference, not
// a string. The pass is discriminated by an int, which MVEL cannot resolve to anything.
const isAppend = Number(V["workflowparams:passNo"]) === 2;
const planned = V["node:code_cd_plan.data.allocRequests"] || [];
const changes = V["node:code_cd_diff.data.changes"] || [];
const rawGds = V["node:search_cd_gds.data.data"];
const rawSetup = V["node:get_cd_setup.data.data"];

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const sid = (v) => String(v === null || v === undefined ? "" : v);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
// 8dp is the maximum configurable column precision: every GD / Picking Plan column this
// node writes is precision 8, so rounding there keeps the client's scale and kills residue.
const q8 = (v) => Number((num(v) || 0).toFixed(8));
const setup = asArray(rawSetup)[0] || {};

// The same defaults GDheadWorkflow's code_node_Htpcyp8t applies.
const enrich = (r) => Object.assign({}, r, {
  allocationStrategy: String(setup.default_strategy_id || "RANDOM"),
  huPriority: String(setup.hu_priority || "Loose First"),
  splitPolicy: String(setup.split_policy || "ALLOW_SPLIT"),
  allowMixedItem: setup.allow_mixed_item === 0 ? 0 : 1,
  lineMaterials: [String(r.material_id || "")],
  huData: []
});

if (!isAppend) { return { requests: planned.map(enrich) }; }

const gds = asArray(rawGds).filter((g) => sid(g.gd_status) === "Created");
if (gds.length !== 1) { return { requests: [] }; }
const gd = gds[0];

const requests = changes
  .filter((c) => c.kind === "added")
  .map((c) => ({
    key: "append|" + sid(c.soLineId),
    gd_id: sid(gd.id), gd_line_id: "",
    material_id: sid(c.nextItem),
    quantity: q8(Math.max(0, num(c.nextQty) - num(c.deliveredQty) - num(c.plannedQty))),
    plant_id: sid(gd.plant_id), organization_id: sid(gd.organization_id),
    existingAllocationData: [], orderUomId: sid(c.uomId),
    parent_line_id: sid(c.soLineId), currentDocId: sid(gd.id),
    label: c.desc || c.itemCode || sid(c.soLineId), gd_no: sid(gd.delivery_no)
  }))
  .filter((r) => r.quantity > 0.0005);

return { requests: requests.map(enrich) };

};
const run_cdAllocReq = function (SRC, P) { return __json(cdAllocReq(__V(__T_cdAllocReq, SRC, P))); };
const __T_cdPayloads = ["workflowparams:passNo","node:code_cd_plan.data.gdDrafts","node:code_cd_plan.data.ppDrafts","node:code_cd_diff.data.changes","node:get_cd_alloc_final.data","node:search_cd_gds.data.data","node:sql_node_CdItems.data","node:search_cd_bins.data.data","node:search_cd_uoms.data.data","node:search_cd_batches.data.data"];
const cdPayloads = function (V) {
// Splice the allocation results into the drafts. In append mode the new SO lines are
// turned into GD rows here, because only now do they carry a persisted row id.
// A literal string in a workflow-node's body_params is evaluated by MVEL, and a value
// that collides with a builtin -- "append" does -- arrives as a function reference, not
// a string. The pass is discriminated by an int, which MVEL cannot resolve to anything.
const isAppend = Number(V["workflowparams:passNo"]) === 2;
const drafts = V["node:code_cd_plan.data.gdDrafts"] || [];
const ppDrafts = V["node:code_cd_plan.data.ppDrafts"] || [];
const changes = V["node:code_cd_diff.data.changes"] || [];
const rawAlloc = V["node:get_cd_alloc_final.data"];
const rawGds = V["node:search_cd_gds.data.data"];
const rawItems = V["node:sql_node_CdItems.data"];

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const sid = (v) => String(v === null || v === undefined ? "" : v);
// 8dp is the maximum configurable column precision: every GD / Picking Plan column this
// node writes is precision 8, so rounding there keeps the client's scale and kills residue.
const q8 = (v) => Number((num(v) || 0).toFixed(8));
const flat = (rows) =>
  (Array.isArray(rows) ? rows : []).flatMap((r) =>
    [r].concat(Array.isArray(r && r.children) ? r.children : [])
  );
const parseArr = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) { return []; }
};

let allocResults = [];
if (rawAlloc) { allocResults = typeof rawAlloc === "string" ? JSON.parse(rawAlloc) : rawAlloc; }
if (!Array.isArray(allocResults)) allocResults = [];

// ---- view_stock ------------------------------------------------------------------
// The delivery renders this as its stock summary, and PickingProcessWorkflow parses
// the UOM back out of it -- so a row whose allocation moved must be RESTATED, not
// blanked and not left naming the old item. Same layout GDheadWorkflow's
// code_node_hifFKzmo produces for a form-side allocation.
const bins = asArray(V["node:search_cd_bins.data.data"]);
const uomRows = asArray(V["node:search_cd_uoms.data.data"]);
const batchRows = asArray(V["node:search_cd_batches.data.data"]);
const nameOf = (rows, id, field) => {
  const hit = rows.find((x) => sid(x.id) === sid(id));
  return hit && hit[field] ? String(hit[field]) : sid(id);
};
const buildViewStock = (entries, uomId, qtyField) => {
  // A delivery counts in gd_quantity, a plan in to_quantity -- see trimAllocation.
  const F = qtyField || "gd_quantity";
  const list = Array.isArray(entries) ? entries : [];
  const total = q8(list.reduce((s, e) => s + num(e[F]), 0));
  if (total <= 0) { return ""; }
  const un = nameOf(uomRows, uomId, "uom_name");
  const loose = list.filter((e) => !e.handling_unit_id);
  const hus = list.filter((e) => e.handling_unit_id);
  const line = (e, idx) => {
    let l = (idx + 1) + ". " + nameOf(bins, e.location_id, "bin_location_combine") +
            ": " + num(e[F]) + " " + un;
    if (e.handling_unit_id) { l += " [HU: " + sid(e.handling_unit_id) + "]"; }
    if (e.batch_id) { l += "\n[Batch: " + nameOf(batchRows, e.batch_id, "batch_number") + "]"; }
    return l;
  };
  let out = "Total: " + total + " " + un + "\n\n";
  if (hus.length && loose.length) {
    out += "LOOSE STOCK:\n";
    loose.forEach((e, i) => { out += line(e, i) + "\n"; });
    out += "\nHANDLING UNIT:\n";
    hus.forEach((e, i) => { out += line(e, i) + "\n"; });
  } else if (hus.length) {
    out += "HANDLING UNIT:\n";
    hus.forEach((e, i) => { out += line(e, i) + "\n"; });
  } else {
    out += "DETAILS:\n";
    loose.forEach((e, i) => { out += line(e, i) + "\n"; });
  }
  return out;
};

const failed = allocResults.filter((r) => r && String(r.code) !== "200" && String(r.code) !== "206");
if (failed.length) {
  const lead = isAppend
    ? "The sales order was saved, but the new line could not be added to the delivery:<br><br>"
    : "";
  return {
    gdPayloads: [], ppPayloads: [], allocFailed: 1, allocBlockKind: "block",
    allocMessage: lead + failed
      .map((f) => (f.label || "item") + " on " + (f.gd_no || "the delivery") + ": " +
        (f.message || "could not be allocated"))
      .join("<br>")
  };
}
const allocByKey = {};
allocResults.forEach((r) => { if (r && r.key) allocByKey[sid(r.key)] = r; });

// GLOBAL_ALLOCATION returns balances; temp_qty_data wants the GD-shaped record
// (same fields code_node_hifFKzmo writes in GDheadWorkflow).
const toTempEntry = (alloc, materialId, plantId, orgId) => {
  const rec = {
    material_id: sid(materialId),
    location_id: alloc.location_id,
    batch_id: alloc.batch_id || null,
    unrestricted_qty: alloc.original_unrestricted_qty || alloc.unrestricted_qty,
    plant_id: sid(plantId),
    organization_id: sid(orgId),
    is_deleted: 0,
    gd_quantity: num(alloc.gd_quantity),
    balance_id: alloc.balance_id || ""
  };
  if (alloc.source === "hu" && alloc.handling_unit_id) {
    rec.handling_unit_id = alloc.handling_unit_id;
  }
  return rec;
};

// The header total is each line's whole-order amount prorated by the quantity this
// document actually carries -- the same arithmetic GDconfirmDialog and PPconfirmDialog
// apply in the form, and what the credit check reads. Shared by the adjust and the
// append pass: the adjust pass used to restate gd_qty and leave gd_total at its
// pre-edit value, so every quantity cascade left the delivery's money stale.
const prorate = (rows, orderField, qtyField) =>
  q8(flat(rows).reduce((s, r) => {
    const orderQty = num(r[orderField]);
    return orderQty > 0 ? s + (num(r.total_price) / orderQty) * num(r[qtyField]) : s;
  }, 0));

// A plan reduced through the cascade had its temp_qty_data rewritten but never its
// summary, so the line read the OLD quantity. This runs before every return below --
// the no-delivery case leaves through an early one.
ppDrafts.forEach((d) => {
  flat((d.allData || {}).table_to).forEach((row) => {
    if (!row || !row._viewStock) return;
    delete row._viewStock;
    row.view_stock = buildViewStock(
      parseArr(row.temp_qty_data), row.to_order_uom_id || row.to_uom_id, "to_quantity");
  });
  if (d.allData) {
    d.allData.to_total = prorate(d.allData.table_to, "to_order_quantity", "to_qty");
  }
});

const gdPayloads = [];
drafts.forEach((d) => {
  const allData = d.allData;
  flat(allData.table_gd).forEach((row) => {
    if (!row || !row._reallocate) return;
    const res = allocByKey[sid(d.gd_id) + "|" + sid(row.id)];
    const baseFactor = num(row._baseFactor) || 1;
    const wantsSummary = row._reallocate || row._viewStock;
    delete row._reallocate;
    delete row._baseFactor;
    delete row._viewStock;
    if (!res) {
      // Trimmed rather than re-allocated: its entries are already final here.
      if (wantsSummary) {
        row.view_stock = buildViewStock(
          parseArr(row.temp_qty_data), row.gd_order_uom_id, "gd_quantity");
      }
      return;
    }
    const fresh = asArray(res.allocationData).map((a) =>
      toTempEntry(a, row.material_id, allData.plant_id, allData.organization_id));
    // A raise appends, so every entry the picker already worked stays byte-identical.
    const kept = parseArr(row.temp_qty_data);
    const merged = kept.concat(fresh);
    row.temp_qty_data = JSON.stringify(merged);
    // The allocator can return less than asked, so every qty-derived field is restated
    // from the merged total rather than from the target the plan node assumed.
    const finalQty = q8(merged.reduce((s, e) => s + num(e.gd_quantity), 0));
    const initDel = num(row.gd_initial_delivered_qty);
    row.gd_qty = finalQty.toFixed(8);
    row.base_qty = q8(finalQty * baseFactor).toFixed(8);
    row.gd_delivered_qty = q8(initDel + finalQty).toFixed(8);
    row.gd_undelivered_qty =
      q8(Math.max(0, num(row.gd_order_quantity) - initDel - finalQty)).toFixed(8);
    const huRows = merged.filter((e) => e.handling_unit_id);
    row.view_stock = buildViewStock(merged, row.gd_order_uom_id, "gd_quantity");
    if (huRows.length) {
      row.temp_hu_data = JSON.stringify(huRows.map((e) => ({
        row_type: "item", handling_unit_id: e.handling_unit_id,
        material_id: e.material_id, location_id: e.location_id,
        batch_id: e.batch_id || null, balance_id: e.balance_id || "",
        deliver_quantity: num(e.gd_quantity), item_quantity: num(e.unrestricted_qty)
      })));
    }
  });
  // A row the plan node trimmed carries no allocation result of its own.
  flat(allData.table_gd).forEach((row) => {
    if (row && row._viewStock) {
      row.view_stock = buildViewStock(parseArr(row.temp_qty_data), row.gd_order_uom_id);
      delete row._viewStock;
    }
  });
  allData.gd_total = prorate(allData.table_gd, "gd_order_quantity", "gd_qty");
  gdPayloads.push({ gd_id: d.gd_id, gd_no: d.gd_no, allData: allData, lineCount: flat(allData.table_gd).length });
});

// ---- append mode: new SO lines join the single Created GD -------------------------
if (isAppend) {
  const gds = asArray(rawGds).filter((g) => sid(g.gd_status) === "Created");
  const items = asArray(rawItems);
  // Get Items hands table_uom_conversion back as a JSON_ARRAYAGG string.
  const parseConv = (v) => {
    if (Array.isArray(v)) return v;
    if (!v) return [];
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
  };
  const itemById = {};
  items.forEach((i) => {
    if (i && i.id)
      itemById[sid(i.id)] = { ...i, table_uom_conversion: parseConv(i.uom_conversion_json) };
  });
  const uomFactor = (item, uomId) => {
    if (!item) { return 1; }
    if (sid(item.based_uom) === sid(uomId)) { return 1; }
    const rows = Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion : [];
    const conv = rows.find((c) => sid(c.alt_uom_id) === sid(uomId));
    return conv && parseFloat(conv.base_qty) ? parseFloat(conv.base_qty) : 1;
  };
  const added = changes.filter((c) => c.kind === "added");
  if (!gds.length || !added.length) {
    return { gdPayloads: gdPayloads, ppPayloads: ppDrafts, allocFailed: 0, allocBlockKind: "", allocMessage: "" };
  }
  if (gds.length > 1) {
    return {
      gdPayloads: [], ppPayloads: [], allocFailed: 1, allocBlockKind: "block",
      allocMessage: "The sales order was saved, but it has more than one delivery still at Created (" +
        gds.map((g) => sid(g.delivery_no)).join(", ") +
        "), so the new line was not added to any of them. Add it to the right delivery manually."
    };
  }
  const gd = JSON.parse(JSON.stringify(gds[0]));
  added.forEach((ch) => {
    const res = allocByKey["append|" + sid(ch.soLineId)];
    const item = itemById[sid(ch.nextItem)] || {};
    const entries = res
      ? asArray(res.allocationData).map((a) =>
          toTempEntry(a, ch.nextItem, gd.plant_id, gd.organization_id))
      : [];
    const qty = q8(entries.reduce((s, e) => s + num(e.gd_quantity), 0));
    const huRows = entries.filter((e) => e.handling_unit_id);
    gd.table_gd = (Array.isArray(gd.table_gd) ? gd.table_gd : []).concat([Object.assign({}, ch.soLine || {}, {
      material_id: sid(ch.nextItem),
      material_name: sid(item.material_name || ch.itemCode || item.material_code || ""),
      gd_material_desc: ch.desc,
      so_line_item_id: sid(ch.soLineId),
      line_so_id: sid(gd.so_id && gd.so_id[0] ? gd.so_id[0] : gd.so_id),
      line_so_no: sid(gd.so_no),
      gd_order_quantity: q8(ch.nextQty).toFixed(8),
      gd_order_uom_id: sid(ch.uomId),
      good_delivery_uom_id: sid(ch.uomId),
      base_uom_id: sid(item.based_uom),
      item_costing_method: sid(item.material_costing_method),
      gd_initial_delivered_qty: q8(ch.deliveredQty).toFixed(8),
      gd_qty: qty.toFixed(8),
      base_qty: q8(qty * uomFactor(item, ch.uomId)).toFixed(8),
      gd_delivered_qty: q8(num(ch.deliveredQty) + qty).toFixed(8),
      gd_undelivered_qty: q8(Math.max(0, num(ch.nextQty) - num(ch.deliveredQty) - qty)).toFixed(8),
      temp_qty_data: JSON.stringify(entries),
      view_stock: buildViewStock(entries, ch.uomId),
      temp_hu_data: JSON.stringify(huRows.map((e) => ({
        row_type: "item", handling_unit_id: e.handling_unit_id,
        material_id: e.material_id, location_id: e.location_id,
        batch_id: e.batch_id || null, balance_id: e.balance_id || "",
        deliver_quantity: num(e.gd_quantity), item_quantity: num(e.unrestricted_qty)
      }))),
      temp_excess_data: "[]",
      // SOonChangeUOM already stated these for the line's unit; GDheadWorkflow derives
      // packing_qty and net_weight from them.
      packing_uom: ch.packingUom || null,
      packing_conversion: num(ch.packingConv) || 1,
      weight_conversion: num(ch.weightConv),
      picking_status: "Created"
    })]);
  });
  gd.gd_total = prorate(gd.table_gd, "gd_order_quantity", "gd_qty");
  gd.gd_status = "Created";
  return {
    gdPayloads: [{ gd_id: sid(gd.id), gd_no: sid(gd.delivery_no), allData: gd, lineCount: flat(gd.table_gd).length }],
    ppPayloads: [], allocFailed: 0, allocBlockKind: "", allocMessage: ""
  };
}

return { gdPayloads: gdPayloads, ppPayloads: ppDrafts, allocFailed: 0, allocBlockKind: "", allocMessage: "" };

};
const run_cdPayloads = function (SRC, P) { return __json(cdPayloads(__V(__T_cdPayloads, SRC, P))); };

// ---- SO Save V2 rules
// SO Save V2 - the column rules and the cell comparison shared by SO_SAVE_PREPARE and SO_SAVE_COMMIT (included by
// scripts/build-so-save-v2.mjs after common.js).

// written by other documents (handoff 6.1): never in the plan of an edit
const SO_HEADER_OWNED = ["gd_status", "si_status", "production_status", "sr_status", "srr_status", "posted_status", "si_posted_status", "partially_delivered", "fully_delivered",
  "to_status", "packing_status", "is_processing"];
const SO_HEADER_NUMBER = ["so_no", "so_no_type"]; // decided by COMMIT S0N from the stored record
const SO_LINE_OWNED = ["planned_qty", "delivered_qty", "invoice_qty", "posted_qty", "si_status", "return_qty", "production_planned_qty", "production_qty", "production_status",
  "packing_status", "packing_no", "hu_no"];
const SO_LINE_SYSTEM = ["id", "sales_order_id", "parent_id", "create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "tenant_id"];

// A cell's comparable text: null / absent / "" alike; numbers by their decimal text (2300 = "2300.00000000", ids exact);
// JSON (objects, arrays, JSON text) by its key-sorted text. Two cells differ only when these differ; a spurious
// difference costs one write of the value classic would have written anyway.
const soCanonJson = function soCanonJson(v) {
  if (Array.isArray(v)) return "[" + v.map(soCanonJson).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + soCanonJson(v[k])).join(",") + "}";
  return soCanon(v);
};
const soCanon = function soCanon(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") return "J" + soCanonJson(v);
  const t = String(v).trim();
  const m = t.match(/^([-+]?)(\d+)(?:\.(\d*))?$/);
  if (m) {
    const int = m[2].replace(/^0+(?=\d)/, "");
    const frac = (m[3] || "").replace(/0+$/, "");
    const body = int + (frac ? "." + frac : "");
    return (m[1] === "-" && body !== "0" ? "-" : "") + body;
  }
  if (/^[\[{]/.test(t)) {
    try {
      return "J" + soCanonJson(JSON.parse(t));
    } catch (e) {
      /* plain text */
    }
  }
  return t;
};
const soSame = (a, b) => soCanon(a) === soCanon(b);

// ---- SO_SAVE_PREPARE
// SO_SAVE_PREPARE phase SO (PREPARE-A) - the SO side of a queued save: the stored request applied through classic SO_SAVE's
// own line computation (lifted), then a cell-level write plan against the stored SO, stored as parts for SO_SAVE_COMMIT.
// Nothing here writes the sales order. The lifted classic nodes (run_<name>, see scripts/build-so-save-v2.mjs):
//   run_soX4 code_node_X4j8BSXd, run_soDraftNo code_node_hVnUCBf3, run_soFilter code_node_rPqQy5CD,
//   run_soGate code_node_CascadeGate, run_soFill code_node_BtxYhPym, run_cfNeed code_node_CfNeed1,
//   run_cfFill code_node_CfFill1, run_cfOut code_node_CfOut1, run_soItemIds code_node_JYYVm92x.
// Generated above this file by the build: SO_HEADER_EDIT / SO_HEADER_ADD (the live update / add node props) and
// SO_LINE_FIELDS (the line table's schema fields); rules.js: the column rules and soCanon / soSame.

const SO_PLAN_OPS = 250; // line ops per plan part

// the job's prepared_payload.stage -> the step this call runs ("" = a fresh job: the SO plan)
const SO_PREP_STEPS = ["SO", "CASCADE", "ALLOC", "PAYLOAD"];

const soPrepBase = function soPrepBase() {
  return { route: "", code: "", message: "", reason: "", tenantId: "0", jobIdSql: "0", rowVersion: -1, phase: "", nonce: "" };
};

// Guard: the worker's call. inp: { jobId, rowVersion, phase, tenantId, uuid }.
const soPrepareGuard = function soPrepareGuard(inp) {
  const out = soPrepBase();
  out.nonce = s(inp.uuid).replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
  const reject = (why) => Object.assign(out, answer("REJECT", "400", why));
  if (!digits(inp.tenantId)) return reject("no session tenant");
  out.tenantId = s(inp.tenantId);
  if (!digits(inp.jobId)) return reject("job_id: digits");
  out.jobIdSql = s(inp.jobId);
  if (!/^[0-9]{1,9}$/.test(s(inp.rowVersion))) return reject("row_version: the worker's claim");
  out.rowVersion = Number(s(inp.rowVersion));
  // the step comes from the job (prepared_payload.stage); a phase given must match it
  out.phase = s(inp.phase).toUpperCase();
  if (out.phase && SO_PREP_STEPS.indexOf(out.phase) < 0) return reject("phase must be one of " + SO_PREP_STEPS.join(", ") + " (or empty)");
  if (!out.nonce) return reject("no run nonce");
  return Object.assign(out, answer("GO", "", ""));
};

// Gate: the job and its SO as stored. GO only for this job's claim (PREPARING at the caller's row version), an edit's SO
// still flagged under this job's lock, and what the step reads present (the request parts; the cascade parts). Not our
// claim -> STOP, nothing written. step: what this call runs, from prepared_payload.stage.
const soPrepareGate = function soPrepareGate(guard, factRows) {
  const f = list(factRows)[0] || {};
  const rp = soParse(f.request_payload) || {};
  const pp = soParse(f.prepared_payload) || {};
  const stage = s(pp.stage);
  const out = { route: "STOP", code: "409", message: "", reason: "", dbNow: s(f.db_now), jobId: s(f.job_id), soId: "0", isEdit: "NO", requestNonce: "", parts: 0,
    organizationId: digits(f.organization_id) ? s(f.organization_id) : "0", needJob: "NO", needUnlock: "NO", jobRows: [], unlockRows: [], stage: stage,
    step: stage === "" ? "SO" : stage, preparedPayload: s(f.prepared_payload), cRef: "", xRef: "" };
  if (!s(f.job_id)) return Object.assign(out, { code: "404", message: "Save job not found" });
  if (s(f.job_status) !== "PREPARING" || num(f.row_version) !== guard.rowVersion) {
    return Object.assign(out, { message: "Not this worker's claim (job " + s(f.job_status) + ", row version " + num(f.row_version) + ")", reason: "claim" });
  }
  out.isEdit = s(f.correlation_id).indexOf("SO|") === 0 ? "YES" : "NO";
  out.requestNonce = s(rp.nonce);
  out.parts = num(rp.parts);
  const fail = (code, why, unlock) => Object.assign(out, {
    route: "FAIL", code: "500", message: why, reason: code, needJob: "YES", needUnlock: unlock ? "YES" : "NO", unlockRows: unlock ? [{ id: out.soId, is_processing: 0 }] : [],
    jobRows: [{ id: out.jobId, job_status: "FAILED", progress_percent: 100, progress_message: "Not saved: " + why, prepared_payload: "", error_code: code, error_message: why,
      finished_at: out.dbNow }] });
  if (SO_PREP_STEPS.indexOf(out.step) < 0) return Object.assign(out, { message: "Nothing to prepare (stage " + stage + ")", reason: "stage" });
  if (guard.phase && guard.phase !== out.step) return Object.assign(out, { message: "The job is at step " + out.step + ", not " + guard.phase, reason: "phase" });
  if (out.isEdit === "YES") {
    out.soId = (s(f.correlation_id).match(/^SO\|([0-9]+)$/) || [])[1] || "0";
    if (!s(f.so_id)) return fail("SOV2_NO_SO", "the sales order no longer exists", false);
    // the lock is ours only while the SO's latest LOCK row names this job; anything else is a writer we do not know
    if (num(f.is_processing) !== 1 || s(f.lock_ref) !== s(f.idempotency_key)) {
      return Object.assign(out, { route: "STOP", code: "409", message: "The sales order's lock is not this job's", reason: "lock" });
    }
  }
  // the nonce goes into SQL text: SUBMIT wrote it alphanumeric
  if (!/^[0-9A-Za-z]{1,24}$/.test(out.requestNonce) || !out.parts || num(f.part_rows) !== out.parts) {
    return fail("SOV2_PARTS", "the stored request is incomplete (" + num(f.part_rows) + " of " + out.parts + " parts)", out.isEdit === "YES");
  }
  if (out.step !== "SO" && out.isEdit !== "YES") return fail("SOV2_PARTS", "a new sales order has no deliveries to change", false);
  // the cascade parts' refs go into SQL text too
  const ref = (v, k) => (new RegExp("^" + k + "\\|[0-9A-Za-z]{1,24}$").test(s(v)) ? s(v) : "");
  out.cRef = ref(pp.cRef, "SOC");
  out.xRef = ref(pp.xRef, "SOX");
  if ((out.step === "ALLOC" || out.step === "PAYLOAD") && !out.cRef) return fail("SOV2_PARTS", "the delivery plan of this save is missing", true);
  return Object.assign(out, { route: "GO", code: "", message: "" });
};

// The request as SUBMIT stored it: R|000 the header, R|001... the top-level lines in order; the answers ride in allData
// the way classic takes them (need_cl and create_si already do).
const soPrepareAllData = function soPrepareAllData(partRows, answers) {
  const rows = list(partRows).slice().sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1));
  const head = soParse((rows[0] || {}).result_ref) || {};
  const lines = [];
  for (const r of rows.slice(1)) for (const l of list(soParse(r.result_ref))) lines.push(l);
  const a = answers || {};
  const allData = Object.assign({}, head, { table_so: lines });
  if (s(a.raiseGdQty)) allData.raiseGdQty = s(a.raiseGdQty);
  if (s(a.confirmPickReversal)) allData.confirmPickReversal = s(a.confirmPickReversal);
  return allData;
};

// Classic SO_SAVE's chain on the request, node for node (if_BA0MN7OZ: Draft or not; if_nvqMTmNn: an Issue edit reads the
// stored SO and the cascade gate; if_yJor3Xzv: an edit fills custom fields it left out). SRC holds each lifted node's
// output under its classic id, as the engine would. stored: the get-node record (an edit) or null.
const soPrepareNext = function soPrepareNext(allData, stored, docsRows, pkRows) {
  const P = { allData: allData };
  // a get-node's data: the record itself
  const getNode = { data: stored || null };
  const draft = allData.so_status == "Draft";
  const SRC = { workflow_node_yxaOreDk: { needApproval: "No" }, sql_node_PkItems: list(pkRows) };
  if (draft) SRC.code_node_hVnUCBf3 = run_soDraftNo({}, P);
  else {
    SRC.code_node_X4j8BSXd = run_soX4({}, P);
    SRC.code_node_rPqQy5CD = run_soFilter(SRC, P);
  }
  const issueEdit = !draft && s((SRC.code_node_rPqQy5CD.table || {}).page_status) === "Edit";
  if (issueEdit) {
    SRC.get_node_rvjWbHBF = getNode;
    SRC.sql_node_CascadeDocs = list(docsRows);
    SRC.code_node_CascadeGate = run_soGate(SRC, P);
  }
  SRC.code_node_BtxYhPym = run_soFill(SRC, P);
  if (s((SRC.code_node_BtxYhPym.entry || {}).page_status) === "Edit") {
    SRC.code_node_CfNeed1 = run_cfNeed(SRC, P);
    if (s(SRC.code_node_CfNeed1.need) === "YES") {
      SRC.get_node_CfStored1 = getNode;
      SRC.code_node_CfFill1 = run_cfFill(SRC, P);
    }
    SRC.code_node_CfOut1 = run_cfOut(SRC, P);
  }
  const next = Object.assign({}, SRC.code_node_BtxYhPym.entry);
  if (SRC.code_node_CfOut1) {
    next.table_so = SRC.code_node_CfOut1.lines;
    next.custom_fields_m07krnod = SRC.code_node_CfOut1.cf;
  }
  return { P: P, SRC: SRC, next: next, issueEdit: issueEdit, needsCascade: issueEdit ? num(SRC.code_node_CascadeGate.needsCascade) : 0 };
};

// Plan: classic's computation on the request, then the cells that differ from the stored SO.
// storedData: get_node_SPso's data (an edit), pkRows: the packing items, docsRows: the linked-documents flag.
const soPreparePlan = function soPreparePlan(guard, gate, partRows, factRows, storedData, docsRows, pkRows) {
  const f = list(factRows)[0] || {};
  const rp = soParse(f.request_payload) || {};
  const edit = gate.isEdit === "YES";
  const out = { route: "PLAN", code: "200", message: "", reason: "", planRows: [], jobRows: [], needUnlock: "NO", unlockRows: [], stage: "", planRef: "", planParts: 0,
    headerCells: 0, lineUpdates: 0, lineInserts: 0, lineDeletes: 0, needsCascade: 0 };
  const fail = (code, why) => Object.assign(out, {
    route: "FAIL", code: "500", message: why, reason: code, needUnlock: edit ? "YES" : "NO", unlockRows: edit ? [{ id: gate.soId, is_processing: 0 }] : [],
    jobRows: [{ id: gate.jobId, job_status: "FAILED", progress_percent: 100, progress_message: "Not saved: " + why, prepared_payload: "", error_code: code, error_message: why,
      finished_at: gate.dbNow }] });

  const allData = soPrepareAllData(partRows, rp.answers);
  const stored = edit ? (Array.isArray(storedData) ? storedData[0] : storedData) || null : null;
  if (edit && (!stored || s(stored.id) !== gate.soId)) return fail("SOV2_NO_SO", "the sales order could not be read");
  const run = soPrepareNext(allData, stored, docsRows, pkRows);
  const SRC = run.SRC;
  const P = run.P;
  const next = run.next;
  const needsCascade = run.needsCascade;

  // ---- the write plan
  const lineCols = SO_LINE_FIELDS.filter((c) => SO_LINE_SYSTEM.indexOf(c) < 0);
  const lineUpdCols = lineCols.filter((c) => SO_LINE_OWNED.indexOf(c) < 0);
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
  const header = { set: {}, before: {} };
  if (edit) {
    for (const c of SO_HEADER_EDIT) {
      if (c === "id" || c === "table_so" || SO_HEADER_OWNED.indexOf(c) >= 0 || SO_HEADER_NUMBER.indexOf(c) >= 0) continue;
      if (!has(next, c)) continue; // a key the request leaves out is never written
      if (soSame(next[c], stored[c])) continue;
      header.set[c] = next[c];
      header.before[c] = has(stored, c) ? stored[c] : null;
    }
  } else {
    for (const c of SO_HEADER_ADD) if (c !== "table_so" && has(next, c)) header.set[c] = next[c];
  }
  const storedLines = {};
  const storedOrder = [];
  for (const r of soFlatLines(stored ? stored.table_so : [])) {
    if (!s(r.id)) continue;
    storedLines[s(r.id)] = r;
    storedOrder.push(s(r.id));
  }
  const ops = [];
  const seen = {};
  const rowOf = (l, cols) => {
    const o = {};
    for (const c of cols) if (has(l, c)) o[c] = l[c];
    return o;
  };
  // a new SO (Add, Clone) inserts every line: a Clone's lines still carry the source SO's ids, which classic's insert
  // ignores too (new ids for the header and every line)
  const visit = (l, key, parentRef) => {
    const id = edit ? s(l.id) : "";
    if (id) {
      const was = storedLines[id];
      if (!was) return "a line of this sales order was removed by another save: reopen the sales order and save again";
      seen[id] = true;
      const set = {};
      const before = {};
      for (const c of lineUpdCols) {
        if (!has(l, c) || soSame(l[c], was[c])) continue;
        set[c] = l[c];
        before[c] = has(was, c) ? was[c] : null;
      }
      if (Object.keys(set).length) ops.push({ op: "U", id: id, set: set, before: before });
      return "";
    }
    ops.push({ op: "I", key: key, parent: parentRef, row: rowOf(l, lineCols) });
    return "";
  };
  const top = list(next.table_so);
  for (let i = 0; i < top.length; i++) {
    const key = "N" + (i + 1);
    const why = visit(top[i], key, "");
    if (why) return fail("SOV2_STALE", why);
    const parentRef = (edit ? s(top[i].id) : "") || key;
    const kids = list(top[i].children);
    for (let j = 0; j < kids.length; j++) {
      const w = visit(kids[j], key + "/" + (j + 1), parentRef);
      if (w) return fail("SOV2_STALE", w);
    }
  }
  for (const id of storedOrder) if (!seen[id]) ops.push({ op: "D", id: id, before: { is_deleted: 0, line_index: has(storedLines[id], "line_index") ? storedLines[id].line_index : null } });
  // pass B (classic code_node_CascadeB_Gate): an Issue edit adding an item line to a sales order a delivery or picking plan
  // names re-runs the cascade after the lines have ids; not in V2 yet (PLAN.md, COMMIT design) -> classic
  const docs = list(docsRows)[0];
  const linked = docs && docs.linked !== undefined && docs.linked !== null ? Number(docs.linked) : 1;
  if (SRC.code_node_CascadeGate && linked && ops.some((o) => o.op === "I" && s(o.row.item_name))) {
    return fail("SOV2_NOT_ELIGIBLE", "new lines on a sales order with deliveries: saved the classic way");
  }

  // ---- the parts
  // classic workflow_node_CIDWG583 (Issued): REORDER_SET_REDIS SO_ISSUED with previous_data = the stored table_so (an Issue
  // edit; else none) and latest_data = BtxYhPym's table_so. Its SO branch sums so_quantity by item + plant from five fields
  // of the top-level lines, so the lines whose five fields did not change add the same on both sides: only the others
  // are kept (the same deltas, a payload of the changed lines only).
  const five = (l) => ({ item_name: l.item_name, plant_id: l.plant_id, so_item_uom: l.so_item_uom, so_quantity: l.so_quantity, organization_id: l.organization_id });
  const prevTop = run.issueEdit ? list(stored && stored.table_so) : [];
  const latestTop = list(SRC.code_node_BtxYhPym.entry.table_so);
  const latestById = {};
  for (const l of latestTop) if (s(l.id)) latestById[s(l.id)] = l;
  const same = {};
  for (const l of prevTop) {
    const n = s(l.id) ? latestById[s(l.id)] : null;
    if (n && soCanonJson(five(l)) === soCanonJson(five(n))) same[s(l.id)] = true;
  }
  const reorder = { run: s(next.so_status) === "Issued" ? 1 : 0, prev: prevTop.filter((l) => !same[s(l.id)]).map(five),
    latest: latestTop.filter((l) => !same[s(l.id)]).map(five) };
  const after = {
    reorder: reorder,
    itemIds: list((run_soItemIds(SRC, P) || {}).itemIDs).map(String),
    sqtId: next.sqt_id === undefined ? null : next.sqt_id,
    soStatus: s(next.so_status),
    autoSi: num(next.auto_si),
    createSi: s(next.create_si),
    salesOrderTitle: s(allData.sales_order_title),
    needsCascade: needsCascade,
  };
  const head = { v: 1, mode: edit ? "EDIT" : "ADD", jobId: gate.jobId, soId: gate.soId, saveAs: s(rp.save_as), set: header.set, before: header.before,
    number: { so_no: next.so_no === undefined ? null : next.so_no, so_no_type: next.so_no_type === undefined ? null : next.so_no_type,
      stored_so_no: stored ? s(stored.so_no) : "", stored_so_status: stored ? s(stored.so_status) : "", stored_so_no_type: stored ? s(stored.so_no_type) : "" },
    // the lines the plan was made against: COMMIT S0 requires exactly these, S2 tells its own inserts from them
    storedLineIds: storedOrder };
  const ref = "SOP|" + guard.nonce;
  const part = (name, obj) => ({ job_id: ref, organization_id: gate.organizationId, step_name: name, step_status: "PART", attempt_count: 0, result_ref: JSON.stringify(obj) });
  const rows = [part("H|000", head)];
  for (let i = 0; i < ops.length; i += SO_PLAN_OPS) rows.push(part("L|" + ("00" + (rows.length)).slice(-3), ops.slice(i, i + SO_PLAN_OPS)));
  rows.push(part("A|000", after));
  const count = (k) => ops.filter((o) => o.op === k).length;
  Object.assign(out, { planRows: rows, planRef: ref, planParts: rows.length, headerCells: Object.keys(header.set).length, lineUpdates: count("U"), lineInserts: count("I"),
    lineDeletes: count("D"), needsCascade: needsCascade, stage: needsCascade ? "CASCADE" : "COMMIT" });
  const summary = { v: 1, plan: ref, parts: rows.length, stage: out.stage, mode: head.mode, headerCells: out.headerCells, lineUpdates: out.lineUpdates, lineInserts: out.lineInserts,
    lineDeletes: out.lineDeletes, needsCascade: needsCascade };
  out.jobRows = [{ id: gate.jobId, job_status: needsCascade ? "PREPARING" : "READY_TO_COMMIT", progress_percent: needsCascade ? 20 : 30,
    progress_message: needsCascade ? "Checking the deliveries of this sales order" : "Ready to save", prepared_payload: JSON.stringify(summary), error_code: "", error_message: "",
    finished_at: null }];
  out.message = out.jobRows[0].progress_message;
  return out;
};

// Result: whichever node ended the run.
const soPrepareResult = function soPrepareResult(guard, gate, src) {
  const g = gate || {};
  const r = src || {};
  const out = { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(g.jobId || guard.jobIdSql), job_status: "", stage: s(r.stage),
    plan_ref: s(r.planRef), plan_parts: String(num(r.planParts)), header_cells: String(num(r.headerCells)), line_updates: String(num(r.lineUpdates)),
    line_inserts: String(num(r.lineInserts)), line_deletes: String(num(r.lineDeletes)), needs_cascade: String(num(r.needsCascade)), evidence: "" };
  const jr = list(r.jobRows)[0];
  out.job_status = jr ? s(jr.job_status) : "";
  out.evidence = JSON.stringify({ v: 1, workflow: "SO_SAVE_PREPARE", phase: s(guard.phase), route: out.route, code: out.code, reason: out.reason, stage: out.stage });
  return out;
};

// ---- SO_SAVE_PREPARE cascade steps
// SO_SAVE_PREPARE cascade steps (PREPARE-B) - classic SO_CASCADE v27 pass A on the request, lifted node for node, but
// nothing is saved: the GD payloads are stored as parts for SO_SAVE_WORKER, which holds each one through GD Edit V2.
// Three worker calls (docs/lowcode/so-save-v2/PLAN.md, "PREPARE-B"): CASCADE (diff + plan + allocation requests), ALLOC
// (GLOBAL_ALLOCATION v34 in-process), PAYLOAD (classic's payloads). The lifted classic nodes (run_<name>):
//   SO_CASCADE: run_cdDiff code_cd_diff, run_cdPlan code_cd_plan, run_cdAllocReq code_cd_allocreq,
//     run_cdCollect code_cd_alloc_collect, run_cdNamesIds code_cd_names_ids, run_cdPayloads code_cd_payloads;
//   GLOBAL_ALLOCATION: run_gaItemNorm code_node_ItemNorm, run_gaExec code_node_hDa6pSw5;
//   SO_SAVE (B1 only, through soPrepareNext): the PREPARE-A chain.

const SO_SEARCH_PAGE = 10000; // the set-based allocation searches' limit: a full page means the read may be cut short

// The job row of a step's outcome; every row carries every column the update writes.
const soCascadeJobRow = function soCascadeJobRow(gate, o) {
  return Object.assign({ id: gate.jobId, job_status: "PREPARING", progress_percent: 20, progress_message: "", prepared_payload: gate.preparedPayload, error_code: "",
    error_message: "", error_details: "", confirmation_token: "", finished_at: null }, o);
};
const soCascadeSummary = function soCascadeSummary(gate, extra) {
  return JSON.stringify(Object.assign({}, soParse(gate.preparedPayload) || {}, extra));
};
// An outcome that ends the job: FAILED, the SO unlocked (nothing was written, no GD is held yet).
const soCascadeFail = function soCascadeFail(gate, out, code, message, details) {
  return Object.assign(out, { route: "FAIL", code: "500", message: message, reason: code, needUnlock: "YES", unlockRows: [{ id: gate.soId, is_processing: 0 }],
    jobRows: [soCascadeJobRow(gate, { job_status: "FAILED", progress_percent: 100, progress_message: "Not saved: " + message, error_code: code, error_message: message,
      error_details: details ? JSON.stringify(details) : "", finished_at: gate.dbNow })] });
};
const soCascadeOut = function soCascadeOut() {
  return { route: "", code: "200", message: "", reason: "", stage: "", jobRows: [], partRows: [], needUnlock: "NO", unlockRows: [], gdCount: 0, requestCount: 0, changeCount: 0 };
};
const soCascadePart = function soCascadePart(gate, ref, name, obj) {
  return { job_id: ref, organization_id: gate.organizationId, step_name: name, step_status: "PART", attempt_count: 0, result_ref: JSON.stringify(obj) };
};
const soCascadeParts = function soCascadeParts(rows, prefix) {
  return list(rows).filter((r) => s(r.step_name).indexOf(prefix) === 0).sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1)).map((r) => soParse(r.result_ref));
};

// B1 (stage CASCADE), node 1: the request and the stored SO through classic SO_SAVE's chain, then classic's
// CascadeGate -> SO_CASCADE inputs (prev / next table_so, the answers) and code_cd_diff.
const soCascadeDiff = function soCascadeDiff(gate, factRows, partRows, storedData, docsRows) {
  const f = list(factRows)[0] || {};
  const rp = soParse(f.request_payload) || {};
  const allData = soPrepareAllData(partRows, rp.answers);
  const stored = (Array.isArray(storedData) ? storedData[0] : storedData) || null;
  const out = { route: "DIFF", changeCount: 0, changes: [], materialIdCsv: "", emptyList: [], orgIdSafe: "", organizationId: s(allData.organization_id), raiseGdQty: "",
    confirmPickReversal: "", message: "" };
  if (!stored || s(stored.id) !== gate.soId) return Object.assign(out, { route: "NOSO", message: "the sales order could not be read" });
  const run = soPrepareNext(allData, stored, docsRows, []);
  const g = run.SRC.code_node_CascadeGate;
  if (!g) return Object.assign(out, { route: "NONE" }); // a Draft save: classic runs no cascade
  // workflow_node_CascadeA's params, as SO_SAVE sends them (passNo 1 = pass A)
  const P = { passNo: 1, so_id: g.soId, prev_table_so: g.prevTableSo, next_table_so: g.nextTableSo, confirmPickReversal: g.confirmPickReversal, raiseGdQty: g.raiseGdQty,
    organization_id: allData.organization_id };
  const d = run_cdDiff({}, P);
  return Object.assign(out, { changeCount: num(d.changeCount), changes: list(d.changes), materialIdCsv: s(d.materialIdCsv), emptyList: list(d.emptyList),
    orgIdSafe: s(d.orgIdSafe), raiseGdQty: s(g.raiseGdQty), confirmPickReversal: s(g.confirmPickReversal) });
};

// code_cd_plan + code_cd_allocreq on classic's reads (B1, and B3 again). gds / pps: the search rows; setupData: the
// get-node's data.
const soCascadePlanRun = function soCascadePlanRun(diff, gds, pps, items, setupData) {
  const P = { passNo: 1, raiseGdQty: diff.raiseGdQty };
  const SRC = { code_cd_diff: { changes: diff.changes, changeCount: diff.changeCount, materialIdCsv: diff.materialIdCsv, emptyList: diff.emptyList, orgIdSafe: diff.orgIdSafe },
    search_cd_gds: { data: list(gds) }, search_cd_pps: { data: list(pps) }, sql_node_CdItems: list(items), get_cd_setup: { data: setupData === undefined ? null : setupData } };
  SRC.code_cd_plan = run_cdPlan(SRC, P);
  if (num(SRC.code_cd_plan.blocked) === 1) return { SRC: SRC, P: P, plan: SRC.code_cd_plan, requests: [] };
  SRC.code_cd_allocreq = run_cdAllocReq(SRC, P);
  return { SRC: SRC, P: P, plan: SRC.code_cd_plan, requests: list(SRC.code_cd_allocreq.requests) };
};

// The plan's answer, shared by B1 and B3: null when the cascade goes on.
const soCascadeAnswer = function soCascadeAnswer(guard, gate, out, plan) {
  if (num(plan.blocked) === 1) {
    const q = { gateCode: s(plan.blockCode), message: s(plan.blockMessage), blockKind: s(plan.blockKind), blockSignal: num(plan.blockSignal) };
    // 414: GD asks to raise its quantity; the form asks the user, SUBMIT CONFIRM re-queues the job with the answer
    if (s(plan.blockCode) === "414") {
      return Object.assign(out, { route: "ASK", code: "414", message: q.message, reason: "confirmRaise", stage: "CASCADE",
        jobRows: [soCascadeJobRow(gate, { job_status: "AWAITING_CONFIRMATION", progress_percent: 20, progress_message: q.message, error_code: "414", error_message: q.message,
          error_details: JSON.stringify(q), confirmation_token: guard.nonce, prepared_payload: soCascadeSummary(gate, { stage: "CASCADE" }) })] });
    }
    return soCascadeFail(gate, out, s(plan.blockCode) || "406", q.message, q);
  }
  // decision B: a Picking Plan is re-saved by its classic save, which has no V2
  if (list(plan.ppDrafts).length) return soCascadeFail(gate, out, "SOV2_NOT_ELIGIBLE", "a picking plan of this sales order would change: saved the classic way", { gateCode: "300" });
  return null;
};
const soCascadeReady = function soCascadeReady(gate, out, why) {
  return Object.assign(out, { route: "READY", stage: "COMMIT", message: why,
    jobRows: [soCascadeJobRow(gate, { job_status: "READY_TO_COMMIT", progress_percent: 30, progress_message: "Ready to save", prepared_payload: soCascadeSummary(gate, { stage: "COMMIT", cascade: why }) })] });
};

// B1, node 2: classic's plan and allocation requests -> the C part.
const soCascadePlanStep = function soCascadePlanStep(guard, gate, diff, gds, pps, items, setupData) {
  const out = soCascadeOut();
  out.changeCount = num(diff.changeCount);
  if (diff.route === "NOSO") return soCascadeFail(gate, out, "SOV2_NO_SO", diff.message);
  if (diff.route === "NONE" || !num(diff.changeCount)) return soCascadeReady(gate, out, "nothing a delivery holds changed");
  const r = soCascadePlanRun(diff, gds, pps, items, setupData);
  const ans = soCascadeAnswer(guard, gate, out, r.plan);
  if (ans) return ans;
  if (!num(r.plan.hasWork)) return soCascadeReady(gate, out, "no delivery needs a change");
  const ref = "SOC|" + guard.nonce;
  // classic runs code_cd_names_ids on the drafts even when nothing is allocated (their stock rows' bins / batches / UOMs):
  // with no requests B3 reads these; with requests B2 computes them again with the results
  const names = r.requests.length ? {} : run_cdNamesIds(Object.assign({}, r.SRC, { get_cd_alloc_final: "[]" }), r.P);
  out.partRows = [soCascadePart(gate, ref, "C|000", { v: 1, diff: diff, requests: r.requests,
    names: { locationIds: list(names.locationIds), batchIds: list(names.batchIds), uomIds: list(names.uomIds) } })];
  out.requestCount = r.requests.length;
  out.gdCount = list(r.plan.gdDrafts).length;
  out.stage = r.requests.length ? "ALLOC" : "PAYLOAD";
  out.route = "NEXT";
  out.message = r.requests.length ? "Allocating stock for the deliveries" : "Preparing the delivery changes";
  out.jobRows = [soCascadeJobRow(gate, { progress_percent: 22, progress_message: out.message,
    prepared_payload: soCascadeSummary(gate, { stage: out.stage, cRef: ref, xRef: "", gRef: "", requests: r.requests.length, gds: out.gdCount }) })];
  return out;
};

// ---- GLOBAL_ALLOCATION v34 in-process (B2)

// The searches of GLOBAL_ALLOCATION v34, as filters over the set-based rows (the platform's search records: a missing key
// is a null). numberEqual compares numbers (by their decimal text: two 19-digit ids may share a double), equal compares
// text. handling_unit_id's null test is left to the platform's searches (huAllocated / looseAllocated): it is SQL's, so
// an empty '' is not null, and a record shows neither.
const soGaNull = (v) => v === undefined || v === null || v === "";
const soGaNumEq = (a, b) => !soGaNull(a) && !soGaNull(b) && soCanon(a) === soCanon(b);
const soGaEq = (a, b) => s(a) === s(b);
const soGaSearch = (rows, limit) => {
  const data = rows.slice(0, limit);
  return { total: rows.length, count: data.length, data: data };
};
// p: the workflow's params (GLOBAL_ALLOCATION's request); A: { items, itemBalances, batchBalances, pending (status
// Pending), huAllocated (Allocated, handling_unit_id not null), looseAllocated (Allocated, handling_unit_id null) }.
const soGlobalAllocation = function soGlobalAllocation(p, A) {
  // if_3mHEuJow -> return_node_f4hAPru0
  if (soGaNull(p.material_id) || Number(p.quantity) <= 0 || soGaNull(p.plant_id) || soGaNull(p.organization_id) || soGaNull(p.allocationType)) {
    return { code: "400", message: "Data is incomplete", allocationData: [] };
  }
  const SRC = {};
  // code_node_ItemSqlParams (digits only) -> sql_node_ItemAlloc
  const mat = /^[0-9]+$/.test(String(p.material_id)) ? String(p.material_id) : "0";
  SRC.sql_node_ItemAlloc = list(A.items).filter((r) => s(r.id) === mat);
  SRC.code_node_ItemNorm = run_gaItemNorm(SRC, p);
  // if_TtxL5yA9 -> return_node_ClHo7ok7
  if (num(SRC.code_node_ItemNorm.itemFound) === 0) return { code: "400", message: "Item not found or being deleted", allocationData: [] };
  const at = (r) => soGaNumEq(r.material_id, p.material_id) && soGaNumEq(r.plant_id, p.plant_id);
  // if_XPr9mVTE: search_node_ARAmvXyd (Item Batch Balance) / search_node_mb8Vv8fZ (Item Balance), limit 500
  if (num(SRC.code_node_ItemNorm.isBatchManaged) === 1) SRC.search_node_ARAmvXyd = soGaSearch(list(A.batchBalances).filter((r) => at(r) && soGaEq(r.organization_id, p.organization_id)), 500);
  else SRC.search_node_mb8Vv8fZ = soGaSearch(list(A.itemBalances).filter((r) => at(r) && soGaEq(r.organization_id, p.organization_id)), 500);
  // if_xWXCj_YZ (isPending numberEqual 1): search_node_BOywHct7 (limit 500) + search_node_WGl1NGSu (limit 1000)
  if (Number(p.isPending) === 1) {
    SRC.search_node_BOywHct7 = soGaSearch(list(A.pending).filter((r) => at(r) && soGaEq(r.parent_line_id, p.parent_line_id) && soGaEq(r.status, "Pending")), 500);
    SRC.search_node_WGl1NGSu = soGaSearch(list(A.huAllocated).filter((r) => at(r) && soGaEq(r.status, "Allocated")), 1000);
  }
  // search_node_OwnReserved01 (limit 1000)
  SRC.search_node_OwnReserved01 = soGaSearch(list(A.looseAllocated).filter((r) => at(r) && soGaEq(r.target_gd_id, p.currentDocId) && soGaEq(r.status, "Allocated")), 1000);
  const r = run_gaExec(SRC, p);
  // return_node_UwhI5ag5
  return { code: r.code, message: r.message, allocationData: r.allocationData };
};

// B2, node 1: what the set-based searches read (every request's material and plant).
const soCascadeAllocIds = function soCascadeAllocIds(gate, cRows) {
  const c = soCascadeParts(cRows, "C|")[0] || {};
  const reqs = list(c.requests);
  const ids = (k) => [...new Set(reqs.map((r) => s(r[k])).filter((v) => /^[0-9]+$/.test(v)))];
  const mats = ids("material_id");
  const plants = ids("plant_id");
  return { route: c.v ? "GO" : "NOPART", materialIds: mats.length ? mats : ["0"], plantIds: plants.length ? plants : ["0"], materialIdCsv: mats.join(",") || "0",
    organizationId: gate.organizationId };
};

// A GD changed since B1 stored the requests: the cascade is planned again (stage CASCADE).
const soCascadeAgain = function soCascadeAgain(gate, out) {
  out.route = "NEXT";
  out.stage = "CASCADE";
  out.message = "A delivery changed meanwhile: checking again";
  out.jobRows = [soCascadeJobRow(gate, { progress_percent: 20, progress_message: out.message, prepared_payload: soCascadeSummary(gate, { stage: "CASCADE", cRef: "", xRef: "" }) })];
  return out;
};

// B2, node 2: classic's plan again on classic's reads (the requests must be the ones B1 stored), every request through
// GLOBAL_ALLOCATION (classic's loop: set_cd_alloc_init [], then per request the workflow call and code_cd_alloc_collect),
// then code_cd_names_ids -> the X part.
const soCascadeAllocStep = function soCascadeAllocStep(guard, gate, cRows, gds, pps, items, setupData, itemRows, balRows, batchRows, pendRows, huRows, looseRows) {
  const out = soCascadeOut();
  const c = soCascadeParts(cRows, "C|")[0];
  if (!c) return soCascadeFail(gate, out, "SOV2_PARTS", "the delivery plan of this save is missing");
  const r = soCascadePlanRun(c.diff, gds, pps, items, setupData);
  const ans = soCascadeAnswer(guard, gate, out, r.plan);
  if (ans) return ans;
  if (JSON.stringify(r.requests) !== JSON.stringify(list(c.requests))) return soCascadeAgain(gate, out);
  for (const rows of [balRows, batchRows, pendRows, huRows, looseRows]) {
    if (list(rows).length >= SO_SEARCH_PAGE) return soCascadeFail(gate, out, "SOV2_NOT_ELIGIBLE", "too much stock data to allocate in the background: saved the classic way", { gateCode: "300" });
  }
  const A = { items: list(itemRows), itemBalances: list(balRows), batchBalances: list(batchRows), pending: list(pendRows), huAllocated: list(huRows), looseAllocated: list(looseRows) };
  const reqs = r.requests;
  let results = [];
  for (const req of reqs) {
    // wf_cd_alloc's body params: the request's fields, the literals isPending 1, allocationType GD, enforceStockCheck 1, includeReservedQty 1
    const p = { material_id: req.material_id, quantity: req.quantity, plant_id: req.plant_id, organization_id: req.organization_id, existingAllocationData: req.existingAllocationData,
      allocationStrategy: req.allocationStrategy, isPending: 1, parent_line_id: req.parent_line_id, allocationType: "GD", huData: req.huData, huPriority: req.huPriority,
      currentDocId: req.currentDocId, enforceStockCheck: 1, includeReservedQty: 1, orderUomId: req.orderUomId, splitPolicy: req.splitPolicy, lineMaterials: req.lineMaterials,
      allowMixedItem: req.allowMixedItem };
    const a = soGlobalAllocation(JSON.parse(JSON.stringify(p)), A);
    results = list(run_cdCollect({ get_cd_alloc: soCacheText(results), loop_cd_alloc: req, wf_cd_alloc: a }, {}).results);
  }
  const names = run_cdNamesIds(Object.assign({}, r.SRC, { get_cd_alloc_final: soCacheText(results) }), r.P);
  const ref = "SOX|" + guard.nonce;
  out.partRows = [soCascadePart(gate, ref, "X|000", { v: 1, results: results, locationIds: list(names.locationIds), batchIds: list(names.batchIds), uomIds: list(names.uomIds) })];
  out.requestCount = reqs.length;
  out.gdCount = list(r.plan.gdDrafts).length;
  out.stage = "PAYLOAD";
  out.route = "NEXT";
  out.message = "Preparing the delivery changes";
  out.jobRows = [soCascadeJobRow(gate, { progress_percent: 25, progress_message: out.message, prepared_payload: soCascadeSummary(gate, { stage: "PAYLOAD", xRef: ref }) })];
  return out;
};

// B2 / B3, node 1: the ids classic's reads take (the diff's items) and, for B3, code_cd_names_ids' answer from the X part.
const soCascadePayIds = function soCascadePayIds(gate, cRows) {
  const c = soCascadeParts(cRows, "C|")[0] || {};
  // the names B2 found with the allocations, else the ones B1 found on the drafts
  const x = soCascadeParts(cRows, "X|")[0] || c.names || {};
  const d = c.diff || {};
  const nz = (a) => (list(a).length ? list(a) : ["0"]);
  return { route: c.v ? "GO" : "NOPART", materialIdCsv: s(d.materialIdCsv), orgIdSafe: s(d.orgIdSafe), organizationId: s(d.organizationId), locationIds: nz(x.locationIds),
    batchIds: nz(x.batchIds), uomIds: nz(x.uomIds),
    // B2 reads classic's items beside the allocation's: the diff's ids under names of their own
    diffIds: { diffMaterialIdCsv: s(d.materialIdCsv), orgIdSafe: s(d.orgIdSafe), diffOrganizationId: s(d.organizationId) } };
};

// code_cd_payloads after soCascadePlanRun r, on the allocation results and classic's name lookups.
// The allocation results reach classic's nodes as a get-cache-node hands them over: the cache's JSON text.
const soCacheText = (v) => (typeof v === "string" ? v : JSON.stringify(list(v)));
const soCascadePayloadsRun = function soCascadePayloadsRun(r, results, bins, uoms, batches) {
  const SRC = Object.assign({}, r.SRC, { get_cd_alloc_final: soCacheText(results), search_cd_bins: { data: list(bins) }, search_cd_uoms: { data: list(uoms) }, search_cd_batches: { data: list(batches) } });
  return run_cdPayloads(SRC, r.P);
};

// B3, node 2: classic's plan again (a GD changed since B1 -> back to CASCADE), then code_cd_payloads -> one G part per GD.
const soCascadePayStep = function soCascadePayStep(guard, gate, cRows, gds, pps, items, setupData, bins, uoms, batches) {
  const out = soCascadeOut();
  const c = soCascadeParts(cRows, "C|")[0];
  if (!c) return soCascadeFail(gate, out, "SOV2_PARTS", "the delivery plan of this save is missing");
  const x = soCascadeParts(cRows, "X|")[0] || { results: [] };
  const r = soCascadePlanRun(c.diff, gds, pps, items, setupData);
  const ans = soCascadeAnswer(guard, gate, out, r.plan);
  if (ans) return ans;
  if (JSON.stringify(r.requests) !== JSON.stringify(list(c.requests))) return soCascadeAgain(gate, out);
  const pay = soCascadePayloadsRun(r, x.results, bins, uoms, batches);
  if (num(pay.allocFailed) === 1) return soCascadeFail(gate, out, "406", s(pay.allocMessage), { gateCode: "406", message: s(pay.allocMessage), blockKind: s(pay.allocBlockKind), blockSignal: 1 });
  if (list(pay.ppPayloads).length) return soCascadeFail(gate, out, "SOV2_NOT_ELIGIBLE", "a picking plan of this sales order would change: saved the classic way", { gateCode: "300" });
  const gdp = list(pay.gdPayloads);
  if (!gdp.length) return soCascadeReady(gate, out, "no delivery needs a change");
  const ref = "SOG|" + guard.nonce;
  out.partRows = gdp.map((g, i) => soCascadePart(gate, ref, "G|" + ("00" + (i + 1)).slice(-3), { gd_id: s(g.gd_id), gd_no: s(g.gd_no), lineCount: num(g.lineCount), allData: g.allData }));
  out.gdCount = gdp.length;
  out.stage = "HOLD";
  out.route = "HOLD";
  out.message = "Updating " + gdp.length + " deliver" + (gdp.length === 1 ? "y" : "ies") + " of this sales order";
  out.jobRows = [soCascadeJobRow(gate, { job_status: "CASCADE_PREPARING", progress_percent: 30, progress_message: out.message,
    prepared_payload: soCascadeSummary(gate, { stage: "HOLD", gRef: ref, gdParts: gdp.length, gdsToHold: gdp.map((g) => ({ gd_id: s(g.gd_id), gd_no: s(g.gd_no) })) }) })];
  return out;
};

// Result of a cascade step.
const soCascadeResult = function soCascadeResult(guard, gate, src) {
  const r = src || {};
  const jr = list(r.jobRows)[0];
  return { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(gate.jobId), job_status: jr ? s(jr.job_status) : "", stage: s(r.stage),
    plan_ref: "", plan_parts: String(list(r.partRows).length), header_cells: "0", line_updates: "0", line_inserts: "0", line_deletes: "0", needs_cascade: "1",
    evidence: JSON.stringify({ v: 1, workflow: "SO_SAVE_PREPARE", step: s(gate.step), route: s(r.route), code: s(r.code), reason: s(r.reason), stage: s(r.stage),
      gds: num(r.gdCount), requests: num(r.requestCount) }) };
};

// ---- this node
const res = soCascadePayStep([{{node:code_node_SPguard.data}}][0], [{{node:code_node_SPgate.data}}][0], [{{node:sql_node_SGc.data}}][0], [{{node:search_node_SGgds.data.data}}][0], [{{node:search_node_SGpps.data.data}}][0], [{{node:sql_node_SGitems.data}}][0], [{{node:get_node_SGsetup.data.data}}][0], [{{node:search_node_SGbins.data.data}}][0], [{{node:search_node_SGuoms.data.data}}][0],
  [{{node:search_node_SGbatches.data.data}}][0]);
res.needParts = res.partRows.length ? "YES" : "NO";
console.log("so prepare cascade payloads", JSON.stringify({ route: res.route, code: res.code, message: res.message, stage: res.stage, gds: res.gdCount, requests: res.requestCount, parts: res.partRows.length }));
return res;