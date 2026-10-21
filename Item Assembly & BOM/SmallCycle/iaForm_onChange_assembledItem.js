// Small Cycle (scratchpad/iasc): an Item Assembly linked to a Sales Order line, in Flat mode, or holding a BOM snapshot is
// prepared by the event sc_main (op ITEM; op QTY for the item-quantity re-scale), never by the v36 code below.
const SC_ENABLED = true;
const SC_WF_PROJECTION = "2112448183267332097"; // SO_IA_PROJECTION
const SC_WF_RELINK = "2112448260018900994"; // IA_SC_RELINK
const scArgs = arguments[0] || {};
if (SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK) && !scArgs.scLegacy) {
  const scText = (k) => {
    const v = this.getValue(k);
    return v === undefined || v === null ? "" : String(v).trim();
  };
  const scMode = scText("bom_consumption_mode");
  if (/^[0-9]{1,20}$/.test(scText("source_so_line_id")) || scMode === "FLAT" || (scMode === "STANDARD" && scText("bom_snapshot_json") !== "")) {
    this.triggerEvent("sc_main", { scOp: scArgs.rescale ? "QTY" : "ITEM", value: scArgs.value });
    return;
  }
}
// -- end Small Cycle --
// Explodes the assembled item's BOM into the BOM Components table, then
// auto-allocates loose stock against each component line.
//
// Fetch budget is fixed regardless of how many sub-materials the BOM has:
// every lookup is batched across the whole component set.
// A non-stock (labour / overhead) component takes its BOM quantity, no picks.

// Chunked reads with an explicit limit (the API clamps at IA_READ_MAX rows, as GDonMounted.js); a clamped read is read again
const IA_READ_CHUNK = 500;
const IA_READ_MAX = 5000;
const iaChunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const iaUniq = (list) => [...new Set((list || []).filter((v) => v !== undefined && v !== null && v !== "").map(String))];

// rows of `collection` whose id is in `ids` (is_deleted 0), `fields` projected
const iaReadIds = async (collection, ids, fields) => {
  const rows = [];
  await Promise.all(
    iaChunks(iaUniq(ids), Math.min(IA_READ_CHUNK, IA_READ_MAX)).map(async (chunk) => {
      let left = chunk;
      while (left.length) {
        let got = [];
        try {
          let query = db.collection(collection);
          if (fields) query = query.field(fields);
          const res = await query
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  { prop: "id", operator: "in", value: left },
                  { prop: "is_deleted", operator: "equal", value: 0 },
                ],
              },
            ])
            .limit(left.length)
            .get();
          got = (res && res.data) || [];
        } catch (error) {
          console.error(`Error fetching ${collection}:`, error);
          return;
        }
        rows.push(...got);
        const seen = new Set(got.map((row) => String(row.id)));
        const missing = left.filter((id) => !seen.has(id));
        if (!got.length || missing.length === left.length) return;
        left = missing;
      }
    }),
  );
  return { data: rows };
};

// rows of `collection` whose `prop` is in `values`, with the other conditions
const iaReadMany = async (collection, prop, values, conditions) => {
  const rows = [];
  const read = async (chunk) => {
    let got = [];
    try {
      const res = await db
        .collection(collection)
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [{ prop: prop, operator: "in", value: chunk }, ...conditions],
          },
        ])
        .limit(IA_READ_MAX)
        .get();
      got = (res && res.data) || [];
    } catch (error) {
      console.error(`Error fetching ${collection}:`, error);
      return;
    }
    if (got.length >= IA_READ_MAX && chunk.length > 1) {
      const half = Math.ceil(chunk.length / 2);
      await Promise.all([read(chunk.slice(0, half)), read(chunk.slice(half))]);
      return;
    }
    if (got.length >= IA_READ_MAX) console.error(`${collection}: more than ${IA_READ_MAX} rows for ${chunk[0]}; ${got.length} read`);
    rows.push(...got);
  };
  await Promise.all(iaChunks(iaUniq(values), IA_READ_CHUNK).map(read));
  return { data: rows };
};

// Non-stock (stock_control 0) item ids learnt by one handler, kept for the others in this.models._data
const iaIsNonStock = (item) => !!item && (item.stock_control === 0 || item.stock_control === "0");
const iaNsItems = () => (this.models["_data"] || {}).ia_ns_items || {};
const iaNsRemember = (ids) => {
  if (!ids.length) return;
  const known = { ...iaNsItems() };
  ids.forEach((id) => {
    known[String(id)] = 1;
  });
  this.models["_data"] = { ...this.models["_data"], ia_ns_items: known };
};
// Transfer Stock off for the non-stock rows of [rowIndex, itemId] pairs, on again for the rest once any was switched off
const iaNsLinks = (pairs) => {
  const known = iaNsItems();
  const off = [];
  const on = [];
  pairs.forEach(([index, itemId]) => (known[String(itemId)] ? off : on).push(`stock_movement.${index}.transfer_stock`));
  if (!off.length && !(this.models["_data"] || {}).ia_ns_links) return;
  if (off.length) {
    this.models["_data"] = { ...this.models["_data"], ia_ns_links: 1 };
    this.disabled(off, true);
  }
  if (on.length) this.disabled(on, false);
};

const getOrganizationId = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

const clearComponents = () => {
  this.setData({
    item_name: "",
    item_desc: "",
    item_uom: "",
    stock_movement: [],
  });
};

// Batch No is typed only under Manual Input; a System Settings batch is generated
// on completion. Any batch item takes the dates.
const applyBatchFields = (item) => {
  const isBatch = item?.item_batch_management === 1;
  const isManual =
    isBatch && item.batch_number_genaration !== "According To System Settings";

  this.setData({ batch_no: "", manufacturing_date: null, expired_date: null });
  if (isManual) this.display(["batch_no"]);
  else this.hide(["batch_no"]);
  if (isBatch) this.display(["manufacturing_date", "expired_date"]);
  else this.hide(["manufacturing_date", "expired_date"]);
};

const fetchByIds = (collection, ids, fields) => iaReadIds(collection, ids, fields);

// Item master default bin for this plant. A row without a bin is treated as
// unconfigured so we never stamp a blank bin over the plant default.
const getItemDefaultBin = (tableDefaultBin, plantId) => {
  if (!plantId || !Array.isArray(tableDefaultBin)) return null;

  const matchingBin = tableDefaultBin.find(
    (bin) => bin.plant_id === plantId && bin.bin_location
  );

  if (!matchingBin) return null;

  return {
    binLocation: matchingBin.bin_location,
    storageLocation: matchingBin.storage_location || null,
  };
};

// Plant-level fallback, mirroring onChange_Plant.
const fetchPlantDefaults = async (plantId) => {
  const empty = { storageLocation: null, binLocation: null };
  if (!plantId) return empty;

  const storageRes = await db
    .collection("storage_location")
    .where({
      plant_id: plantId,
      is_deleted: 0,
      is_default: 1,
      storage_status: 1,
      location_type: "Common",
    })
    .get()
    .catch(() => ({ data: [] }));

  const storageLocation = storageRes.data?.[0]?.id;
  if (!storageLocation) return empty;

  const binRes = await db
    .collection("bin_location")
    .where({
      plant_id: plantId,
      storage_location_id: storageLocation,
      is_deleted: 0,
      is_default: 1,
      bin_status: 1,
    })
    .get()
    .catch(() => ({ data: [] }));

  return { storageLocation, binLocation: binRes.data?.[0]?.id || null };
};

const fetchBalances = (collection, materialIds, plantId, organizationId) =>
  iaReadMany(collection, "material_id", materialIds, [
    { prop: "plant_id", operator: "equal", value: plantId },
    { prop: "organization_id", operator: "equal", value: organizationId },
    { prop: "is_deleted", operator: "equal", value: 0 },
  ]);

// Loose availability, mirroring the rules the Transfer Stock dialog applies:
// item_balance.unrestricted_qty is already net of Allocated loose reservations
// (they bucket-shift to reserved_qty on save), so only HU-held stock has to be
// deducted here to isolate what is genuinely loose.
// Small Cycle (scratchpad/iasc): RES-01 - this IA's own holds (its Allocated on_reserved_gd rows, doc_type Item Assembly) are its
// own stock: its auto-allocation and its Transfer Stock picker add them back to the free stock they read (the hold moved them to
// Reserved). Another document's holds never. Only a stored IA that reserves (page Edit, a hold status: a clone carries its source's id
// and status, review I2), whatever the switch (it only makes holds, review I4); any other IA: nothing added.
const resOwnId = (v) => {
  const s = (x) => (x === undefined || x === null ? "" : String(x));
  const id = s(v && v.id);
  return v && s(v.page_status) === "Edit" && s(v.material_hold_status) !== "" && /^[0-9]{1,20}$/.test(id) ? id : "";
};
// the form read only when the reservations already read hold an Item Assembly's row (an IA that never reserved keeps v36's calls)
const resOwnIdOf = (rows, values) => ((Array.isArray(rows) ? rows : []).some((r) => r && String(r.doc_type) === "Item Assembly") ? resOwnId(values()) : "");
// the base quantity this IA holds at material + bin + batch from one category (Unrestricted / Blocked)
const resOwnHeld = (rows, iaId, materialId, binId, batchId, category, item) => {
  const s = (v) => String(v && typeof v === "object" && v.dict_key !== undefined ? v.dict_key : v === undefined || v === null ? "" : v);
  if (!/^[0-9]{1,20}$/.test(s(iaId))) return 0;
  let base = 0;
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || Number(r.is_deleted) === 1 || s(r.doc_type) !== "Item Assembly" || s(r.doc_id) !== s(iaId) || s(r.status) !== "Allocated" || s(r.handling_unit_id)) return;
    if ((s(r.from_category) || "Unrestricted") !== category || s(r.material_id) !== s(materialId) || s(r.bin_location) !== s(binId) || s(r.batch_id) !== s(batchId)) return;
    const uom = s(r.item_uom);
    const conv = item && uom && uom !== s(item.based_uom) ? (Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion : []).find((c) => s(c && c.alt_uom_id) === uom) : null;
    base += (parseFloat(r.open_qty) || 0) * (conv && parseFloat(conv.base_qty) > 0 ? parseFloat(conv.base_qty) : 1);
  });
  return base;
};
// -- end Small Cycle --
const autoAllocate = async (rows, itemMap, uomMap, plantId, organizationId) => {
  let resIaMemo = null;
  const resIa = () => (resIaMemo === null ? (resIaMemo = resOwnIdOf(reservationRes.data, () => this.getValues() || {})) : resIaMemo);
  const allocatable = rows.filter(
    (row) =>
      itemMap.get(row.item_selection)?.serial_number_management !== 1 &&
      !iaIsNonStock(itemMap.get(row.item_selection))
  );
  if (allocatable.length === 0) return;

  const batchIds = [];
  const looseIds = [];
  allocatable.forEach((row) => {
    const item = itemMap.get(row.item_selection);
    (item?.item_batch_management === 1 ? batchIds : looseIds).push(
      row.item_selection
    );
  });
  const allIds = allocatable.map((row) => row.item_selection);

  const [looseRes, batchRes, huSubRes, reservationRes] = await Promise.all([
    looseIds.length
      ? fetchBalances("item_balance", looseIds, plantId, organizationId)
      : Promise.resolve({ data: [] }),
    batchIds.length
      ? fetchBalances("item_batch_balance", batchIds, plantId, organizationId)
      : Promise.resolve({ data: [] }),
    iaReadMany("handling_unit_atu7sreg_sub", "material_id", allIds, [
      { prop: "is_deleted", operator: "equal", value: 0 },
    ]),
    iaReadMany("on_reserved_gd", "material_id", allIds, [
      { prop: "plant_id", operator: "equal", value: plantId },
      { prop: "organization_id", operator: "equal", value: organizationId },
      { prop: "is_deleted", operator: "equal", value: 0 },
    ]),
  ]);

  const huIds = [
    ...new Set(
      (huSubRes.data || []).map((sub) => sub.handling_unit_id).filter(Boolean)
    ),
  ];
  const huRes = huIds.length
    ? await fetchByIds("handling_unit", huIds)
    : { data: [] };

  // An Allocated reservation against an HU is logically Reserved, so that
  // portion never sat in unrestricted_qty and must not be deducted twice.
  const huReservedMap = new Map();
  (reservationRes.data || [])
    .filter(
      (r) => parseFloat(r.open_qty || 0) > 0 && r.status === "Allocated"
    )
    .forEach((r) => {
      if (!r.handling_unit_id) return;
      const key = `${r.handling_unit_id}|${r.batch_id || ""}`;
      huReservedMap.set(
        key,
        (huReservedMap.get(key) || 0) + parseFloat(r.open_qty || 0)
      );
    });

  const huQtyMap = new Map();
  (huRes.data || []).forEach((hu) => {
    (hu.table_hu_items || [])
      .filter((huItem) => huItem.is_deleted !== 1)
      .forEach((huItem) => {
        const locationId = huItem.location_id || hu.location_id;
        const reservedKey = `${hu.id}|${huItem.batch_id || ""}`;
        const qty = Math.max(
          0,
          (parseFloat(huItem.quantity) || 0) -
            (huReservedMap.get(reservedKey) || 0)
        );
        if (qty <= 0) return;
        const key = `${huItem.material_id}|${locationId}|${
          huItem.batch_id || "no_batch"
        }`;
        huQtyMap.set(key, (huQtyMap.get(key) || 0) + qty);
      });
  });

  const balancesByMaterial = new Map();
  [...(looseRes.data || []), ...(batchRes.data || [])].forEach((balance) => {
    const key = `${balance.material_id}|${balance.location_id}|${
      balance.batch_id || "no_batch"
    }`;
    const available = Math.max(
      0,
      (parseFloat(balance.unrestricted_qty) || 0) - (huQtyMap.get(key) || 0)
    ) + resOwnHeld(reservationRes.data, resIa(), balance.material_id, balance.location_id, balance.batch_id, "Unrestricted", itemMap.get(balance.material_id));
    if (available <= 0) return;
    const list = balancesByMaterial.get(String(balance.material_id)) || [];
    list.push({ balance, available });
    balancesByMaterial.set(String(balance.material_id), list);
  });

  // The component's own default bin for this plant leads; the rest stay oldest first.
  const preferredBinByMaterial = new Map();
  allocatable.forEach((row) => {
    const defaultBin = getItemDefaultBin(
      itemMap.get(row.item_selection)?.table_default_bin,
      plantId
    );
    if (defaultBin?.binLocation) {
      preferredBinByMaterial.set(
        String(row.item_selection),
        defaultBin.binLocation
      );
    }
  });

  balancesByMaterial.forEach((list, materialId) => {
    const preferredBin = preferredBinByMaterial.get(materialId);
    list.sort((a, b) => {
      const byBin =
        (b.balance.location_id === preferredBin ? 1 : 0) -
        (a.balance.location_id === preferredBin ? 1 : 0);
      return byBin !== 0
        ? byBin
        : String(a.balance.create_time || "").localeCompare(
            String(b.balance.create_time || "")
          );
    });
  });

  const updates = {};
  const shortfalls = [];
  const picksByRow = new Map();

  rows.forEach((row, rowIndex) => {
    const item = itemMap.get(row.item_selection);
    if (!item || item.serial_number_management === 1 || iaIsNonStock(item)) return;

    let remaining = parseFloat(row.requested_qty) || 0;
    if (remaining <= 0) return;

    const picks = [];
    const candidates = balancesByMaterial.get(String(row.item_selection)) || [];

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      if (candidate.available <= 0) continue;

      const take = Math.min(candidate.available, remaining);
      // Deduct in place so a second line for the same material cannot claim
      // stock this line just took.
      candidate.available -= take;
      remaining = parseFloat((remaining - take));

      const balance = candidate.balance;
      picks.push({
        material_id: balance.material_id,
        location_id: balance.location_id,
        storage_location_id: balance.storage_location_id || null,
        batch_id: balance.batch_id || null,
        balance_id: balance.id,
        sm_quantity: parseFloat(take),
        category: "Unrestricted",
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
        expired_date: balance.expired_date || null,
        manufacturing_date: balance.manufacturing_date || null,
        unrestricted_qty: parseFloat(balance.unrestricted_qty) || 0,
        balance_quantity: parseFloat(balance.balance_quantity) || 0,
      });
    }

    const allocated = picks.reduce((sum, pick) => sum + pick.sm_quantity, 0);
    const total = parseFloat(allocated);

    updates[`stock_movement.${rowIndex}.total_quantity`] = total;
    updates[`stock_movement.${rowIndex}.temp_qty_data`] = picks.length
      ? JSON.stringify(picks)
      : "";
    picksByRow.set(rowIndex, { picks, total, row });

    if (remaining > 0) {
      shortfalls.push(`${row.item_name || row.item_selection} (${remaining})`);
    }
  });

  // stock_summary is read by a human, so bin / batch / UOM are resolved to names
  // here rather than left as ids. Both lookups are batched across every line.
  const allPicks = [...picksByRow.values()].flatMap((entry) => entry.picks);
  const pickBinIds = [
    ...new Set(allPicks.map((pick) => pick.location_id).filter(Boolean)),
  ];
  const pickBatchIds = [
    ...new Set(allPicks.map((pick) => pick.batch_id).filter(Boolean)),
  ];

  const [binRes, batchNameRes] = await Promise.all([
    pickBinIds.length
      ? fetchByIds("bin_location", pickBinIds, "bin_location_combine")
      : Promise.resolve({ data: [] }),
    pickBatchIds.length
      ? fetchByIds("batch", pickBatchIds, "batch_number")
      : Promise.resolve({ data: [] }),
  ]);

  const binMap = new Map(
    (binRes.data || []).map((bin) => [bin.id, bin.bin_location_combine])
  );
  const batchMap = new Map(
    (batchNameRes.data || []).map((batch) => [batch.id, batch.batch_number])
  );

  picksByRow.forEach(({ picks, total, row }, rowIndex) => {
    if (picks.length === 0) {
      updates[`stock_movement.${rowIndex}.stock_summary`] = "";
      return;
    }

    const uomName = uomMap.get(row.quantity_uom)?.uom_name || "";

    // Same shape onConfirm_Stock writes, so a manual re-pick reads identically.
    const details = picks
      .map((pick, i) => {
        const binName = binMap.get(pick.location_id) || pick.location_id;
        let line = `${i + 1}. ${binName}: ${pick.sm_quantity} ${uomName} (UNR)`;
        if (pick.batch_id) {
          line += `\n[${batchMap.get(pick.batch_id) || pick.batch_id}]`;
        }
        return line;
      })
      .join("\n");

    updates[
      `stock_movement.${rowIndex}.stock_summary`
    ] = `Total: ${total} ${uomName}\n\nDETAILS:\n${details}`;
  });

  await this.setData(updates);

  if (shortfalls.length > 0) {
    this.$message.warning(
      `Not enough loose stock for: ${shortfalls.join(
        ", "
      )}. Open Transfer Stock on those lines to pick from handling units.`
    );
  }
};

// The BOM is a template: once the table has been edited away from what the last
// explosion produced, re-scaling it would silently throw those edits away.
const componentsWereEdited = (currentRows, bomRows) => {
  if (currentRows.length !== bomRows.length) return true;

  const bomItems = bomRows.map((row) => String(row.item_selection)).sort();
  const currentItems = currentRows
    .map((row) => String(row.item_selection))
    .sort();
  if (bomItems.some((id, i) => id !== currentItems[i])) return true;

  // Anything the system allocated itself ends up equal to the demand it derived;
  // a typed quantity or a manual re-pick does not.
  return currentRows.some(
    (row) =>
      Math.abs(
        (parseFloat(row.total_quantity) || 0) -
          (parseFloat(row.requested_qty) || 0)
      ) > 0.0000001
  );
};

(async () => {
  try {
    const { value, rescale } = arguments[0];

    if (!value) {
      clearComponents();
      applyBatchFields(null);
      return;
    }

    const organizationId = getOrganizationId();
    const allData = this.getValues();
    const plantId = allData.issuing_operation_faci;

    // The header picker's datasource is bill_of_materials, so fieldModel.item is a
    // BOM row and never carries material_name -- the Item is always resolved by id.
    // One fetch serves both the header fields and the default-bin lookup.
    const [bomRes, parentItemRes, plantDefaults] = await Promise.all([
      db
        .collection("bill_of_materials")
        .where({
          parent_material_code: value,
          organization_id: organizationId,
          is_deleted: 0,
          is_active: 1,
        })
        .get(),
      fetchByIds(
        "item",
        [value],
        "material_name,material_desc,based_uom,table_default_bin,item_batch_management,batch_number_genaration"
      ),
      rescale
        ? Promise.resolve({ storageLocation: null, binLocation: null })
        : fetchPlantDefaults(plantId),
    ]);

    const parentItem = (parentItemRes.data || [])[0];

    this.setData({
      item_name: parentItem?.material_name || "",
      item_desc: parentItem?.material_desc || "",
      item_uom: parentItem?.based_uom || "",
    });

    // The receiving bin is only re-stamped when the assembled item changes: on a
    // re-scale it is already right, and re-stamping would discard a chosen bin.
    if (!rescale) {
      // Always overwritten, so a previous item's default bin cannot stick.
      const parentDefaultBin = getItemDefaultBin(
        parentItem?.table_default_bin,
        plantId
      );
      this.setData({
        storage_location_id:
          parentDefaultBin?.storageLocation ||
          plantDefaults.storageLocation ||
          "",
        location_id:
          parentDefaultBin?.binLocation || plantDefaults.binLocation || "",
      });
      applyBatchFields(parentItem);
    }

    // A re-scale never clears the table: the components may be the user's own by
    // now, and losing them to a BOM that went inactive would be silent data loss.
    const clearOnFailure = () => {
      if (!rescale) this.setData({ stock_movement: [] });
    };

    const boms = bomRes.data || [];
    if (boms.length === 0) {
      clearOnFailure();
      this.$message.warning(
        "No active Bill of Materials found for this item. Create a BOM before assembling it."
      );
      return;
    }

    // Default version wins; otherwise the highest V-number.
    const versionOf = (bom) => {
      const match = /^V(\d+)$/.exec(
        String(bom.parent_mat_bom_version || "").trim()
      );
      return match ? parseInt(match[1], 10) : 0;
    };
    boms.sort((a, b) => {
      const byDefault =
        (b.parent_mat_is_default === 1 ? 1 : 0) -
        (a.parent_mat_is_default === 1 ? 1 : 0);
      return byDefault !== 0 ? byDefault : versionOf(b) - versionOf(a);
    });
    const bom = boms[0];

    if (boms.length > 1 && bom.parent_mat_is_default !== 1) {
      this.$message.info(
        `Using BOM ${bom.parent_mat_bom_version}; ${boms.length} BOMs exist for this item and none is marked default.`
      );
    }

    // REF lines are reference-only and are never consumed.
    const subMaterials = (bom.subform_sub_material || []).filter(
      (sub) => sub.bom_material_code && sub.consume_type !== "REF"
    );

    if (subMaterials.length === 0) {
      clearOnFailure();
      this.$message.warning(
        `BOM ${bom.parent_mat_bom_version} has no consumable sub materials.`
      );
      return;
    }

    const componentIds = [
      ...new Set(subMaterials.map((sub) => sub.bom_material_code)),
    ];

    const itemsRes = await fetchByIds(
      "item",
      componentIds,
      "material_name,material_desc,based_uom,serial_number_management,item_batch_management,table_uom_conversion,table_default_bin,stock_control"
    );
    const itemMap = new Map(
      (itemsRes.data || []).map((item) => [item.id, item])
    );

    const uomIds = [
      ...new Set(
        subMaterials
          .flatMap((sub) => {
            const item = itemMap.get(sub.bom_material_code);
            return [
              sub.sub_material_qty_uom,
              item?.based_uom,
              ...(item?.table_uom_conversion || []).map(
                (conv) => conv.alt_uom_id
              ),
            ];
          })
          .filter(Boolean)
      ),
    ];
    const uomRes = uomIds.length
      ? await fetchByIds("unit_of_measurement", uomIds)
      : { data: [] };
    const uomMap = new Map((uomRes.data || []).map((uom) => [uom.id, uom]));

    const itemQty = parseFloat(allData.item_qty) || 0;
    const bomBaseQty = parseFloat(bom.parent_mat_base_quantity) || 0;

    if (bomBaseQty <= 0) {
      clearOnFailure();
      this.$message.error(
        `BOM ${bom.parent_mat_bom_version} has a base quantity of 0 and cannot be scaled.`
      );
      return;
    }

    const rows = subMaterials.map((sub, index) => {
      const item = itemMap.get(sub.bom_material_code);
      const wastage = parseFloat(sub.sub_material_wastage) || 0;
      let requestedQty = parseFloat(
        (
          (itemQty / bomBaseQty) *
          (parseFloat(sub.sub_material_qty) || 0) *
          (1 + wastage / 100)
        )
      );
      // A serialized component cannot be issued in fractions.
      if (item?.serial_number_management === 1) {
        requestedQty = Math.ceil(requestedQty);
      }

      const rowUoms = [
        sub.sub_material_qty_uom,
        item?.based_uom,
        ...(item?.table_uom_conversion || []).map((conv) => conv.alt_uom_id),
      ]
        .filter(Boolean)
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .map((id) => uomMap.get(id))
        .filter(Boolean);

      return {
        item_selection: sub.bom_material_code,
        item_name: sub.sub_material_name || item?.material_name || "",
        item_desc: sub.sub_material_desc || item?.material_desc || "",
        requested_qty: requestedQty,
        total_quantity: iaIsNonStock(item) ? requestedQty : 0,
        quantity_uom: sub.sub_material_qty_uom || item?.based_uom || "",
        uom_options: JSON.stringify(rowUoms),
        item_remark: sub.sub_material_remark || "",
        // Seeded here rather than via onRowAdd: an exploded row never passes
        // through the item picker that seeds a manually added one.
        project_id: allData.project_id || "",
        organization_id: organizationId,
        issuing_plant: plantId,
        line_index: index + 1,
        balance_id: "",
        temp_qty_data: "",
        temp_hu_data: "",
        stock_summary: "",
      };
    });

    // Only the item_qty path asks: changing the assembled item makes the previous
    // components meaningless, so that always rebuilds.
    if (rescale && componentsWereEdited(allData.stock_movement || [], rows)) {
      const keep = await this.$confirm(
        `The BOM components have been changed since they were loaded. Please choose one: <br><br>
        <strong>Re-scale:</strong> Rebuild the table from the BOM at the new quantity, discarding those changes.<br>
        <strong>Keep:</strong> Leave the components exactly as they are.`,
        "Quantity Changed",
        {
          confirmButtonText: "Re-scale",
          cancelButtonText: "Keep",
          dangerouslyUseHTMLString: true,
          type: "warning",
        }
      ).then(
        () => false,
        () => true
      );

      if (keep) return;
    }

    await this.setData({ stock_movement: rows });

    rows.forEach((row, rowIndex) => {
      let options = [];
      try {
        options = JSON.parse(row.uom_options);
      } catch (e) {}
      this.setOptionData(
        [`stock_movement.${rowIndex}.quantity_uom`],
        options
      );
    });

    iaNsRemember(
      rows
        .filter((row) => iaIsNonStock(itemMap.get(row.item_selection)))
        .map((row) => row.item_selection)
    );
    iaNsLinks(rows.map((row, rowIndex) => [rowIndex, row.item_selection]));

    if (!plantId) {
      this.$message.warning(
        "Select a Plant to auto-allocate stock for these components."
      );
      return;
    }

    await autoAllocate(rows, itemMap, uomMap, plantId, organizationId);
  } catch (error) {
    console.error("Error exploding the BOM:", error);
    this.$message.error(error.message || "Failed to load the Bill of Materials");
  }
})();
