// INVENTORY_BULK_APPLY planner. Replays SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW in list order over in-memory
// copies of the rows those workflows read, so every movement sees the writes of the ones before it, then returns
// each touched row once (before/after) plus the inventory_movement rows. All-or-nothing: the first movement the old
// workflows would fail fails the whole plan and nothing is written.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const s = (v) => (v === undefined || v === null ? "" : String(v));
const CATEGORY_FIELD = {
  Unrestricted: "unrestricted_qty",
  Reserved: "reserved_qty",
  Blocked: "block_qty",
  "Quality Inspection": "qualityinsp_qty",
  "In Transit": "intransit_qty",
};
const QTY_COLS = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const FIFO = "First In First Out";
const WA = "Weighted Average";
const FIXED = "Fixed Cost";

// a stored decimal as the platform keeps it: dp decimals of the exact 8-dp value, mode = the number rule's precision_rule
// (1 round half-up, 2 truncate toward zero, 3 away from zero)
function roundDec(v, dp, mode) {
  const x = q8(v);
  if (!(dp >= 0 && dp < 8)) return x;
  const t = Math.abs(x).toFixed(8);
  const cut = t.indexOf(".") + 1 + dp;
  let head = t.slice(0, cut);
  const rest = t.slice(cut);
  const up = Number(mode) === 2 ? false : Number(mode) === 3 ? /[1-9]/.test(rest) : rest.charCodeAt(0) >= 53;
  if (up) {
    const digits = head.replace(".", "").split("");
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === "9") digits[i--] = "0";
    if (i < 0) digits.unshift("1");
    else digits[i] = String(Number(digits[i]) + 1);
    const intLen = digits.length - dp;
    head = digits.slice(0, intLen).join("") + (dp ? "." + digits.slice(intLen).join("") : "");
  }
  const r = Number(head.replace(/\.$/, ""));
  return x < 0 && r !== 0 ? -r : r;
}
const roundHalfUp = (v, dp) => roundDec(v, dp, 1);
// the written numbers bound to "Inventory Price" (schema numberRule); every other one is "Inventory Qty"
const PRICE_COLUMNS = { unit_price: 1, total_price: 1, fifo_cost_price: 1, wa_cost_price: 1 };

function planBulk(input) {
  const movements = Array.isArray(input.movements) ? input.movements : [];
  const items = input.items || {};
  const nowText = input.nowText || "";
  // the tenant's number rules: a stored column holds what the platform rounded it to, and a later movement reads that back
  // (as the old path's next call did). input.precision = { price, qty, columns: { "<table>.<column>": rule } }, a rule
  // being { dp, mode } (a bare number = dp, half-up); none = 8 dp
  const P = input.precision || {};
  const ruleOf = (r) => (r === undefined || r === null ? null : typeof r === "number" ? { dp: r, mode: 1 } : r);
  const rc = (table, col, v) => {
    const cols = P.columns || {};
    const r = ruleOf(Object.prototype.hasOwnProperty.call(cols, table + "." + col) ? cols[table + "." + col] : PRICE_COLUMNS[col] ? P.price : P.qty);
    return r && r.dp !== null && r.dp !== undefined ? roundDec(v, r.dp, r.mode) : q8(v);
  };
  let seq = 0;
  const newId = (kind) => "new:" + kind + ":" + ++seq;

  // ---------------------------------------------------------------- indexed state (copies; originals kept for before)
  const index = (rows, keyOf) => {
    const map = {};
    const dup = {};
    for (const r of rows || []) {
      const k = keyOf(r);
      if (map[k]) dup[k] = true;
      else map[k] = r;
    }
    return { map, dup };
  };
  const cloneRows = (rows) => (rows || []).map((r) => Object.assign({}, r, { id: s(r.id) }));
  const balKey = (m, loc, plant, org) => [s(m), s(loc), s(plant), s(org)].join("|");
  const batchKey = (m, loc, batch, plant, org) => [s(m), s(loc), s(batch), s(plant), s(org)].join("|");
  const costKey = (m, plant, org, batch) => [s(m), s(plant), s(org), s(batch)].join("|");

  const itemBalIdx = index(cloneRows(input.itemBalances), (r) => balKey(r.material_id, r.location_id, r.plant_id, r.organization_id));
  const batchBalIdx = index(cloneRows(input.batchBalances), (r) => batchKey(r.material_id, r.location_id, r.batch_id, r.plant_id, r.organization_id));
  const fifoRows = cloneRows(input.fifoLayers);
  const waRows = cloneRows(input.waRows);

  const before = { item_balance: {}, item_batch_balance: {}, fifo: {}, wa: {} };
  const touched = { item_balance: {}, item_batch_balance: {}, fifo: {}, wa: {} };
  const created = { item_balance: [], item_batch_balance: [], fifo: [], wa: [], batch: [] };
  // a column first touched by a later movement joins the row's snapshot (its value is still the one read)
  const snap = (table, row, cols) => {
    if (row.id.indexOf("new:") === 0) return;
    const b = before[table][row.id] || (before[table][row.id] = {});
    for (const c of cols) if (!(c in b)) b[c] = row[c] === undefined ? null : row[c];
  };
  const touch = (table, row) => {
    if (row.id.indexOf("new:") !== 0) touched[table][row.id] = row;
  };

  const results = [];
  const movementRows = [];
  const byKey = {};
  const fail = (m, code, message) => ({ ok: false, failure: { code, movement_key: s(m && m.movement_key), message }, results });

  const uomOf = (item, m) => {
    const altQty = q8(parseFloat(m.quantity));
    let baseQty = altQty;
    const altUOM = m.material_uom || item.based_uom;
    const conv = Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion.find((c) => c.alt_uom_id === altUOM) : null;
    if (conv) baseQty = q8(altQty * conv.base_qty);
    return { altQty, baseQty, altUOM, baseUOM: item.based_uom, method: item.material_costing_method };
  };
  const fifoFor = (m, plant, org, batch) => fifoRows.filter((r) => costKey(r.material_id, r.plant_id, r.organization_id, r.batch_id) === costKey(m, plant, org, batch));
  const waFor = (m, plant, org, batch) => waRows.filter((r) => costKey(r.material_id, r.plant_id, r.organization_id, r.batch_id) === costKey(m, plant, org, batch));
  const newestWa = (rows) =>
    rows.slice().sort((a, b) => (a.created_at && b.created_at ? new Date(b.created_at) - new Date(a.created_at) : 0))[0];

  for (const m of movements) {
    const key = s(m.movement_key);
    if (!key || byKey[key]) return fail(m, "REQUEST_INVALID", "movement_key missing or repeated: " + key);
    const dir = s(m.direction);
    if (dir !== "SUBTRACT" && dir !== "ADD") return fail(m, "REQUEST_INVALID", "direction must be SUBTRACT or ADD");

    // a release pair: the ADD takes the price and dates its SUBTRACT computed (GD_UNUSED_FN_NEW passes them on)
    if (m.unit_price_from) {
      const src = byKey[s(m.unit_price_from)];
      if (!src) return fail(m, "REQUEST_INVALID", "unit_price_from " + s(m.unit_price_from) + " is not an earlier movement");
      m.unit_price = src.unit_price;
      m.manufacturing_date = src.manufacturing_date;
      m.expired_date = src.expired_date;
    }

    const qtyNum = parseFloat(m.quantity);
    const missing = !s(m.material_id) || m.quantity === undefined || m.quantity === null || !(qtyNum > 0) || !s(m.plant_id) || !s(m.organization_id);
    if (missing || (dir === "SUBTRACT" && !s(m.inventory_category))) return fail(m, "VALIDATION_FAILED", "Validation Failed");
    if (s(m.unit_price) !== "" && q8(m.unit_price) < 0) return fail(m, "UNSUPPORTED_PRICE", "Negative unit price " + s(m.unit_price));

    const item = items[s(m.material_id)];
    if (!item) return fail(m, "ITEM_NOT_FOUND", "Item " + s(m.material_id) + " not found");
    if (Number(item.stock_control) === 0) {
      const r = { movement_key: key, direction: dir, code: "401", message: "Skipping inventory update for item (stock control = 0)" };
      results.push(r);
      byKey[key] = r;
      continue;
    }
    const u = uomOf(item, m);
    const isMovingInv = m.isMovingInv === undefined || m.isMovingInv === null ? 0 : Number(m.isMovingInv);
    const plant = s(m.plant_id);
    const org = s(m.organization_id);
    const mat = s(m.material_id);
    const loc = s(m.location_id);

    if (dir === "SUBTRACT") {
      const batch = s(m.batch_id);
      const categoryField = CATEGORY_FIELD[m.inventory_category];
      const bk = balKey(mat, loc, plant, org);
      if (itemBalIdx.dup[bk]) return fail(m, "DUPLICATE_BALANCE", "More than one item_balance row for " + bk);
      const itemRow = itemBalIdx.map[bk] || null;
      let batchRow = null;
      if (batch) {
        const tk = batchKey(mat, loc, batch, plant, org);
        if (batchBalIdx.dup[tk]) return fail(m, "DUPLICATE_BALANCE", "More than one item_batch_balance row for " + tk);
        batchRow = batchBalIdx.map[tk] || null;
        if (!batchRow && !itemRow) return fail(m, "BALANCE_NOT_FOUND", "Balance not found");
      }
      const existing = (batch ? batchRow : itemRow) || {};
      let mfg = m.manufacturing_date || null;
      let exp = m.expired_date || null;
      if (batch && (!mfg || !exp)) {
        mfg = existing.manufacturing_date === undefined ? null : existing.manufacturing_date;
        exp = existing.expired_date === undefined ? null : existing.expired_date;
      }
      if (q8(existing[categoryField] || 0) < u.baseQty) return fail(m, "INSUFFICIENT", "Insufficient quantity");

      const fifo = fifoFor(mat, plant, org, batch || null);
      const wa = waFor(mat, plant, org, batch || null);
      // SUBTRACT's "Migration Condition": the old branch rewrites costing rows from stale reads - refused here. A
      // category move with its price given reads and writes no costing row, so it goes through
      const priced = isMovingInv === 1 && q8(m.unit_price) > 0;
      if (!priced && ((wa.length > 0 && fifo.length > 0) || (u.method === FIFO && fifo.length === 0 && wa.length > 0) || (u.method === WA && wa.length === 0 && fifo.length > 0))) {
        return fail(m, "UNSUPPORTED_COSTING", "Item " + mat + " has costing rows that need migration (FIFO " + fifo.length + ", WA " + wa.length + ")");
      }

      let price = 0;
      if (isMovingInv === 1 && m.unit_price) price = q8(m.unit_price);
      else if (u.method === FIFO) price = fifoUnitPrice(fifo, u.baseQty);
      else if (u.method === WA) price = wa.length ? q8(newestWa(wa).wa_cost_price || 0) : 0;
      else if (u.method === FIXED) price = q8(parseFloat(item.purchase_unit_price || 0));
      if (price < 0) return fail(m, "UNSUPPORTED_PRICE", "Negative unit price " + price + " for material " + mat);
      const totalPrice = q8(price * u.baseQty);

      const deduct = (row) => {
        const tb = row === itemRow ? "item_balance" : "item_batch_balance";
        snap(tb, row, QTY_COLS);
        for (const c of QTY_COLS.slice(0, 5)) row[c] = rc(tb, c, q8(row[c] || 0) - (c === categoryField ? u.baseQty : 0));
        row.balance_quantity = rc(tb, "balance_quantity", q8(row.balance_quantity || 0) - u.baseQty);
      };
      if (itemRow) {
        deduct(itemRow);
        touch("item_balance", itemRow);
      }
      if (batch && batchRow) {
        snap("item_batch_balance", batchRow, QTY_COLS);
        for (const c of QTY_COLS.slice(0, 5)) batchRow[c] = rc("item_batch_balance", c, q8(batchRow[c] || 0) - (c === categoryField ? u.baseQty : 0));
        batchRow.balance_quantity = rc("item_batch_balance", "balance_quantity", q8(batchRow.balance_quantity || 0) - u.baseQty);
        touch("item_batch_balance", batchRow);
      }

      if (isMovingInv === 0) {
        if (u.method === FIFO) {
          let remaining = q8(u.baseQty);
          for (const layer of fifo.slice().sort((a, b) => (a.fifo_sequence || 0) - (b.fifo_sequence || 0))) {
            if (remaining <= 0) break;
            const avail = q8(layer.fifo_available_quantity || 0);
            if (avail <= 0) continue;
            const take = Math.min(remaining, avail);
            snap("fifo", layer, ["fifo_available_quantity"]);
            layer.fifo_available_quantity = rc("fifo_costing_history", "fifo_available_quantity", avail - take);
            touch("fifo", layer);
            remaining = q8(remaining - take);
          }
        } else if (u.method === WA) {
          const doc = newestWa(wa);
          if (!doc) {
            return fail(m, "NO_WA_RECORD", "No Weighted Average costing record for material " + mat + ", batch " + (batch || "(none)") + ", plant " + plant + " -- create the costing record for this plant before issuing this stock.");
          }
          snap("wa", doc, ["wa_quantity", "wa_cost_price"]);
          doc.wa_quantity = Math.max(0, rc("wa_costing_method", "wa_quantity", q8(doc.wa_quantity || 0) - q8(u.baseQty)));
          touch("wa", doc);
        }
      }

      movementRows.push({
        operation_effect_key: s(input.operationKey) + "|" + key,
        transaction_type: m.transaction_type,
        trx_no: m.trx_no,
        inventory_category: m.inventory_category,
        parent_trx_no: m.parent_trx_no === undefined ? null : m.parent_trx_no,
        movement: "OUT",
        plant_id: plant,
        organization_id: org,
        unit_price: rc("inventory_movement", "unit_price", price),
        total_price: rc("inventory_movement", "total_price", totalPrice),
        quantity: rc("inventory_movement", "quantity", u.altQty),
        base_qty: rc("inventory_movement", "base_qty", u.baseQty),
        uom_id: u.altUOM,
        base_uom_id: u.baseUOM,
        item_id: mat,
        bin_location_id: loc,
        batch_number_id: batch || null,
        costing_method_id: u.method,
        manufacturing_date: mfg,
        expired_date: exp,
        doc_date: m.doc_date,
        actual_qty: rc("inventory_movement", "actual_qty", -u.altQty),
        actual_base_qty: rc("inventory_movement", "actual_base_qty", -u.baseQty),
        handling_unit_id: m.handling_unit_id === undefined ? null : m.handling_unit_id,
      });
      const r = { movement_key: key, direction: dir, code: "200", unit_price: price, total_price: totalPrice, manufacturing_date: mfg, expired_date: exp };
      results.push(r);
      byKey[key] = r;
      continue;
    }

    // ------------------------------------------------------------------------------------------------ ADD
    const trx = m.transaction_type;
    let unitPrice = m.unit_price;
    let totalPrice = unitPrice * u.baseQty;
    let costPrice = null;
    let fixedPrice = null;
    if (trx !== undefined && trx !== null && trx !== "LOT") {
      if (u.method === FIFO || u.method === WA) {
        let up = q8(m.unit_price);
        let tp = q8(up * u.baseQty);
        if (trx === "GRN") {
          const poQ = q8(parseFloat(m.po_quantity) || 0);
          const amt = q8(parseFloat(m.po_amount) || 0);
          const conversion = q8(u.baseQty / parseFloat(m.quantity));
          const rate = m.exchange_rate || 1;
          const ppu = poQ > 0 ? q8(amt / poQ) : 0;
          up = q8((ppu / conversion) * rate);
          tp = q8(up * u.baseQty);
        }
        costPrice = { up, tp };
      } else {
        const up = q8(item.purchase_unit_price);
        fixedPrice = { up, tp: q8(up * u.baseQty) };
      }
    }
    if (trx !== "LOT") {
      if (u.method === FIFO || u.method === WA) {
        unitPrice = costPrice ? costPrice.up : undefined;
        totalPrice = costPrice ? costPrice.tp : undefined;
      } else if (u.method === FIXED) {
        unitPrice = fixedPrice ? fixedPrice.up : undefined;
        totalPrice = fixedPrice ? fixedPrice.tp : undefined;
      }
    }
    unitPrice = q8(unitPrice);
    totalPrice = q8(totalPrice);
    if (unitPrice < 0 || totalPrice < 0) return fail(m, "UNSUPPORTED_PRICE", "Negative unit price " + unitPrice + " for material " + mat);

    let batchId = m.batch_id || null;
    if (m.batch_number !== "-" && m.batch_number && !m.batch_id) {
      batchId = newId("batch");
      created.batch.push({
        id: batchId,
        batch_number: m.batch_number,
        material_id: mat,
        initial_quantity: rc("batch", "initial_quantity", u.baseQty),
        transaction_no: m.trx_no,
        plant_id: plant,
        organization_id: org,
        remark: m.remark === undefined ? null : m.remark,
        remark2: m.remark2 === undefined ? null : m.remark2,
        remark3: m.remark3 === undefined ? null : m.remark3,
        manufacturing_date: m.manufacturing_date === undefined ? null : m.manufacturing_date,
        expired_date: m.expired_date === undefined ? null : m.expired_date,
      });
    }

    const add = { unrestricted_qty: 0, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0 };
    const cat = m.inventory_category;
    const col = cat === "Blocked" ? "block_qty" : cat === "Reserved" ? "reserved_qty" : cat === "Quality Inspection" ? "qualityinsp_qty" : cat === "In Transit" ? "intransit_qty" : "unrestricted_qty";
    add[col] = q8(parseFloat(u.baseQty || 0));
    add.balance_quantity = q8(add.block_qty + add.reserved_qty + add.unrestricted_qty + add.qualityinsp_qty + add.intransit_qty);
    const stored = (table) => {
      const o = {};
      for (const c of QTY_COLS) o[c] = rc(table, c, add[c]);
      return o;
    };

    if (batchId) {
      const tk = batchKey(mat, loc, batchId, plant, org);
      if (batchBalIdx.dup[tk]) return fail(m, "DUPLICATE_BALANCE", "More than one item_batch_balance row for " + tk);
      const row = batchBalIdx.map[tk];
      if (row) {
        snap("item_batch_balance", row, QTY_COLS.concat(["remark", "remark2", "remark3"]));
        for (const c of QTY_COLS) row[c] = rc("item_batch_balance", c, q8(row[c] || 0) + q8(add[c] || 0));
        const remarkOf = (nv, ev) => (nv != null && nv !== ev ? nv : ev || "");
        row.remark = remarkOf(m.remark, row.remark);
        row.remark2 = remarkOf(m.remark2, row.remark2);
        row.remark3 = remarkOf(m.remark3, row.remark3);
        touch("item_batch_balance", row);
      } else {
        const nr = Object.assign({ id: newId("item_batch_balance"), material_id: mat, material_uom: u.baseUOM, location_id: loc }, stored("item_batch_balance"), {
          batch_id: batchId,
          plant_id: plant,
          organization_id: org,
          doc_date: m.doc_date === undefined ? null : m.doc_date,
          manufacturing_date: m.manufacturing_date === undefined ? null : m.manufacturing_date,
          expired_date: m.expired_date === undefined ? null : m.expired_date,
          remark: m.remark === undefined ? null : m.remark,
          remark2: m.remark2 === undefined ? null : m.remark2,
          remark3: m.remark3 === undefined ? null : m.remark3,
        });
        batchBalIdx.map[tk] = nr;
        created.item_batch_balance.push(nr);
      }
    }
    const bk = balKey(mat, loc, plant, org);
    if (itemBalIdx.dup[bk]) return fail(m, "DUPLICATE_BALANCE", "More than one item_balance row for " + bk);
    const itemRow = itemBalIdx.map[bk];
    if (itemRow) {
      snap("item_balance", itemRow, QTY_COLS);
      for (const c of QTY_COLS) itemRow[c] = rc("item_balance", c, q8(itemRow[c] || 0) + q8(add[c] || 0));
      touch("item_balance", itemRow);
    } else {
      const nr = Object.assign({ id: newId("item_balance"), material_id: mat, material_uom: u.baseUOM, location_id: loc }, stored("item_balance"), { plant_id: plant, organization_id: org });
      itemBalIdx.map[bk] = nr;
      created.item_balance.push(nr);
    }

    if (isMovingInv === 0) {
      if (u.method === FIFO) {
        const layers = fifoFor(mat, plant, org, batchId);
        const next = layers.length ? Math.max(...layers.map((l) => parseInt(l.fifo_sequence || 0, 10)), 0) + 1 : 1;
        const layer = {
          id: newId("fifo"),
          fifo_cost_price: rc("fifo_costing_history", "fifo_cost_price", unitPrice),
          fifo_initial_quantity: rc("fifo_costing_history", "fifo_initial_quantity", u.baseQty),
          fifo_available_quantity: rc("fifo_costing_history", "fifo_available_quantity", u.baseQty),
          material_id: mat,
          batch_id: batchId,
          fifo_sequence: String(next),
          plant_id: plant,
          organization_id: org,
        };
        fifoRows.push(layer);
        created.fifo.push(layer);
      } else if (u.method === WA) {
        if (batchId) {
          const row = { id: newId("wa"), wa_cost_price: rc("wa_costing_method", "wa_cost_price", unitPrice), wa_quantity: rc("wa_costing_method", "wa_quantity", u.baseQty), material_id: mat, batch_id: batchId, plant_id: plant, organization_id: org, created_at: nowText };
          waRows.push(row);
          created.wa.push(row);
        } else {
          const any = waRows.filter((r) => s(r.material_id) === mat && s(r.plant_id) === plant && s(r.organization_id) === org);
          if (any.length) {
            const latest = newestWa(any);
            const wc = q8(latest.wa_cost_price);
            const wq = q8(latest.wa_quantity);
            const nq = q8(wq + u.baseQty);
            snap("wa", latest, ["wa_quantity", "wa_cost_price"]);
            latest.wa_cost_price = rc("wa_costing_method", "wa_cost_price", q8((wc * wq + unitPrice * u.baseQty) / nq));
            latest.wa_quantity = rc("wa_costing_method", "wa_quantity", nq);
            touch("wa", latest);
          } else {
            const row = { id: newId("wa"), wa_cost_price: rc("wa_costing_method", "wa_cost_price", unitPrice), wa_quantity: rc("wa_costing_method", "wa_quantity", u.baseQty), material_id: mat, plant_id: plant, organization_id: org, created_at: nowText };
            waRows.push(row);
            created.wa.push(row);
          }
        }
      }
    }

    movementRows.push({
      operation_effect_key: s(input.operationKey) + "|" + key,
      transaction_type: trx,
      trx_no: m.trx_no,
      inventory_category: cat,
      parent_trx_no: m.parent_trx_no === undefined ? null : m.parent_trx_no,
      movement: "IN",
      plant_id: plant,
      organization_id: org,
      doc_date: m.doc_date,
      manufacturing_date: m.manufacturing_date === undefined ? null : m.manufacturing_date,
      expired_date: m.expired_date === undefined ? null : m.expired_date,
      unit_price: rc("inventory_movement", "unit_price", unitPrice),
      total_price: rc("inventory_movement", "total_price", totalPrice),
      quantity: rc("inventory_movement", "quantity", u.altQty),
      base_qty: rc("inventory_movement", "base_qty", u.baseQty),
      uom_id: u.altUOM,
      base_uom_id: u.baseUOM,
      item_id: mat,
      bin_location_id: loc,
      batch_number_id: batchId,
      costing_method_id: u.method,
      actual_qty: rc("inventory_movement", "actual_qty", u.altQty),
      actual_base_qty: rc("inventory_movement", "actual_base_qty", u.baseQty),
      handling_unit_id: m.handling_unit_id === undefined ? null : m.handling_unit_id,
    });
    const r = { movement_key: key, direction: dir, code: "200", batch_id: batchId, unit_price: unitPrice, total_price: totalPrice };
    results.push(r);
    byKey[key] = r;
  }

  const updates = {};
  for (const t of Object.keys(touched)) {
    updates[t] = Object.keys(touched[t]).map((id) => {
      const row = touched[t][id];
      const cols = Object.keys(before[t][id]);
      const after = {};
      for (const c of cols) after[c] = row[c] === undefined ? null : row[c];
      return { id, before: before[t][id], after };
    });
  }
  return { ok: true, results, updates, creates: created, movements: movementRows };
}

// SUBTRACT_INVENTORY_NEW code_node_BnKFTznr: weighted cost of the layers the quantity would use; a shortfall is
// priced at the highest-sequence layer, used up or not
function fifoUnitPrice(layers, baseQty) {
  if (!layers.length) return 0;
  const sorted = layers.slice().sort((a, b) => a.fifo_sequence - b.fifo_sequence);
  let remaining = q8(baseQty);
  let totalCost = 0;
  let totalQty = 0;
  for (const r of sorted) {
    if (remaining <= 0) break;
    const avail = q8(r.fifo_available_quantity || 0);
    if (avail <= 0) continue;
    const cost = q8(r.fifo_cost_price || 0);
    const take = Math.min(avail, remaining);
    totalCost = q8(totalCost + take * cost);
    totalQty = q8(totalQty + take);
    remaining = q8(remaining - take);
  }
  if (remaining > 0) {
    totalCost = q8(totalCost + remaining * q8(sorted[sorted.length - 1].fifo_cost_price || 0));
    totalQty = q8(totalQty + remaining);
  }
  return totalQty > 0 ? q8(totalCost / totalQty) : 0;
}

if (typeof module !== "undefined") module.exports = { planBulk, fifoUnitPrice, q8, roundHalfUp, roundDec };
