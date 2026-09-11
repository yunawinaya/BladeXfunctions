// Explodes the assembled item's BOM into the BOM Components table, then
// auto-allocates loose stock against each component line.
//
// Fetch budget is fixed at 8 queries regardless of how many sub-materials the
// BOM has: every lookup is batched across the whole component set.

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

const fetchByIds = (collection, ids, fields) => {
  let query = db.collection(collection);
  if (fields) query = query.field(fields);
  return query
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          { prop: "id", operator: "in", value: ids },
          { prop: "is_deleted", operator: "equal", value: 0 },
        ],
      },
    ])
    .get()
    .catch((error) => {
      console.error(`Error fetching ${collection}:`, error);
      return { data: [] };
    });
};

const fetchBalances = (collection, materialIds, plantId, organizationId) =>
  db
    .collection(collection)
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          { prop: "material_id", operator: "in", value: materialIds },
          { prop: "plant_id", operator: "equal", value: plantId },
          { prop: "organization_id", operator: "equal", value: organizationId },
          { prop: "is_deleted", operator: "equal", value: 0 },
        ],
      },
    ])
    .get()
    .catch((error) => {
      console.error(`Error fetching ${collection}:`, error);
      return { data: [] };
    });

// Loose availability, mirroring the rules the Transfer Stock dialog applies:
// item_balance.unrestricted_qty is already net of Allocated loose reservations
// (they bucket-shift to reserved_qty on save), so only HU-held stock has to be
// deducted here to isolate what is genuinely loose.
const autoAllocate = async (rows, itemMap, uomMap, plantId, organizationId) => {
  const allocatable = rows.filter(
    (row) => itemMap.get(row.item_selection)?.serial_number_management !== 1
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
    db
      .collection("handling_unit_atu7sreg_sub")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "material_id", operator: "in", value: allIds },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get()
      .catch(() => ({ data: [] })),
    db
      .collection("on_reserved_gd")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "material_id", operator: "in", value: allIds },
            { prop: "plant_id", operator: "equal", value: plantId },
            { prop: "organization_id", operator: "equal", value: organizationId },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get()
      .catch(() => ({ data: [] })),
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
    );
    if (available <= 0) return;
    const list = balancesByMaterial.get(String(balance.material_id)) || [];
    list.push({ balance, available });
    balancesByMaterial.set(String(balance.material_id), list);
  });

  // Oldest stock first, matching the dialog's stated suggestion order.
  balancesByMaterial.forEach((list) =>
    list.sort((a, b) =>
      String(a.balance.create_time || "").localeCompare(
        String(b.balance.create_time || "")
      )
    )
  );

  const updates = {};
  const shortfalls = [];
  const picksByRow = new Map();

  rows.forEach((row, rowIndex) => {
    const item = itemMap.get(row.item_selection);
    if (!item || item.serial_number_management === 1) return;

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
      remaining = parseFloat((remaining - take).toFixed(3));

      const balance = candidate.balance;
      picks.push({
        material_id: balance.material_id,
        location_id: balance.location_id,
        storage_location_id: balance.storage_location_id || null,
        batch_id: balance.batch_id || null,
        balance_id: balance.id,
        sm_quantity: parseFloat(take.toFixed(3)),
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
    const total = parseFloat(allocated.toFixed(3));

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

(async () => {
  try {
    const { value, fieldModel } = arguments[0];

    if (!value) {
      clearComponents();
      return;
    }

    const organizationId = getOrganizationId();
    const allData = this.getValues();
    const plantId = allData.issuing_operation_faci;

    // triggerEvent (the item_qty re-scale path) supplies no fieldModel.
    let parentItem = fieldModel?.item;
    if (!parentItem) {
      const parentRes = await fetchByIds(
        "item",
        [value],
        "material_name,material_desc,based_uom"
      );
      parentItem = (parentRes.data || [])[0];
    }

    this.setData({
      item_name: parentItem?.material_name || "",
      item_desc: parentItem?.material_desc || "",
      item_uom: parentItem?.based_uom || "",
    });

    const bomRes = await db
      .collection("bill_of_materials")
      .where({
        parent_material_code: value,
        organization_id: organizationId,
        is_deleted: 0,
        is_active: 1,
      })
      .get();

    const boms = bomRes.data || [];
    if (boms.length === 0) {
      this.setData({ stock_movement: [] });
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
      this.setData({ stock_movement: [] });
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
      "material_name,material_desc,based_uom,serial_number_management,item_batch_management,table_uom_conversion"
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
      this.setData({ stock_movement: [] });
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
        ).toFixed(3)
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
        total_quantity: 0,
        quantity_uom: sub.sub_material_qty_uom || item?.based_uom || "",
        uom_options: JSON.stringify(rowUoms),
        item_remark: sub.sub_material_remark || "",
        organization_id: organizationId,
        issuing_plant: plantId,
        line_index: index + 1,
        balance_id: "",
        temp_qty_data: "",
        temp_hu_data: "",
        stock_summary: "",
      };
    });

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
