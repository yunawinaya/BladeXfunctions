// Conflict detection + reverse payloads for "Revert Completed Item Assembly".
//
// Nothing is written before this node has run. Every check appends to
// `conflicts` rather than returning early, so a blocked revert reports every
// reason at once.
const EPS = 0.005;
const PRICE_EPS = 0.00005;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const roundQty = (v) => parseFloat(num(v).toFixed(3));
const roundPrice = (v) => parseFloat(num(v).toFixed(4));
const qtyStr = (v) => Math.max(0, roundQty(v)).toFixed(3);
const priceStr = (v) => Math.max(0, roundPrice(v)).toFixed(4);
const S = (v) => (v === null || v === undefined ? "" : String(v));
const orNull = (v) => (S(v) ? S(v) : null);
const asArr = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);
const cmpId = (a, b) => {
  a = S(a);
  b = S(b);
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
};
// Only used to find the id closest to another; a double keeps millisecond order.
const idGap = (a, b) => Math.abs(parseFloat(S(a)) - parseFloat(S(b)));
const parseJson = (v) => {
  if (Array.isArray(v) || (v && typeof v === "object")) return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
  }
};

// Category -> balance column, copied from SUBTRACT_INVENTORY code_node_TC1cqaOy.
const CATEGORY_FIELD_MAP = {
  Unrestricted: "unrestricted_qty",
  Reserved: "reserved_qty",
  Blocked: "block_qty",
  "Quality Inspection": "qualityinsp_qty",
  "In Transit": "intransit_qty",
};
const catField = (c) => CATEGORY_FIELD_MAP[S(c)] || "unrestricted_qty";

const iaId = S({{node:code_node_iaRvPrep.data.iaId}});
const plantId = S({{node:code_node_iaRvPrep.data.plantId}});
const assembledItemId = S({{node:code_node_iaRvPrep.data.assembledItemId}});
const liveOut = asArr({{node:code_node_iaRvPrep.data.liveOut}}).slice().sort((a, b) => cmpId(a.id, b.id));
const liveIn = asArr({{node:code_node_iaRvPrep.data.liveIn}}).slice().sort((a, b) => cmpId(a.id, b.id));
const partialRow = Number({{node:code_node_iaRvPrep.data.partialRow}}) || 0;

const fifoRows = asArr({{node:sql_node_iaRvFifo.data}});
const waRows = asArr({{node:sql_node_iaRvWa.data}});
const costCounts = asArr({{node:sql_node_iaRvCostCounts.data}});
const itemBalRows = asArr({{node:search_node_iaRvItemBal.data.data}});
const batchBalRows = asArr({{node:search_node_iaRvBatchBal.data.data}});
const huRecords = asArr({{node:search_node_iaRvHu.data.data}});
const itemRecords = asArr({{node:search_node_iaRvItems.data.data}});
const batchRows = asArr({{node:search_node_iaRvBatch.data.data}});

const docDate = new Date().toISOString();

const conflicts = [];
const flag = (type, id, message) => conflicts.push({ type: type, id: S(id), message: message });

const ceiling = (rows, limit, label) => {
  if (rows.length >= limit) flag("fetch_truncated", label, label + " hit the fetch limit; the revert cannot be verified.");
};
ceiling(itemBalRows, 1000, "Item Balance");
ceiling(batchBalRows, 1000, "Item Batch Balance");
ceiling(itemRecords, 1000, "Item");
ceiling(huRecords, 100, "Handling Unit");
ceiling(batchRows, 100, "Batch");

const itemById = {};
for (const it of itemRecords) itemById[S(it.id)] = it;
const nameOf = (itemId) => {
  const it = itemById[S(itemId)];
  return (it && (it.material_code || it.material_name)) || S(itemId);
};
const isStockControlled = (it) =>
  !it || it.stock_control === null || it.stock_control === undefined || Number(it.stock_control) !== 0;
const liveRows = liveOut.concat(liveIn);

// --- 1. Item master drift ---------------------------------------------------
const checkedItems = {};
for (const r of liveRows) {
  const iid = S(r.item_id);
  if (checkedItems[iid]) continue;
  checkedItems[iid] = 1;
  const it = itemById[iid];
  if (!it) {
    flag("item_missing", iid, "Item master " + iid + " no longer exists.");
    continue;
  }
  if (!isStockControlled(it)) {
    flag("stock_control_changed", iid, "Item " + nameOf(iid) + " is no longer stock controlled, so its stock cannot be reversed.");
  }
  if (S(r.costing_method_id) && S(it.material_costing_method) && S(r.costing_method_id) !== S(it.material_costing_method)) {
    flag("costing_method_changed", iid, "Item " + nameOf(iid) + " changed costing method from " + S(r.costing_method_id) + " to " + S(it.material_costing_method) + ".");
  }
  // Reversals are made in base units, so the base unit must convert one for one.
  const convs = Array.isArray(it.table_uom_conversion) ? it.table_uom_conversion : [];
  const baseConv = convs.find((c) => S(c.alt_uom_id) === S(it.based_uom));
  if (baseConv && Math.abs(num(baseConv.base_qty) - 1) > 0.000001) {
    flag("uom_conversion_changed", iid, "Item " + nameOf(iid) + " does not convert its own base unit one for one.");
  }
}
if (partialRow === 1) {
  flag("partial_row_state", iaId, "An earlier revert stopped part way through a single movement of this assembly. It cannot be finished automatically.");
}

// ADD and SUBTRACT both run a costing-migration branch that writes when an item
// has rows in both costing tables, or only in the table its method does not use.
const countBy = {};
for (const c of costCounts) countBy[S(c.t) + "|" + S(c.material_id)] = num(c.cnt);
for (const iid of Object.keys(checkedItems)) {
  const it = itemById[iid];
  const method = it ? S(it.material_costing_method) : "";
  const nFifo = countBy["FIFO|" + iid] || 0;
  const nWa = countBy["WA|" + iid] || 0;
  if (nFifo > 0 && nWa > 0) {
    flag("costing_inconsistent", iid, "Item " + nameOf(iid) + " has both FIFO and weighted-average costing rows; fix the costing data before reverting.");
  } else if (method === "First In First Out" && nFifo === 0 && nWa > 0) {
    flag("costing_inconsistent", iid, "Item " + nameOf(iid) + " is FIFO but only has weighted-average costing rows.");
  } else if (method === "Weighted Average" && nWa === 0 && nFifo > 0) {
    flag("costing_inconsistent", iid, "Item " + nameOf(iid) + " is weighted average but only has FIFO costing rows.");
  }
}

// --- 2. The assembled item must still be where the assembly put it ----------
const itemBalBy = {};
for (const b of itemBalRows) itemBalBy[S(b.material_id) + "|" + S(b.location_id) + "|" + S(b.plant_id)] = b;
const batchBalBy = {};
for (const b of batchBalRows) {
  batchBalBy[S(b.material_id) + "|" + S(b.location_id) + "|" + S(b.batch_id) + "|" + S(b.plant_id)] = b;
}
const needBy = {};
for (const r of liveIn) {
  const k = S(r.item_id) + "|" + S(r.bin_location_id) + "|" + S(r.batch_number_id) + "|" + S(r.inventory_category);
  if (!needBy[k]) needBy[k] = { row: r, qty: 0 };
  needBy[k].qty = roundQty(needBy[k].qty + num(r.base_qty));
}
for (const k of Object.keys(needBy)) {
  const r = needBy[k].row;
  const qty = needBy[k].qty;
  const col = catField(r.inventory_category);
  const itemBal = itemBalBy[S(r.item_id) + "|" + S(r.bin_location_id) + "|" + plantId];
  if (!itemBal) {
    flag("balance_missing", r.item_id, "No stock balance row for " + nameOf(r.item_id) + " at the bin the assembly received it into.");
    continue;
  }
  if (num(itemBal[col]) < qty - EPS) {
    flag("balance_short", r.item_id, "Item " + nameOf(r.item_id) + " only has " + roundQty(itemBal[col]) + " left of the " + qty + " this assembly produced.");
  }
  if (S(r.batch_number_id)) {
    // SUBTRACT dereferences the batch balance without a guard.
    const bb = batchBalBy[S(r.item_id) + "|" + S(r.bin_location_id) + "|" + S(r.batch_number_id) + "|" + plantId];
    if (!bb) {
      flag("balance_missing", r.item_id, "No batch balance row for " + nameOf(r.item_id) + " at the bin the assembly received it into.");
    } else if (num(bb[col]) < qty - EPS) {
      flag("balance_short", r.item_id, "The batch of " + nameOf(r.item_id) + " only has " + roundQty(bb[col]) + " left of the " + qty + " this assembly produced.");
    }
  }
}

// --- 3. The assembled item's own costing row --------------------------------
// Only this assembly's own layer decides whether its output has been used. A
// sale of the same item that drew on older layers does not block the revert.
const fifoDeleteFor = {};
const waDeleteFor = {};
const waUpdateFor = {};
const rowsByTuple = {};
for (const r of liveIn) {
  const k = S(r.item_id) + "|" + S(r.batch_number_id);
  if (!rowsByTuple[k]) rowsByTuple[k] = [];
  rowsByTuple[k].push(r);
}
const nearest = (candidates, anchorId) => {
  let best = null;
  for (const c of candidates) if (!best || idGap(c.id, anchorId) < idGap(best.id, anchorId)) best = c;
  return best;
};
for (const k of Object.keys(rowsByTuple)) {
  const rows = rowsByTuple[k];
  const itemId = S(rows[0].item_id);
  const batchId = S(rows[0].batch_number_id);
  const it = itemById[itemId];
  const method = it ? S(it.material_costing_method) : "";

  if (method === "First In First Out") {
    const used = {};
    for (const r of rows) {
      // Another receipt of the same quantity and price can exist, so the layer
      // written in the same call as this movement is the one closest to it.
      const candidates = fifoRows.filter(
        (f) =>
          !used[S(f.id)] &&
          S(f.material_id) === itemId &&
          S(f.batch_id) === batchId &&
          Math.abs(num(f.fifo_initial_quantity) - num(r.base_qty)) <= EPS &&
          Math.abs(num(f.fifo_cost_price) - num(r.unit_price)) <= PRICE_EPS
      );
      const hit = nearest(candidates, r.id);
      if (!hit) {
        flag("fifo_layer_missing", itemId, "No costing layer matches the " + roundQty(r.base_qty) + " of " + nameOf(itemId) + " this assembly produced.");
        continue;
      }
      used[S(hit.id)] = 1;
      if (Math.abs(num(hit.fifo_available_quantity) - num(hit.fifo_initial_quantity)) > EPS) {
        flag("fifo_layer_consumed", itemId, "The assembled " + nameOf(itemId) + " has already been used (" + roundQty(hit.fifo_available_quantity) + " of " + roundQty(hit.fifo_initial_quantity) + " left in its costing layer).");
        continue;
      }
      fifoDeleteFor[S(r.id)] = S(hit.id);
    }
  } else if (method === "Weighted Average") {
    if (batchId) {
      const used = {};
      for (const r of rows) {
        const candidates = waRows.filter(
          (w) =>
            !used[S(w.id)] &&
            S(w.material_id) === itemId &&
            S(w.batch_id) === batchId &&
            Math.abs(num(w.wa_cost_price) - num(r.unit_price)) <= PRICE_EPS
        );
        const hit = nearest(candidates, r.id);
        if (!hit) {
          flag("wa_row_missing", itemId, "No costing row matches the batch of " + nameOf(itemId) + " this assembly produced.");
          continue;
        }
        used[S(hit.id)] = 1;
        if (Math.abs(num(hit.wa_quantity) - num(r.base_qty)) > EPS) {
          flag("wa_qty_short", itemId, "The batch of " + nameOf(itemId) + " this assembly produced has already been used.");
          continue;
        }
        waDeleteFor[S(r.id)] = S(hit.id);
      }
    } else {
      // The receipt merged into one running average; take its quantity and value back out.
      const pool = waRows
        .filter((w) => S(w.material_id) === itemId && !S(w.batch_id))
        .slice()
        .sort((a, b) => cmpId(a.id, b.id));
      const target = pool.length > 0 ? pool[pool.length - 1] : null;
      if (!target) {
        flag("wa_row_missing", itemId, "The weighted-average costing row for " + nameOf(itemId) + " no longer exists.");
        continue;
      }
      let B = 0;
      let C = 0;
      for (const r of rows) {
        B = roundQty(B + num(r.base_qty));
        C = C + num(r.base_qty) * num(r.unit_price);
      }
      const q1 = num(target.wa_quantity);
      const p1 = num(target.wa_cost_price);
      if (q1 < B - EPS) {
        flag("wa_qty_short", itemId, "The weighted-average quantity for " + nameOf(itemId) + " (" + roundQty(q1) + ") is below the " + B + " this assembly produced.");
        continue;
      }
      const q0 = roundQty(q1 - B);
      let p0 = p1;
      if (q0 > 0.0005) {
        p0 = roundPrice((p1 * q1 - C) / q0);
        if (p0 < 0) {
          flag("wa_backsolve_negative", itemId, "Undoing the weighted-average cost for " + nameOf(itemId) + " would give a negative unit cost.");
          continue;
        }
      }
      waUpdateFor[S(rows[rows.length - 1].id)] = {
        id: S(target.id),
        wa_quantity: q0 > 0.0005 ? qtyStr(q0) : "0.000",
        wa_cost_price: priceStr(p0),
      };
    }
  }
}

// --- 4. Handling units the components were picked from ----------------------
const huById = {};
for (const h of huRecords) huById[S(h.id)] = h;
const huLoadFor = {};
for (const r of liveOut) {
  const huId = S(r.handling_unit_id);
  if (!huId) continue;
  const hu = huById[huId];
  if (!hu) {
    flag("hu_missing", huId, "Handling unit " + huId + " no longer exists.");
    continue;
  }
  if (S(hu.hu_status) !== "Created") {
    flag("hu_status", huId, "Handling unit " + S(hu.handling_no) + " is " + (S(hu.hu_status) || "blank") + " and can no longer take stock back.");
    continue;
  }
  if (S(hu.parent_hu_id) || S(hu.packing_id)) {
    flag("hu_nested", huId, "Handling unit " + S(hu.handling_no) + " has been nested or packed.");
    continue;
  }
  if (S(hu.location_id) !== S(r.bin_location_id)) {
    flag("hu_moved", huId, "Handling unit " + S(hu.handling_no) + " has been moved to another bin.");
    continue;
  }
  // The unload at completion keeps an emptied line in the array as is_deleted,
  // and the load re-activates a line only on an exact material + balance match,
  // so the line's own ids are sent back verbatim.
  const lines = asArr(parseJson(hu.table_hu_items) || []).filter(
    (i) => S(i.material_id) === S(r.item_id) && S(i.batch_id) === S(r.batch_number_id)
  );
  const line = lines.find((i) => Number(i.is_deleted) !== 1) || lines[lines.length - 1];
  if (!line) {
    flag("hu_line_missing", huId, "Handling unit " + S(hu.handling_no) + " has no line for " + nameOf(r.item_id) + " to put it back into.");
    continue;
  }
  huLoadFor[S(r.id)] = {
    huId: huId,
    plantId: S(hu.plant_id) || plantId,
    storageLocationId: orNull(hu.storage_location_id),
    locationId: orNull(hu.location_id),
    items: [
      {
        material_id: line.material_id,
        balance_id: line.balance_id,
        batch_id: orNull(r.batch_number_id),
        location_id: orNull(hu.location_id),
        material_uom: S(r.base_uom_id),
        quantity: roundQty(r.base_qty),
      },
    ],
  };
}

// --- 5. Batch rows this assembly minted --------------------------------------
// Completion inserts a Batch row for the assembled item every time, a blank one
// when the item is not batch managed. A row is removed once no stock is left in
// it after this reversal.
const reversedByBatch = {};
for (const r of liveIn) {
  const b = S(r.batch_number_id);
  if (b) reversedByBatch[b] = roundQty((reversedByBatch[b] || 0) + num(r.base_qty));
}
const heldByBatch = {};
for (const bb of batchBalRows) {
  const b = S(bb.batch_id);
  heldByBatch[b] = roundQty((heldByBatch[b] || 0) + num(bb.balance_quantity));
}
const batchDeletes = [];
for (const b of batchRows) {
  if (S(b.material_id) !== assembledItemId) continue;
  const bid = S(b.id);
  const left = roundQty((heldByBatch[bid] || 0) - (reversedByBatch[bid] || 0));
  if (!S(b.batch_number).trim() || left <= EPS) batchDeletes.push({ id: bid });
}

// --- 6. Reverse payloads ------------------------------------------------------
const subtracts = [];
const adds = [];
let index = 0;
for (const r of liveIn) {
  const waU = waUpdateFor[S(r.id)] || null;
  const fifoId = fifoDeleteFor[S(r.id)] || "";
  const waDelId = waDeleteFor[S(r.id)] || "";
  subtracts.push({
    index: index++,
    material_id: S(r.item_id),
    quantity: roundQty(r.base_qty),
    material_uom: S(r.base_uom_id),
    unit_price: roundPrice(r.unit_price),
    inventory_category: S(r.inventory_category) || "Unrestricted",
    location_id: orNull(r.bin_location_id),
    // SUBTRACT reassigns a const when batch_id is "", so absent values are null.
    batch_id: orNull(r.batch_number_id),
    itemData: itemById[S(r.item_id)] || null,
    doc_date: docDate,
    failLabel: "Assembled item " + nameOf(r.item_id) + " (" + roundQty(r.base_qty) + ")",
    fifoDeleteId: fifoId,
    hasFifoDelete: fifoId ? 1 : 0,
    waDeleteId: waDelId,
    hasWaDelete: waDelId ? 1 : 0,
    waUpdateId: waU ? waU.id : "",
    waQuantity: waU ? waU.wa_quantity : "0.000",
    waCostPrice: waU ? waU.wa_cost_price : "0.0000",
    hasWaUpdate: waU ? 1 : 0,
  });
}
for (const r of liveOut) {
  const hu = huLoadFor[S(r.id)] || null;
  adds.push({
    index: index++,
    material_id: S(r.item_id),
    quantity: roundQty(r.base_qty),
    material_uom: S(r.base_uom_id),
    // The component comes back at the cost it left at, as a new FIFO layer or
    // blended back into the weighted average.
    unit_price: roundPrice(r.unit_price),
    inventory_category: S(r.inventory_category) || "Unrestricted",
    location_id: orNull(r.bin_location_id),
    batch_id: orNull(r.batch_number_id),
    handling_unit_id: orNull(r.handling_unit_id),
    itemData: itemById[S(r.item_id)] || null,
    doc_date: docDate,
    failLabel: "Component " + nameOf(r.item_id) + " (" + roundQty(r.base_qty) + ")",
    hasHuLoad: hu ? 1 : 0,
    huId: hu ? hu.huId : "",
    huPlantId: hu ? hu.plantId : plantId,
    huStorageLocationId: hu ? hu.storageLocationId : null,
    huLocationId: hu ? hu.locationId : null,
    huItems: hu ? hu.items : [],
  });
}

const hasConflicts = conflicts.length > 0 ? 1 : 0;
const gate = (arr) => (hasConflicts === 1 ? [] : arr);
const flagOf = (arr) => (hasConflicts === 0 && arr.length > 0 ? 1 : 0);
const outSubtracts = gate(subtracts);
const outAdds = gate(adds);
const outBatch = gate(batchDeletes);

return {
  hasConflicts: hasConflicts,
  conflictCount: conflicts.length,
  conflicts: conflicts,
  subtracts: outSubtracts,
  hasSubtracts: flagOf(outSubtracts),
  adds: outAdds,
  hasAdds: flagOf(outAdds),
  batchDeletes: outBatch,
  hasBatchDeletes: flagOf(outBatch),
};
