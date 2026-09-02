// Conflict detection + reverse payloads for "Revert Completed Goods Receiving".
//
// Nothing is written before this node has run. Every check below appends to
// `conflicts` rather than returning early, so a blocked revert reports every
// reason at once instead of one per attempt.
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
const asArr = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);
const cmpId = (a, b) => {
  a = S(a);
  b = S(b);
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
};
const parseJson = (v) => {
  if (Array.isArray(v) || (v && typeof v === "object")) return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
  }
};

// Category -> balance column, copied from SUBTRACT_INVENTORY code_node_TC1cqaOy.
// An unrecognised category lands on unrestricted_qty, matching what ADD did.
const CATEGORY_FIELD_MAP = {
  Unrestricted: "unrestricted_qty",
  Reserved: "reserved_qty",
  Blocked: "block_qty",
  "Quality Inspection": "qualityinsp_qty",
  "In Transit": "intransit_qty",
};
const catField = (c) => CATEGORY_FIELD_MAP[S(c)] || "unrestricted_qty";

const grId = S({{node:code_node_grRvPrep.data.grId}});
const grNo = S({{node:code_node_grRvPrep.data.grNo}});
const plantId = S({{node:code_node_grRvPrep.data.plantId}});
const organizationId = S({{node:code_node_grRvPrep.data.organizationId}});
const lines = asArr({{node:code_node_grRvPrep.data.lines}});
const liveRows = asArr({{node:code_node_grRvPrep.data.liveRows}}).slice().sort((a, b) => cmpId(a.id, b.id));
// Everything the current receipt cycle posted, including rows a previous run
// already reversed. The document's quantities are checked against these, so a
// retry after a half-finished run is not mistaken for corrupted data.
const cycleRows = asArr({{node:code_node_grRvPrep.data.cycleRows}});
const huOutRows = asArr({{node:code_node_grRvPrep.data.huOutRows}});
const tupleAnchors = {{node:code_node_grRvPrep.data.tupleAnchors}} || {};

const laterRows = asArr({{node:sql_node_grRvLater.data}});
const fifoRows = asArr({{node:sql_node_grRvFifo.data}});
const waRows = asArr({{node:sql_node_grRvWa.data}});
const costCounts = asArr({{node:sql_node_grRvCostCounts.data}});
const piRows = asArr({{node:search_node_grRvPi.data.data}});
const batchBalRows = asArr({{node:search_node_grRvBatchBal.data.data}});
const itemBalRows = asArr({{node:search_node_grRvItemBal.data.data}});
const huRecords = asArr({{node:search_node_grRvHu.data.data}});
const poRecords = asArr({{node:search_node_grRvPo.data.data}});
const onOrderRows = asArr({{node:search_node_grRvOnOrder.data.data}});
const itemRecords = asArr({{node:search_node_grRvItems.data.data}});
const putawayRows = asArr({{node:search_node_grRvPutaway.data.data}});
const qiRows = asArr({{node:search_node_grRvQi.data.data}});
const transitRows = asArr({{node:search_node_grRvTransit.data.data}});
const batchRows = asArr({{node:search_node_grRvBatch.data.data}});

const docDate = new Date().toISOString();

const conflicts = [];
const flag = (type, id, message) => conflicts.push({ type: type, id: S(id), message: message });

// A fetch that came back exactly at its ceiling may have hidden the very row
// that proves the stock moved on, so it is treated as unverifiable.
const ceiling = (rows, limit, label) => {
  if (rows.length >= limit) flag("fetch_truncated", label, label + " hit the fetch limit; the revert cannot be verified.");
};
ceiling(batchBalRows, 1000, "Item Batch Balance");
ceiling(itemBalRows, 1000, "Item Balance");
ceiling(onOrderRows, 1000, "On Order");
ceiling(itemRecords, 1000, "Item");
ceiling(transitRows, 1000, "In Transit Detail");

const isSplitParent = (r) => r.is_split === "Yes" && r.parent_or_child === "Parent";
const isChild = (r) => r.parent_or_child === "Child";
const skipInventory = (r) => (!r.item_id || isSplitParent(r) ? 1 : 0);
const updatesPOLine = (r) => (isChild(r) ? 0 : 1);
const updatesOnOrder = (r) =>
  isSplitParent(r) || (!isSplitParent(r) && !isChild(r) && skipInventory(r) === 0) ? 1 : 0;
const addsInventory = (r) => (isChild(r) || (!isSplitParent(r) && skipInventory(r) === 0) ? 1 : 0);
const flattenTree = (rows) => {
  const flat = [];
  for (const row of rows || []) {
    flat.push(row);
    for (const child of Array.isArray(row.children) ? row.children : []) flat.push(child);
  }
  return flat;
};

const itemById = {};
for (const it of itemRecords) itemById[S(it.id)] = it;
const nameOf = (itemId) => {
  const it = itemById[S(itemId)];
  return (it && (it.material_code || it.material_name)) || S(itemId);
};
const tupleKey = (item, batch) => S(item) + "|" + S(batch);
const isStockControlled = (it) => !it || it.stock_control === null || it.stock_control === undefined || Number(it.stock_control) !== 0;

// --- 1. A live purchase invoice, however it was raised ----------------------
for (const pi of piRows) {
  const st = S(pi.pi_status).trim().toLowerCase();
  if (st === "cancelled") continue;
  flag("invoiced", pi.id, "Purchase Invoice " + S(pi.purchase_invoice_no) + " (" + (S(pi.pi_status) || "Draft") + ") refers to this receipt. Cancel it first.");
}

// --- 2. Integrity: the movement rows must still describe this document ------
const receivedByItem = {};
for (const line of lines) {
  if (addsInventory(line) !== 1) continue;
  const it = itemById[S(line.item_id)];
  if (!isStockControlled(it)) continue;
  const k = S(line.item_id);
  receivedByItem[k] = roundQty((receivedByItem[k] || 0) + (num(line.base_received_qty) || num(line.received_qty)));
}
const postedByItem = {};
for (const r of cycleRows) {
  const k = S(r.item_id);
  postedByItem[k] = roundQty((postedByItem[k] || 0) + num(r.base_qty));
}
for (const k of Object.keys(receivedByItem)) {
  if (Math.abs((postedByItem[k] || 0) - receivedByItem[k]) > EPS) {
    flag("integrity_qty", k, "Item " + nameOf(k) + ": stock on hand from this receipt (" + roundQty(postedByItem[k] || 0) + ") no longer matches the received quantity (" + receivedByItem[k] + ").");
  }
}
for (const line of lines) {
  if (!isSplitParent(line)) continue;
  const kids = lines.filter((c) => isChild(c) && c.parent_index === line.parent_index);
  const sum = kids.reduce((s, c) => s + num(c.received_qty), 0);
  if (Math.abs(sum - num(line.received_qty)) > EPS) {
    flag("split_rollup_mismatch", line.id, "Split line for " + nameOf(line.item_id) + " no longer adds up to its child rows.");
  }
}

// --- 3. Item master drift that would make the reversal write the wrong thing -
for (const r of liveRows) {
  const it = itemById[S(r.item_id)];
  if (!it) {
    flag("item_missing", r.item_id, "Item master " + S(r.item_id) + " no longer exists.");
    continue;
  }
  if (!isStockControlled(it)) {
    flag("stock_control_changed", r.item_id, "Item " + nameOf(r.item_id) + " is no longer stock controlled, so its stock cannot be reversed.");
  }
  if (S(r.costing_method_id) && S(it.material_costing_method) && S(r.costing_method_id) !== S(it.material_costing_method)) {
    flag("costing_method_changed", r.item_id, "Item " + nameOf(r.item_id) + " changed costing method from " + S(r.costing_method_id) + " to " + S(it.material_costing_method) + ".");
  }
  // SUBTRACT re-derives the base quantity from the alternate quantity, so a
  // changed conversion would take a different amount out than went in.
  const convs = Array.isArray(it.table_uom_conversion) ? it.table_uom_conversion : [];
  const conv = convs.find((c) => S(c.alt_uom_id) === S(r.uom_id));
  const factor = conv ? num(conv.base_qty) : 1;
  if (Math.abs(roundQty(num(r.quantity) * factor) - roundQty(num(r.base_qty))) > EPS) {
    flag("uom_conversion_changed", r.item_id, "The UOM conversion for " + nameOf(r.item_id) + " changed since this receipt.");
  }
}

// SUBTRACT_INVENTORY runs a costing-migration branch on every call. It only
// writes when an item has rows in both costing tables, or rows only in the
// table its method does not use. Refusing those makes the branch a no-op here.
const countBy = {};
for (const c of costCounts) countBy[S(c.t) + "|" + S(c.material_id)] = num(c.cnt);
const liveItemIds = [];
for (const r of liveRows) if (liveItemIds.indexOf(S(r.item_id)) === -1) liveItemIds.push(S(r.item_id));
for (const iid of liveItemIds) {
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

// --- 4. Has anything touched this stock since? ------------------------------
for (const lr of laterRows) {
  const k = tupleKey(lr.item_id, lr.batch_id);
  const anchor = tupleAnchors[k];
  if (!anchor) continue;
  if (cmpId(lr.max_id, anchor) <= 0) continue;
  flag("later_movement", lr.item_id, "Item " + nameOf(lr.item_id) + " has been used since this receipt (latest: " + S(lr.latest) + ").");
}

// --- 5. Is the stock still sitting where the receipt put it? ----------------
const batchBalBy = {};
for (const b of batchBalRows) {
  batchBalBy[S(b.material_id) + "|" + S(b.location_id) + "|" + S(b.batch_id) + "|" + S(b.plant_id)] = b;
}
const itemBalBy = {};
for (const b of itemBalRows) {
  itemBalBy[S(b.material_id) + "|" + S(b.location_id) + "|" + S(b.plant_id)] = b;
}
const demand = {};
for (const r of liveRows) {
  const k = S(r.item_id) + "|" + S(r.bin_location_id) + "|" + S(r.batch_number_id) + "|" + catField(r.inventory_category);
  if (!demand[k]) {
    demand[k] = { item: S(r.item_id), bin: S(r.bin_location_id), batch: S(r.batch_number_id), col: catField(r.inventory_category), qty: 0 };
  }
  demand[k].qty = roundQty(demand[k].qty + num(r.base_qty));
}
for (const k of Object.keys(demand)) {
  const d = demand[k];
  const itemBal = itemBalBy[d.item + "|" + d.bin + "|" + plantId];
  if (!itemBal) {
    flag("balance_missing", d.item, "No stock balance row for " + nameOf(d.item) + " at the receiving bin any more.");
    continue;
  }
  if (num(itemBal[d.col]) < d.qty - EPS) {
    flag("balance_short", d.item, "Item " + nameOf(d.item) + " only has " + roundQty(itemBal[d.col]) + " left of the " + d.qty + " this receipt brought in.");
  }
  if (d.batch) {
    // SUBTRACT reads the batch balance and dereferences it without a guard, so
    // a missing row would fail mid-run rather than cleanly.
    const bb = batchBalBy[d.item + "|" + d.bin + "|" + d.batch + "|" + plantId];
    if (!bb) {
      flag("balance_missing", d.item, "No batch balance row for " + nameOf(d.item) + " at the receiving bin any more.");
    } else if (num(bb[d.col]) < d.qty - EPS) {
      flag("balance_short", d.item, "Batch of " + nameOf(d.item) + " only has " + roundQty(bb[d.col]) + " left of the " + d.qty + " this receipt brought in.");
    }
  }
}

// --- 6. Costing rows this receipt created ----------------------------------
const rowsByTuple = {};
for (const r of liveRows) {
  const k = tupleKey(r.item_id, r.batch_number_id);
  if (!rowsByTuple[k]) rowsByTuple[k] = [];
  rowsByTuple[k].push(r);
}
const fifoDeleteFor = {};
const waDeleteFor = {};
const waUpdateFor = {};

for (const k of Object.keys(rowsByTuple)) {
  const rows = rowsByTuple[k];
  const itemId = rows[0].item_id;
  const batchId = S(rows[0].batch_number_id);
  const it = itemById[S(itemId)];
  const method = it ? S(it.material_costing_method) : "";

  if (method === "First In First Out") {
    // Every layer on this tuple newer than the receipt document is one of ours:
    // an earlier receipt's layers have lower ids, a previous revert's are
    // soft-deleted, and a later foreign receipt is already refused above.
    const layers = fifoRows.filter((f) => S(f.material_id) === S(itemId) && S(f.batch_id) === batchId);
    if (layers.length !== rows.length) {
      flag("fifo_layer_mismatch", itemId, "Item " + nameOf(itemId) + " has " + layers.length + " costing layer(s) from this receipt but " + rows.length + " stock movement(s).");
      continue;
    }
    const used = {};
    for (const r of rows) {
      let hit = null;
      for (const f of layers) {
        if (used[S(f.id)]) continue;
        if (Math.abs(num(f.fifo_initial_quantity) - num(r.base_qty)) > EPS) continue;
        if (Math.abs(num(f.fifo_cost_price) - num(r.unit_price)) > PRICE_EPS) continue;
        hit = f;
        break;
      }
      if (!hit) {
        flag("fifo_layer_mismatch", itemId, "No untouched costing layer matches the " + roundQty(r.base_qty) + " of " + nameOf(itemId) + " received here.");
        continue;
      }
      if (Math.abs(num(hit.fifo_available_quantity) - num(hit.fifo_initial_quantity)) > EPS) {
        flag("fifo_layer_consumed", itemId, "The costing layer for " + nameOf(itemId) + " has already been drawn down (" + roundQty(hit.fifo_available_quantity) + " of " + roundQty(hit.fifo_initial_quantity) + " left).");
        continue;
      }
      used[S(hit.id)] = 1;
      fifoDeleteFor[S(r.id)] = S(hit.id);
    }
  } else if (method === "Weighted Average") {
    if (batchId) {
      const rowsWa = waRows.filter((w) => S(w.material_id) === S(itemId) && S(w.batch_id) === batchId);
      if (rowsWa.length !== rows.length) {
        flag("wa_batch_row_mismatch", itemId, "Item " + nameOf(itemId) + " has " + rowsWa.length + " costing row(s) from this receipt but " + rows.length + " stock movement(s).");
        continue;
      }
      const used = {};
      for (const r of rows) {
        let hit = null;
        for (const w of rowsWa) {
          if (used[S(w.id)]) continue;
          if (Math.abs(num(w.wa_quantity) - num(r.base_qty)) > EPS) continue;
          if (Math.abs(num(w.wa_cost_price) - num(r.unit_price)) > PRICE_EPS) continue;
          hit = w;
          break;
        }
        if (!hit) {
          flag("wa_batch_row_mismatch", itemId, "No untouched costing row matches the " + roundQty(r.base_qty) + " of " + nameOf(itemId) + " received here.");
          continue;
        }
        used[S(hit.id)] = 1;
        waDeleteFor[S(r.id)] = S(hit.id);
      }
    } else {
      // The receipt merged into one running average row. Undoing it means
      // taking this receipt's quantity and value back out of that average.
      const pool = waRows
        .filter((w) => S(w.material_id) === S(itemId) && !S(w.batch_id))
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
        flag("wa_qty_short", itemId, "The weighted-average quantity for " + nameOf(itemId) + " (" + roundQty(q1) + ") is below the " + B + " this receipt added.");
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

// --- 7. Handling units ------------------------------------------------------
const huById = {};
for (const h of huRecords) huById[S(h.id)] = h;
const huActionFor = {};
for (const r of liveRows) {
  const huId = S(r.handling_unit_id);
  if (!huId) continue;
  const hu = huById[huId];
  if (!hu) {
    flag("hu_missing", huId, "Handling unit " + huId + " no longer exists.");
    continue;
  }
  if (S(hu.hu_status) !== "Created") {
    flag("hu_status", huId, "Handling unit " + S(hu.handling_no) + " is " + (S(hu.hu_status) || "blank") + " and can no longer be unpacked.");
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
  const items = asArr(parseJson(hu.table_hu_items) || []).filter((i) => Number(i.is_deleted) !== 1);
  // The handling unit is created after the stock is added, so a larger id means
  // this receipt created it; a smaller one means the stock was loaded into a
  // handling unit that already existed.
  const createdHere = cmpId(hu.id, r.id) > 0;
  if (createdHere) {
    const ok =
      items.length === 1 &&
      S(items[0].material_id) === S(r.item_id) &&
      S(items[0].batch_id) === S(r.batch_number_id) &&
      Math.abs(num(items[0].quantity) - num(r.base_qty)) <= EPS;
    if (!ok) {
      flag("hu_items_mismatch", huId, "Handling unit " + S(hu.handling_no) + " no longer holds only this receipt's stock.");
      continue;
    }
    const packaging = huOutRows.find((o) => S(o.trx_no) === S(hu.handling_no));
    huActionFor[S(r.id)] = {
      action: "delete",
      huId: huId,
      handlingNo: S(hu.handling_no),
      packaging: packaging
        ? {
            material_id: S(packaging.item_id),
            quantity: roundQty(packaging.quantity),
            material_uom: S(packaging.uom_id),
            unit_price: roundPrice(packaging.unit_price),
            location_id: S(packaging.bin_location_id),
            trx_no: S(packaging.trx_no),
            itemData: itemById[S(packaging.item_id)] || null,
          }
        : null,
    };
  } else {
    const mine = items.filter((i) => S(i.material_id) === S(r.item_id) && S(i.batch_id) === S(r.batch_number_id));
    const held = mine.reduce((s, i) => s + num(i.quantity), 0);
    if (mine.length === 0 || held < num(r.base_qty) - EPS) {
      flag("hu_items_mismatch", huId, "Handling unit " + S(hu.handling_no) + " no longer holds the " + roundQty(r.base_qty) + " of " + nameOf(r.item_id) + " loaded from this receipt.");
      continue;
    }
    huActionFor[S(r.id)] = {
      action: "unload",
      huId: huId,
      handlingNo: S(hu.handling_no),
      plantId: S(hu.plant_id),
      storageLocationId: S(hu.storage_location_id),
      locationId: S(hu.location_id),
      items: [
        {
          material_id: S(r.item_id),
          balance_id: S(mine[0].balance_id),
          batch_id: S(r.batch_number_id) || null,
          quantity: roundQty(r.base_qty),
        },
      ],
      packaging: null,
    };
  }
}

// --- 8. Documents the receipt created --------------------------------------
const putawayDeletes = [];
for (const to of putawayRows) {
  const st = S(to.to_status);
  const items = flattenTree(asArr(parseJson(to.table_putaway_item) || []));
  const records = asArr(parseJson(to.table_putaway_records) || []);
  const started =
    (st !== "Created" && st !== "Draft") ||
    Number(to.is_processing) === 1 ||
    S(to.qi_id) !== "" ||
    records.length > 0 ||
    items.some((i) => S(i.line_status) !== "Open" || num(i.putaway_qty) > EPS);
  if (started) {
    flag("putaway_progressed", to.id, "Putaway " + S(to.to_id) + " has already been started (" + st + ").");
    continue;
  }
  putawayDeletes.push({ id: S(to.id) });
}

const qiDeletes = [];
for (const lot of qiRows) {
  if (S(lot.receiving_insp_status) !== "Created") {
    flag("inspection_progressed", lot.id, "Inspection lot " + S(lot.inspection_lot_no) + " is " + S(lot.receiving_insp_status) + ".");
    continue;
  }
  qiDeletes.push({ id: S(lot.id) });
}

const transitUpdates = [];
for (const t of transitRows) {
  if (S(t.status) !== "In Transit") continue;
  if (Math.abs(num(t.open_qty) - num(t.transit_qty)) > EPS) {
    flag("transit_consumed", t.id, "Part of the in-transit quantity for " + nameOf(t.material_id) + " has already been put away.");
    continue;
  }
  transitUpdates.push({ id: S(t.id), status: "Cancelled", open_qty: "0.000" });
}

// A batch minted by a split parent is never looked up again on re-completion,
// so leaving it behind would mint a second batch with the same number. Batches
// created through the inventory workflow ARE looked up, so those are kept and
// reused.
const liveBatchIds = {};
for (const r of liveRows) if (S(r.batch_number_id)) liveBatchIds[S(r.batch_number_id)] = 1;
const batchDeletes = [];
for (const b of batchRows) {
  if (!S(b.parent_transaction_no)) continue;
  if (!liveBatchIds[S(b.id)]) continue;
  batchDeletes.push({ id: S(b.id) });
}

// --- 9. Purchase order side -------------------------------------------------
const recvByLine = {};
const baseByLine = {};
const resByLine = {};
for (const l of lines) {
  const lid = S(l.po_line_item_id);
  if (!lid) continue;
  if (updatesPOLine(l) === 1) recvByLine[lid] = roundQty((recvByLine[lid] || 0) + num(l.received_qty));
  if (updatesOnOrder(l) === 1) {
    baseByLine[lid] = roundQty((baseByLine[lid] || 0) + (num(l.base_received_qty) || num(l.received_qty)));
  }
  if (!isSplitParent(l)) resByLine[lid] = roundQty((resByLine[lid] || 0) + num(l.received_qty));
}

const poLineUpdates = [];
const updById = {};
for (const po of poRecords) {
  for (const pl of flattenTree(po.table_po)) {
    const lid = S(pl.id);
    const recv = recvByLine[lid];
    if (recv === undefined) continue;
    const res = resByLine[lid] || 0;
    const quantity = num(pl.quantity);
    const newRecv = Math.max(0, roundQty(num(pl.received_qty) - recv));
    const outstanding = Math.max(0, roundQty(quantity - newRecv));
    const cur = S(pl.line_status);
    let lineStatus;
    if (cur === "Cancelled" || cur === "Draft") {
      lineStatus = cur;
    } else if (quantity > 0 && newRecv >= quantity - EPS) {
      lineStatus = "Completed";
    } else if (newRecv > EPS) {
      lineStatus = "Processing";
    } else {
      lineStatus = "Issued";
    }
    const upd = {
      id: lid,
      received_qty: qtyStr(newRecv),
      outstanding_quantity: qtyStr(outstanding),
      line_status: lineStatus,
      created_received_qty: qtyStr(num(pl.created_received_qty) + res),
    };
    poLineUpdates.push(upd);
    updById[lid] = upd;
  }
}
for (const lid of Object.keys(recvByLine)) {
  if (!updById[lid]) flag("po_line_missing", lid, "Purchase order line " + lid + " no longer exists.");
  if (Math.abs((resByLine[lid] || 0) - recvByLine[lid]) > EPS) {
    flag("split_rollup_mismatch", lid, "Received and reserved quantities disagree for purchase order line " + lid + ".");
  }
}

const onOrderUpdates = [];
for (const oo of onOrderRows) {
  const base = baseByLine[S(oo.po_line_id)];
  if (base === undefined) continue;
  const newRecv = Math.max(0, roundQty(num(oo.received_qty) - base));
  onOrderUpdates.push({
    id: S(oo.id),
    received_qty: qtyStr(newRecv),
    open_qty: qtyStr(Math.max(0, roundQty(num(oo.scheduled_qty) - newRecv))),
  });
}

// An item bundle is ONE receivable line: the bundle row is counted, its items
// are not. Same rule the completion workflow uses.
const isBundleChildLine = (item) => Boolean(item.item_bundle_id) && Boolean(item.item_id);
const poHeaderUpdates = [];
for (const po of poRecords) {
  const tablePO = asArr(po.table_po).filter((i) => !isBundleChildLine(i));
  if (tablePO.length === 0) continue;
  let partially = 0;
  let fully = 0;
  for (const item of tablePO) {
    const upd = updById[S(item.id)];
    const quantity = num(item.quantity);
    const receivedQty = upd ? num(upd.received_qty) : num(item.received_qty);
    if (receivedQty > 0) {
      partially++;
      if (receivedQty >= quantity) fully++;
    }
  }
  const curStatus = S(po.po_status);
  let newPOStatus = curStatus;
  if (fully === tablePO.length) {
    newPOStatus = "Completed";
  } else if (partially > 0) {
    newPOStatus = "Processing";
  } else if (curStatus === "Processing" || curStatus === "Completed") {
    // Nothing is received against this purchase order any more, so it goes back
    // to the state it had before the first receipt. Draft and Cancelled are
    // left alone.
    newPOStatus = "Issued";
  }
  poHeaderUpdates.push({
    id: S(po.id),
    po_status: newPOStatus,
    gr_status: "Created",
    partially_received: partially + " / " + tablePO.length,
    fully_received: fully + " / " + tablePO.length,
  });
}

// --- 10. Reverse payload ----------------------------------------------------
const subtracts = [];
if (conflicts.length === 0) {
  for (let i = 0; i < liveRows.length; i++) {
    const r = liveRows[i];
    const hu = huActionFor[S(r.id)] || null;
    const waU = waUpdateFor[S(r.id)] || null;
    const pack = hu && hu.packaging ? hu.packaging : null;
    subtracts.push({
      index: i,
      material_id: S(r.item_id),
      quantity: roundQty(r.quantity),
      material_uom: S(r.uom_id),
      unit_price: roundPrice(r.unit_price),
      inventory_category: S(r.inventory_category),
      location_id: S(r.bin_location_id),
      batch_id: S(r.batch_number_id) || null,
      handling_unit_id: S(r.handling_unit_id),
      parent_trx_no: S(r.parent_trx_no),
      itemData: itemById[S(r.item_id)] || null,
      doc_date: docDate,
      failLabel:
        "Item " + nameOf(r.item_id) + " (" + roundQty(r.base_qty) + " " + S(r.inventory_category) + ")",
      fifoDeleteId: fifoDeleteFor[S(r.id)] || "",
      hasFifoDelete: fifoDeleteFor[S(r.id)] ? 1 : 0,
      waDeleteId: waDeleteFor[S(r.id)] || "",
      hasWaDelete: waDeleteFor[S(r.id)] ? 1 : 0,
      waUpdateId: waU ? waU.id : "",
      waQuantity: waU ? waU.wa_quantity : "0.000",
      waCostPrice: waU ? waU.wa_cost_price : "0.0000",
      hasWaUpdate: waU ? 1 : 0,
      huId: hu ? hu.huId : "",
      huHandlingNo: hu ? hu.handlingNo : "",
      huIsDelete: hu && hu.action === "delete" ? 1 : 0,
      huIsUnload: hu && hu.action === "unload" ? 1 : 0,
      huPlantId: hu && hu.plantId ? hu.plantId : plantId,
      huStorageLocationId: hu && hu.storageLocationId ? hu.storageLocationId : "",
      huLocationId: hu && hu.locationId ? hu.locationId : "",
      huItems: hu && hu.items ? hu.items : [],
      hasHuReadd: pack ? 1 : 0,
      readdMaterialId: pack ? pack.material_id : "",
      readdQuantity: pack ? pack.quantity : 0,
      readdUom: pack ? pack.material_uom : "",
      readdUnitPrice: pack ? pack.unit_price : 0,
      readdLocationId: pack ? pack.location_id : "",
      readdTrxNo: pack ? pack.trx_no : "",
      readdItemData: pack ? pack.itemData : null,
    });
  }
}

const hasConflicts = conflicts.length > 0 ? 1 : 0;
const gate = (arr) => (hasConflicts === 1 ? [] : arr);
const flagOf = (arr) => (hasConflicts === 0 && arr.length > 0 ? 1 : 0);

const outPoLines = gate(poLineUpdates);
const outOnOrder = gate(onOrderUpdates);
const outPoHeaders = gate(poHeaderUpdates);
const outPutaway = gate(putawayDeletes);
const outTransit = gate(transitUpdates);
const outQi = gate(qiDeletes);
const outBatch = gate(batchDeletes);

return {
  hasConflicts: hasConflicts,
  conflictCount: conflicts.length,
  conflicts: conflicts,
  subtracts: subtracts,
  hasSubtracts: flagOf(subtracts),
  poLineUpdates: outPoLines,
  hasPoLineUpdates: flagOf(outPoLines),
  onOrderUpdates: outOnOrder,
  hasOnOrderUpdates: flagOf(outOnOrder),
  poHeaderUpdates: outPoHeaders,
  hasPoHeaderUpdates: flagOf(outPoHeaders),
  putawayDeletes: outPutaway,
  hasPutawayDeletes: flagOf(outPutaway),
  transitUpdates: outTransit,
  hasTransitUpdates: flagOf(outTransit),
  qiDeletes: outQi,
  hasQiDeletes: flagOf(outQi),
  batchDeletes: outBatch,
  hasBatchDeletes: flagOf(outBatch),
};
