const hideTab = (tabName) => {
  setTimeout(() => {
    const tabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-${tabName}[tabindex="-1"][aria-selected="false"]`;
    const tab = document.querySelector(tabSelector);

    if (tab) {
      tab.style.display = "none";
    } else {
      const fallbackTab = document.querySelector(
        `.el-drawer[role="dialog"] .el-tabs__item#tab-${tabName}`,
      );
      if (fallbackTab) {
        fallbackTab.style.display = "none";
      } else {
        console.log(`Tab ${tabName} not found`);
      }
    }

    const inactiveTabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-${tabName})`;
    const inactiveTab = document.querySelector(inactiveTabSelector);
    if (inactiveTab) {
      inactiveTab.setAttribute("aria-disabled", "true");
      inactiveTab.classList.add("is-disabled");
    }
  }, 10);
};

const selectTab = (tabName) => {
  setTimeout(() => {
    const tabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-${tabName}`;
    const tab = document.querySelector(tabSelector);

    if (tab) {
      tab.style.display = "flex";
      tab.setAttribute("aria-selected", "true");
      tab.setAttribute("aria-disabled", "false");
      tab.setAttribute("tabindex", "0");
      tab.classList.remove("is-disabled");
      tab.classList.add("is-active");
      tab.click();
    } else {
      console.log(`Tab ${tabName} not found`);
    }
  }, 100);
};

// item_balance / item_batch_balance do NOT carry handling_unit_id, so their
// unrestricted_qty commingles genuinely-loose stock with stock physically sitting
// inside handling units. Load must only offer the truly-loose portion; otherwise
// the same physical stock gets packed into a target HU while the holding HU still
// lists it, and the holding HU becomes a phantom claiming stock that moved away.
// Mirrors GD (fetchHuQtyByLocation) and MSI (buildHuQtyMap + applyLooseDeduction).
const fetchInventoryItems = async (plantId, organizationId) => {
  // Stage 1 — balances (independent of everything else).
  const [itemBalanceRes, itemBatchBalanceRes] = await Promise.all([
    db
      .collection("item_balance")
      .where({
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get(),
    db
      .collection("item_batch_balance")
      .where({
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get(),
  ]);

  const itemBalanceRows = (itemBalanceRes.data || []).filter(
    (r) => (parseFloat(r.unrestricted_qty) || 0) > 0,
  );
  const batchBalanceRows = (itemBatchBalanceRes.data || []).filter(
    (r) => (parseFloat(r.unrestricted_qty) || 0) > 0,
  );

  const materialIds = [
    ...new Set([
      ...itemBalanceRows.map((r) => r.material_id),
      ...batchBalanceRows.map((r) => r.material_id),
    ]),
  ].filter(Boolean);

  if (materialIds.length === 0) return [];

  // Stage 2 — everything keyed off materialIds, in parallel.
  // The HU contents come from the flat sub-collection rather than
  // `handling_unit` documents: querying `handling_unit` plant-wide silently
  // truncates at the platform's 5000-row default cap, which would UNDER-deduct
  // and let HU-held stock leak back into the Load list. Same bypass GD/MSI use.
  // on_reserved_gd is allowed to fail soft: an empty reserved map only
  // over-deducts (hides stock), which is the safe direction.
  const [itemRes, subRes, reservationRes] = await Promise.all([
    db
      .collection("item")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "id", operator: "in", value: materialIds },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get(),
    db
      .collection("handling_unit_atu7sreg_sub")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "material_id", operator: "in", value: materialIds },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get(),
    db
      .collection("on_reserved_gd")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "material_id", operator: "in", value: materialIds },
            { prop: "plant_id", operator: "equal", value: plantId },
            { prop: "organization_id", operator: "equal", value: organizationId },
            { prop: "status", operator: "equal", value: "Allocated" },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get()
      .catch((error) => {
        console.error("Error fetching on_reserved_gd:", error);
        return { data: [] };
      }),
  ]);

  const itemMap = new Map();
  (itemRes.data || []).forEach((it) => itemMap.set(it.id, it));

  const subRows = subRes.data || [];

  // Stage 3 — parent HUs of those sub-rows, for the location fallback, the
  // plant/org scope check, and the packing_id overlay.
  const candidateHuIds = [
    ...new Set(subRows.map((r) => r.handling_unit_id).filter(Boolean)),
  ];

  const huLocationMap = new Map();
  const packedHuIds = new Set();
  if (candidateHuIds.length > 0) {
    const huRes = await db
      .collection("handling_unit")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            { prop: "id", operator: "in", value: candidateHuIds },
            { prop: "plant_id", operator: "equal", value: plantId },
            { prop: "organization_id", operator: "equal", value: organizationId },
            { prop: "is_deleted", operator: "equal", value: 0 },
          ],
        },
      ])
      .get();
    for (const hu of huRes.data || []) {
      huLocationMap.set(hu.id, hu.location_id);
      // Packed HUs are committed to a Packing doc; their qty lives in
      // reserved_qty (not unrestricted_qty), so it must not be deducted.
      if (hu.packing_id) packedHuIds.add(hu.id);
    }
  }

  // Only Allocated reservations with open_qty > 0 hold stock outside
  // unrestricted_qty. Pending already moved its qty unrestricted -> reserved on
  // the balance row at SO save, so counting it here would double-deduct.
  const huReservedMap = new Map();
  for (const r of reservationRes.data || []) {
    if (!r.handling_unit_id) continue;
    if ((parseFloat(r.open_qty) || 0) <= 0) continue;
    const item = itemMap.get(r.material_id);
    let qtyBase = parseFloat(r.open_qty) || 0;
    if (item && r.item_uom && r.item_uom !== item.based_uom) {
      const conv = (item.table_uom_conversion || []).find(
        (c) => c.alt_uom_id === r.item_uom,
      );
      if (conv && conv.base_qty) qtyBase = qtyBase * conv.base_qty;
    }
    const key = `${r.handling_unit_id}|${r.material_id}|${r.batch_id || ""}`;
    huReservedMap.set(key, (huReservedMap.get(key) || 0) + qtyBase);
  }

  // Sum HU-held qty per material/location/batch. Only the UNRESERVED portion of an
  // HU item sits in unrestricted_qty, so the reserved part must not be deducted.
  const huQtyMap = new Map();
  for (const it of subRows) {
    // Skip sub-rows whose parent HU isn't in this plant/org (or is deleted).
    if (!huLocationMap.has(it.handling_unit_id)) continue;
    // Skip packed HUs — their qty is in reserved_qty, not unrestricted_qty.
    if (packedHuIds.has(it.handling_unit_id)) continue;

    const locationId = it.location_id || huLocationMap.get(it.handling_unit_id);
    const reservedKey = `${it.handling_unit_id}|${it.material_id}|${
      it.batch_id || ""
    }`;
    const qty = Math.max(
      0,
      (parseFloat(it.quantity) || 0) - (huReservedMap.get(reservedKey) || 0),
    );
    if (qty <= 0) continue;
    const key = `${it.material_id}|${locationId}|${it.batch_id || "no_batch"}`;
    huQtyMap.set(key, (huQtyMap.get(key) || 0) + qty);
  }

  const looseQty = (r) => {
    const key = `${r.material_id}|${r.location_id}|${r.batch_id || "no_batch"}`;
    return Math.max(
      0,
      (parseFloat(r.unrestricted_qty) || 0) - (huQtyMap.get(key) || 0),
    );
  };

  const nonBatchBalances = itemBalanceRows.filter((r) => {
    const item = itemMap.get(r.material_id);
    return item && item.item_batch_management !== 1;
  });

  const combined = [];

  nonBatchBalances.forEach((r) => {
    const item = itemMap.get(r.material_id);
    const available = looseQty(r);
    if (available <= 0) return;
    combined.push({
      material_id: r.material_id,
      material_name: item?.material_name || "",
      material_desc: item?.material_desc || "",
      location_id: r.location_id,
      batch_id: null,
      material_uom: item?.based_uom || "",
      item_quantity: available,
      unload_quantity: 0,
      line_status: "Open",
      balance_id: r.id,
    });
  });

  batchBalanceRows.forEach((r) => {
    const item = itemMap.get(r.material_id);
    const available = looseQty(r);
    if (available <= 0) return;
    combined.push({
      material_id: r.material_id,
      material_name: item?.material_name || "",
      material_desc: item?.material_desc || "",
      location_id: r.location_id,
      batch_id: r.batch_id || null,
      material_uom: item?.based_uom || "",
      item_quantity: available,
      unload_quantity: 0,
      line_status: "Open",
      balance_id: r.id,
    });
  });

  return combined.map((it, index) => ({ ...it, line_index: index }));
};

const fetchBalanceId = async (item, plantId, organizationId) => {
  try {
    const where = {
      material_id: item.material_id,
      plant_id: plantId,
      organization_id: organizationId,
      location_id: item.location_id,
      is_deleted: 0,
    };
    let result;
    if (item.batch_id) {
      where.batch_id = item.batch_id;
      result = await db.collection("item_batch_balance").where(where).get();
    } else {
      result = await db.collection("item_balance").where(where).get();
    }
    if (result?.data?.length > 0) {
      return result.data[0].id;
    }
    console.warn(
      `No balance_id found for material ${item.material_id} at location ${item.location_id}`,
    );
    return "";
  } catch (e) {
    console.error("Error fetching balance_id:", e);
    return "";
  }
};

const buildItemsFromHU = async (sourceTempDataStr, plantId, organizationId) => {
  let parsed;
  try {
    parsed = JSON.parse(sourceTempDataStr);
  } catch (e) {
    return [];
  }
  const huItems = (parsed?.table_hu_items || []).filter(
    (it) => it.is_deleted !== 1 && (parseFloat(it.quantity) || 0) > 0,
  );

  const enriched = huItems.map((it, index) => ({
    material_id: it.material_id,
    material_name: it.material_name,
    material_desc: it.material_desc,
    location_id: it.location_id || parsed.location_id,
    batch_id: it.batch_id || null,
    material_uom: it.material_uom,
    item_quantity: parseFloat(it.quantity) || 0,
    unload_quantity: 0,
    line_status: "Open",
    line_index: index,
    balance_id: it.balance_id || "",
  }));

  const balanceIds = await Promise.all(
    enriched.map((it) =>
      it.balance_id ? it.balance_id : fetchBalanceId(it, plantId, organizationId),
    ),
  );
  enriched.forEach((it, i) => {
    it.balance_id = balanceIds[i];
  });

  return enriched;
};

(async () => {
  try {
    this.showLoading("Loading items...");

    const rowIndex = arguments[0].rowIndex;
    const plantId = this.getValue("plant_id");
    const organizationId = this.getValue("organization_id");
    const repackType = this.getValue("repack_type");

    if (!plantId || !organizationId) {
      this.hideLoading();
      this.$message.error("Please set plant and organization first");
      return;
    }

    const tableRepack = this.getValue("table_repack") || [];
    const currentRow = tableRepack[rowIndex] || {};

    let tableItems = [];

    if (repackType === "Load") {
      tableItems = await fetchInventoryItems(plantId, organizationId);
    } else if (repackType === "Unload" || repackType === "Transfer") {
      if (!currentRow.source_temp_data) {
        this.hideLoading();
        this.$message.error("Please select a source handling unit first");
        return;
      }
      tableItems = await buildItemsFromHU(
        currentRow.source_temp_data,
        plantId,
        organizationId,
      );
    } else {
      this.hideLoading();
      this.$message.error("Please select a repack type first");
      return;
    }

    if (currentRow.items_temp_data) {
      try {
        const previousItems = JSON.parse(currentRow.items_temp_data);
        if (Array.isArray(previousItems)) {
          tableItems.forEach((it) => {
            const match = previousItems.find(
              (p) =>
                p.material_id === it.material_id &&
                (p.batch_id || null) === (it.batch_id || null) &&
                (p.location_id || "") === (it.location_id || ""),
            );
            if (match) {
              it.unload_quantity = parseFloat(match.unload_quantity) || 0;
            }
          });
        }
      } catch (e) {
        console.error("Error parsing items_temp_data:", e);
      }
    }

    selectTab("tab_items");
    hideTab("tab_source_hu");
    hideTab("tab_target_hu");

    if (repackType === "Unload") {
      this.hide("dialog_repack.button_target_hu");
    } else {
      this.display("dialog_repack.button_target_hu");
    }

    await this.openDialog("dialog_repack");

    await this.setData({
      dialog_repack: {
        row_index: rowIndex,
        table_source_hu: [],
        table_items: tableItems,
        table_target_hu: [],
      },
    });

    this.hideLoading();
  } catch (error) {
    this.hideLoading();
    this.$message.error("Error in ROopenSelectItemDialog: " + error.message);
    console.error("Error in ROopenSelectItemDialog:", error);
  }
})();
