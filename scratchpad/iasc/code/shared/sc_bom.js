// Small Cycle IA BOM resolver (scratchpad/iasc/CONTRACT.md section 5): pure, ES2015; reads injected through io
const scS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const scNum = (v) => {
  const x = parseFloat(v);
  return isFinite(x) ? x : 0;
};
const scQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const scUniq = (list) => {
  const seen = {};
  const out = [];
  (list || []).forEach((v) => {
    const t = scS(v);
    if (t && !seen[t]) {
      seen[t] = 1;
      out.push(t);
    }
  });
  return out;
};
// JSON text with 16+ digit integer tokens kept as strings (ids never become floats)
const scParseJ = (v) => {
  if (v && typeof v === "object") return v;
  const t = scS(v);
  if (!t) return null;
  try {
    return JSON.parse(t.replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
const scIsSerial = (it) => !!it && Number(it.serial_number_management) === 1;
const scIsNonStock = (it) => !!it && (it.stock_control === 0 || it.stock_control === "0");
const scVersionOf = (b) => {
  const m = /^V(\d+)$/.exec(scS(b && b.parent_mat_bom_version));
  return m ? parseInt(m[1], 10) : 0;
};
// today's explode rule: the default BOM first, else the highest V<n>
const scPickBom = (boms) => {
  const list = (boms || []).filter((b) => b && typeof b === "object");
  if (!list.length) return null;
  list.sort((a, b) => {
    const d = (Number(b.parent_mat_is_default) === 1 ? 1 : 0) - (Number(a.parent_mat_is_default) === 1 ? 1 : 0);
    return d !== 0 ? d : scVersionOf(b) - scVersionOf(a);
  });
  return list[0];
};
const scBomRows = (bom) => {
  let rows = bom && bom.subform_sub_material;
  if (typeof rows === "string") rows = scParseJ(rows);
  return (Array.isArray(rows) ? rows : []).filter((r) => r && scS(r.bom_material_code) && Number(r.is_deleted) !== 1);
};
const scUsableRows = (bom) => scBomRows(bom).filter((r) => r.consume_type !== "REF");
const scConvs = (it) => {
  let c = it && it.table_uom_conversion;
  if (typeof c === "string") c = scParseJ(c);
  return (Array.isArray(c) ? c : []).filter((x) => x && typeof x === "object");
};
// factor to the item's base UOM ("alt_qty alt = base_qty base"); null when unknown, never 1:1
const scToBase = (it, uom) => {
  if (!it) return null;
  const u = scS(uom);
  if (!u || u === scS(it.based_uom)) return 1;
  const c = scConvs(it).filter((x) => scS(x.alt_uom_id) === u)[0];
  if (!c) return null;
  const a = scNum(c.alt_qty);
  const b = scNum(c.base_qty);
  return a > 0 && b > 0 ? b / a : null;
};
const scChain = (s0, steps) => {
  let s = s0;
  let r = 0;
  for (let i = 0; i < steps.length; i++) {
    r = s * scNum(steps[i][0]) * (1 + scNum(steps[i][1]) / 100);
    if (i < steps.length - 1) s = r * scNum(steps[i][2]);
  }
  return r;
};
const scRowQty = (amount, serial) => {
  const q = scQ8(amount);
  return serial ? Math.ceil(q) : q;
};
const scFail = (code, message) => ({ scFail: true, code: code, message: message });

const scResolve = async (input, io) => {
  const inp = input || {};
  const mode = scS(inp.mode) === "FLAT" ? "FLAT" : "STANDARD";
  const maxDepth = inp.maxDepth || 6;
  const maxPaths = inp.maxPaths || 5000;
  const maxRows = inp.maxRows || 1000;
  const expand = mode === "FLAT" ? scUniq(inp.expand) : [];
  const ticked = {};
  expand.forEach((id) => {
    ticked[id] = 1;
  });
  const itemId = scS(inp.itemId);
  const itemUomId = scS(inp.itemUomId);
  const uomName = typeof inp.uomName === "function" ? inp.uomName : (id) => id;
  const bomsByItem = {};
  const items = {};
  if (inp.fg && scS(inp.fg.id)) items[scS(inp.fg.id)] = inp.fg;
  const nameOf = (id) => scS(items[id] && items[id].material_name) || id;
  const readBomsFor = async (ids) => {
    const want = scUniq(ids).filter((id) => !Object.prototype.hasOwnProperty.call(bomsByItem, id));
    if (!want.length) return;
    let got;
    try {
      got = await io.readBoms(want);
    } catch (e) {
      throw scFail("SC_READ_FAILED", "The Bill of Materials could not be read (" + scS(e && e.message) + "). Nothing was changed; please try again.");
    }
    want.forEach((id) => {
      bomsByItem[id] = [];
    });
    (Array.isArray(got) ? got : []).forEach((b) => {
      const p = scS(b && b.parent_material_code);
      if (Object.prototype.hasOwnProperty.call(bomsByItem, p)) bomsByItem[p].push(b);
    });
  };
  const readItemsFor = async (ids) => {
    const want = scUniq(ids).filter((id) => !Object.prototype.hasOwnProperty.call(items, id));
    if (!want.length) return;
    let got;
    try {
      got = await io.readItems(want);
    } catch (e) {
      throw scFail("SC_READ_FAILED", "The items could not be read (" + scS(e && e.message) + "). Nothing was changed; please try again.");
    }
    (Array.isArray(got) ? got : []).forEach((it) => {
      if (it && scS(it.id)) items[scS(it.id)] = it;
    });
    const missing = want.filter((id) => !Object.prototype.hasOwnProperty.call(items, id));
    if (missing.length) throw scFail("SC_READ_FAILED", "Some items could not be read (" + missing.slice(0, 5).join(", ") + "). Nothing was changed; please try again.");
  };
  const noConv = (it, from, to) => scFail("SC_NO_CONVERSION", "Item " + (scS(it && it.material_name) || scS(it && it.id)) + " has no unit conversion between "
    + uomName(from) + " and " + uomName(to) + ": add it on the item, or correct the BOM line.");
  try {
    await readBomsFor([itemId]);
    const root = scPickBom(bomsByItem[itemId]);
    if (!root) throw scFail("SC_NO_BOM", "No active Bill of Materials found for this item. Create a BOM before assembling it.");
    const rootVersion = scS(root.parent_mat_bom_version);
    const rootRows = scUsableRows(root);
    if (!rootRows.length) throw scFail("SC_BOM_EMPTY", "BOM " + rootVersion + " has no consumable sub materials.");
    const rootBase = scNum(root.parent_mat_base_quantity);
    if (rootBase <= 0) throw scFail("SC_BASE_ZERO", "BOM " + rootVersion + " has a base quantity of 0 and cannot be scaled.");
    const rootBaseUom = scS(root.parent_mat_base_uom);
    let rootConv = 1;
    if (rootBaseUom && itemUomId && rootBaseUom !== itemUomId) {
      if (!items[itemId]) await readItemsFor([itemId]);
      const f1 = scToBase(items[itemId], itemUomId);
      const f2 = scToBase(items[itemId], rootBaseUom);
      if (f1 === null || f2 === null) throw noConv(items[itemId], itemUomId, rootBaseUom);
      rootConv = f1 / f2;
    }
    const tree = [];
    if (mode === "FLAT") {
      const seen = {};
      seen[itemId] = 1;
      // a line of bom_type "reference" names its component's BOM (as the walk below reads it); the first such line of an item wins
      const refsOf = (rows) => {
        const refs = {};
        rows.forEach((r) => {
          const id = scS(r.bom_material_code);
          if (scS(r.bom_type) === "reference" && scS(r.ref_bom_id) && !refs[id]) refs[id] = scS(r.ref_bom_id);
        });
        return refs;
      };
      const rootRefs = refsOf(rootRows);
      let frontier = scUniq(rootRows.map((r) => r.bom_material_code)).map((id) => ({ itemId: id, parentItemId: itemId, refBomId: rootRefs[scS(id)] || "" }));
      frontier.forEach((f) => {
        seen[f.itemId] = 1;
      });
      for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
        const ids = frontier.map((f) => f.itemId);
        await readItemsFor(ids);
        if (depth < maxDepth) await readBomsFor(ids);
        const next = [];
        frontier.forEach((f) => {
          const own = bomsByItem[f.itemId] || [];
          const child = depth >= maxDepth ? null : f.refBomId ? own.filter((b) => scS(b.id) === f.refBomId)[0] || null : scPickBom(own);
          const usable = child ? scUsableRows(child) : [];
          let reason = "";
          if (depth >= maxDepth) reason = "at the depth limit of " + maxDepth + " levels";
          else if (!child) reason = f.refBomId ? "its BOM line points at a BOM that is no longer active" : "no active BOM";
          else if (!usable.length) reason = "its BOM has no components";
          tree.push({ itemId: f.itemId, name: nameOf(f.itemId), depth: depth, parentItemId: f.parentItemId, expandable: !reason, reason: reason,
            bomId: child ? scS(child.id) : "", version: child ? scS(child.parent_mat_bom_version) : "" });
          const refs = refsOf(usable);
          usable.forEach((r) => {
            const id = scS(r.bom_material_code);
            if (!seen[id]) {
              seen[id] = 1;
              next.push({ itemId: id, parentItemId: f.itemId, refBomId: refs[id] || "" });
            }
          });
        });
        frontier = next;
      }
    } else {
      await readItemsFor(rootRows.map((r) => r.bom_material_code));
    }
    const boms = {};
    const bomInfo = (b) => ({ itemId: scS(b.parent_material_code), version: scS(b.parent_mat_bom_version), baseQty: scS(b.parent_mat_base_quantity), baseUomId: scS(b.parent_mat_base_uom) });
    boms[scS(root.id)] = bomInfo(root);
    const dropped = [];
    const leaves = [];
    const walk = (bom, bomPath, itemPath, ancestors, steps, depth) => {
      scBomRows(bom).forEach((row) => {
        const code = scS(row.bom_material_code);
        if (row.consume_type === "REF") {
          dropped.push({ itemId: code, bomId: scS(bom.id), why: "REF" });
          return;
        }
        const it = items[code] || null;
        const uom = scS(row.sub_material_qty_uom) || scS(it && it.based_uom);
        const qty = scS(row.sub_material_qty) || "0";
        const w = String(scNum(row.sub_material_wastage));
        if (mode === "FLAT" && ticked[code]) {
          const names = ancestors.concat([code]).map(nameOf).join(" > ");
          if (ancestors.indexOf(code) >= 0) throw scFail("SC_CYCLE", "Expanding " + names + " loops back to " + nameOf(code) + ": untick one of them or fix the BOMs.");
          if (depth >= maxDepth) throw scFail("SC_TOO_DEEP", "Expanding " + names + " goes deeper than " + maxDepth + " levels.");
          const own = bomsByItem[code] || [];
          let child = null;
          if (scS(row.bom_type) === "reference" && scS(row.ref_bom_id)) {
            child = own.filter((b) => scS(b.id) === scS(row.ref_bom_id))[0] || null;
            if (!child) throw scFail("SC_REF_BOM_MISSING", "The BOM line for " + nameOf(code) + " points at a BOM that is no longer active: fix the BOM or untick it.");
          } else {
            child = scPickBom(own);
          }
          if (!child) throw scFail("SC_EXPAND_NOT_ALLOWED", nameOf(code) + " has no active BOM, so it cannot be expanded (" + names + ").");
          if (!scUsableRows(child).length) throw scFail("SC_BOM_EMPTY", "The BOM of " + nameOf(code) + " has no components, so it cannot be expanded (" + names + ").");
          const childBase = scNum(child.parent_mat_base_quantity);
          if (childBase <= 0) throw scFail("SC_BASE_ZERO", "The BOM of " + nameOf(code) + " has a base quantity of 0 and cannot be scaled.");
          const childBaseUom = scS(child.parent_mat_base_uom) || scS(it && it.based_uom);
          const f1 = scToBase(it, uom);
          const f2 = scToBase(it, childBaseUom);
          if (f1 === null || f2 === null) throw noConv(it, uom, childBaseUom);
          boms[scS(child.id)] = bomInfo(child);
          walk(child, bomPath.concat([scS(child.id)]), itemPath.concat([code]), ancestors.concat([code]), steps.concat([[qty, w, String(f1 / f2 / childBase)]]), depth + 1);
          return;
        }
        leaves.push({ itemId: code, uomId: uom, row: row, item: it, boms: bomPath, items: itemPath.concat([code]), steps: steps.concat([[qty, w, "1"]]) });
        if (leaves.length > maxPaths) throw scFail("SC_TOO_MANY_PATHS", "This BOM expands into more than " + maxPaths + " component paths: expand fewer sub-assemblies.");
      });
    };
    walk(root, [scS(root.id)], [], [itemId], [], 1);
    const s0 = (scNum(inp.outputQty) * rootConv) / rootBase;
    const out = [];
    const byKey = {};
    const counts = {};
    leaves.forEach((leaf) => {
      const base = leaf.itemId + "|" + leaf.uomId;
      let key = base;
      if (mode === "STANDARD") {
        counts[base] = (counts[base] || 0) + 1;
        key = base + "|" + counts[base];
      }
      const path = { boms: leaf.boms, items: leaf.items, steps: leaf.steps };
      if (byKey[key]) {
        byKey[key].paths.push(path);
        return;
      }
      const row = { key: key, itemId: leaf.itemId, uomId: leaf.uomId,
        name: scS(leaf.row.sub_material_name) || scS(leaf.item && leaf.item.material_name),
        desc: scS(leaf.row.sub_material_desc) || scS(leaf.item && leaf.item.material_desc),
        remark: scS(leaf.row.sub_material_remark), serial: scIsSerial(leaf.item) ? 1 : 0, nonStock: scIsNonStock(leaf.item) ? 1 : 0, paths: [path] };
      byKey[key] = row;
      out.push(row);
    });
    if (out.length > maxRows) throw scFail("SC_TOO_MANY_ROWS", "This BOM gives " + out.length + " component lines; at most " + maxRows + " can be assembled and posted at once.");
    const snapshot = { v: 1, mode: mode, itemId: itemId, uomId: itemUomId,
      root: { bomId: scS(root.id), version: rootVersion, baseQty: scS(root.parent_mat_base_quantity), baseUomId: rootBaseUom, conv: String(rootConv) },
      expand: expand, boms: boms, rows: out, dropped: dropped, preparedAt: scS(inp.preparedAt), preparedBy: scS(inp.preparedBy) };
    const rows = out.map((r) => ({ key: r.key, item_selection: r.itemId, item_name: r.name, item_desc: r.desc,
      requested_qty: scRowQty(r.paths.reduce((sum, p) => sum + scChain(s0, p.steps), 0), r.serial),
      quantity_uom: r.uomId, item_remark: r.remark, nonStock: r.nonStock, serial: r.serial }));
    return { ok: true, snapshot: snapshot, rows: rows, tree: tree };
  } catch (e) {
    if (e && e.scFail) return { ok: false, code: e.code, message: e.message, path: "" };
    throw e;
  }
};

const scSnapOf = (snapshot) => {
  const s = scParseJ(snapshot);
  if (!s || s.v !== 1 || (s.mode !== "STANDARD" && s.mode !== "FLAT") || !s.root || !scS(s.root.bomId) || !Array.isArray(s.rows)) return null;
  const okRow = (r) => r && scS(r.key) && scS(r.itemId) && Array.isArray(r.paths) && r.paths.every((p) => p && Array.isArray(p.steps) && p.steps.length > 0);
  return s.rows.every(okRow) && scNum(s.root.baseQty) > 0 ? s : null;
};
const scRecompute = (snapshot, outputQty) => {
  const s = scSnapOf(snapshot);
  if (!s) return [];
  const s0 = (scNum(outputQty) * scNum(s.root.conv || "1")) / scNum(s.root.baseQty);
  return s.rows.map((r) => ({ key: scS(r.key), itemId: scS(r.itemId), uomId: scS(r.uomId),
    qty: scRowQty(r.paths.reduce((sum, p) => sum + scChain(s0, p.steps), 0), Number(r.serial) === 1) }));
};
const scCheck = (snapshot, header, lines, opts) => {
  const s = scSnapOf(snapshot);
  const h = header || {};
  if (!s) return { ok: false, code: "SC_SNAPSHOT_INVALID", message: "The saved BOM snapshot of this Item Assembly is unreadable: press Prepare BOM, then save again." };
  const diff = [["mode", s.mode, h.bom_consumption_mode], ["item", s.itemId, h.item_id], ["UOM", s.uomId, h.item_uom], ["root BOM", s.root.bomId, h.source_bom_id]]
    .filter((d) => scS(d[1]) !== scS(d[2])).map((d) => d[0]);
  if (diff.length) return { ok: false, code: "SC_SNAPSHOT_MISMATCH", message: "The saved BOM snapshot no longer matches this Item Assembly (" + diff.join(", ") + "): press Prepare BOM, then save again." };
  if (opts && opts.completing) {
    const ref = {};
    scRecompute(s, h.item_qty).forEach((x) => {
      ref[x.key] = x;
    });
    const names = {};
    s.rows.forEach((r) => {
      names[scS(r.key)] = scS(r.name) || scS(r.itemId);
    });
    const list = Array.isArray(lines) ? lines : [];
    for (let i = 0; i < list.length; i++) {
      const l = list[i] || {};
      const x = ref[scS(l.sc_ref_key)];
      if (x && x.itemId === scS(l.item_selection) && x.uomId === scS(l.quantity_uom) && Math.abs(scNum(l.requested_qty) - x.qty) > 0.0005) {
        return { ok: false, code: "SC_REF_QTY_DRIFT", message: "The reference quantity of " + names[x.key] + " (" + scQ8(l.requested_qty) + ") does not match the saved BOM for "
          + scQ8(h.item_qty) + " (" + x.qty + "): press Prepare BOM, then complete again." };
      }
    }
    if (s.mode === "FLAT") {
      const exp = {};
      (s.expand || []).forEach((id) => {
        exp[scS(id)] = 1;
      });
      const hit = list.filter((l) => l && exp[scS(l.item_selection)] && scNum(l.total_quantity) > 0)[0];
      if (hit) return { ok: false, code: "SC_EXPANDED_CONSUMED", message: (scS(hit.item_name) || scS(hit.item_selection)) + " is expanded into its components in Flat mode, so it cannot also be consumed: remove its line or untick it." };
    }
  }
  return { ok: true };
};
if (typeof module !== "undefined") module.exports = { scS, scNum, scQ8, scParseJ, scPickBom, scToBase, scChain, scResolve, scRecompute, scCheck, scSnapOf };
