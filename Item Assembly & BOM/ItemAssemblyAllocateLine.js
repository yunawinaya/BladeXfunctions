// Typing a quantity on a component line re-picks that line from loose stock, so
// the number on the row always has real allocations behind it. The rules are the
// ones autoAllocate applies during the BOM explosion, scoped to one row.
//
// Fetch budget: one parallel burst for the item and every stock source, then one
// round trip for handling units and one for the bin / batch names on the summary.

const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));

const getOrganizationId = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

const parsePicks = (raw) => {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

const sumPicks = (picks) =>
  picks.reduce((sum, pick) => sum + (parseFloat(pick.sm_quantity) || 0), 0);

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

const fetchBalances = (collection, materialId, plantId, organizationId) =>
  db
    .collection(collection)
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          { prop: "material_id", operator: "in", value: [materialId] },
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

// Item master default bin for this plant. A row without a bin is treated as
// unconfigured so we never sort on a blank.
const getItemDefaultBin = (tableDefaultBin, plantId) => {
  if (!plantId || !Array.isArray(tableDefaultBin)) return null;
  const matchingBin = tableDefaultBin.find(
    (bin) => bin.plant_id === plantId && bin.bin_location
  );
  return matchingBin ? matchingBin.bin_location : null;
};

(async () => {
  const rowIndex = arguments[0].rowIndex;

  try {
    const requested = q8(arguments[0].value);
    const allData = this.getValues();
    const row = (allData.stock_movement || [])[rowIndex];
    if (!row || !row.item_selection) return;

    const currentPicks = parsePicks(row.temp_qty_data);
    const pickedTotal = q8(sumPicks(currentPicks));

    // The picks already add up to what was typed -- this is our own write coming
    // back round, or the same number entered again.
    if (Math.abs(pickedTotal - requested) <= 0.0000001) return;

    // setData below re-enters this handler; this.models is the form-wide bag the
    // stock dialog already uses for its own cross-call state.
    if (this.models["ia_allocating_line"] === rowIndex) return;

    const organizationId = getOrganizationId();
    const plantId = allData.issuing_operation_faci;
    const materialId = row.item_selection;

    if (!plantId) {
      this.$message.warning("Select a Plant before entering quantities.");
      return;
    }

    this.models["ia_allocating_line"] = rowIndex;

    const [itemRes, looseRes, batchRes, huSubRes, reservationRes] =
      await Promise.all([
        fetchByIds(
          "item",
          [materialId],
          "material_name,serial_number_management,item_batch_management,table_default_bin"
        ),
        fetchBalances("item_balance", materialId, plantId, organizationId),
        fetchBalances("item_batch_balance", materialId, plantId, organizationId),
        db
          .collection("handling_unit_atu7sreg_sub")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "material_id", operator: "in", value: [materialId] },
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
                { prop: "material_id", operator: "in", value: [materialId] },
                { prop: "plant_id", operator: "equal", value: plantId },
                {
                  prop: "organization_id",
                  operator: "equal",
                  value: organizationId,
                },
                { prop: "is_deleted", operator: "equal", value: 0 },
              ],
            },
          ])
          .get()
          .catch(() => ({ data: [] })),
      ]);

    const item = (itemRes.data || [])[0];

    // A serialized component can only be picked serial by serial, so the typed
    // number is restored and the user is sent to the dialog.
    if (item?.serial_number_management === 1) {
      await this.setData({
        [`stock_movement.${rowIndex}.total_quantity`]: pickedTotal,
      });
      this.$message.warning(
        `${row.item_name || "This component"} is serialized. Use Transfer Stock to pick the serial numbers.`
      );
      return;
    }

    const balanceRows =
      item?.item_batch_management === 1
        ? batchRes.data || []
        : looseRes.data || [];

    // An Allocated reservation against an HU is logically Reserved, so that
    // portion never sat in unrestricted_qty and must not be deducted twice.
    const huReservedMap = new Map();
    (reservationRes.data || [])
      .filter((r) => parseFloat(r.open_qty || 0) > 0 && r.status === "Allocated")
      .forEach((r) => {
        if (!r.handling_unit_id) return;
        const key = `${r.handling_unit_id}|${r.batch_id || ""}`;
        huReservedMap.set(
          key,
          (huReservedMap.get(key) || 0) + parseFloat(r.open_qty || 0)
        );
      });

    const huIds = [
      ...new Set(
        (huSubRes.data || []).map((sub) => sub.handling_unit_id).filter(Boolean)
      ),
    ];
    const huRes = huIds.length
      ? await fetchByIds("handling_unit", huIds)
      : { data: [] };

    const huQtyMap = new Map();
    (huRes.data || []).forEach((hu) => {
      (hu.table_hu_items || [])
        .filter((huItem) => huItem.is_deleted !== 1)
        .filter((huItem) => String(huItem.material_id) === String(materialId))
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

    // Sibling lines' picks are staged in temp_qty_data and not yet in the DB, so
    // unrestricted_qty still counts them as free. Only loose picks are deducted
    // here -- HU-held picks come out of the HU pool already removed above.
    const siblingStaged = new Map();
    (allData.stock_movement || []).forEach((line, idx) => {
      if (idx === rowIndex) return;
      if (String(line.item_selection) !== String(materialId)) return;
      parsePicks(line.temp_qty_data)
        .filter((pick) => !pick.handling_unit_id)
        .forEach((pick) => {
          const key = `${pick.material_id}|${pick.location_id}|${
            pick.batch_id || "no_batch"
          }`;
          siblingStaged.set(
            key,
            (siblingStaged.get(key) || 0) + (parseFloat(pick.sm_quantity) || 0)
          );
        });
    });

    const preferredBin = getItemDefaultBin(item?.table_default_bin, plantId);

    // unrestricted_qty is already net of Allocated loose reservations, so only
    // HU-held stock and sibling staging have to come off here.
    const candidates = balanceRows
      .map((balance) => {
        const key = `${balance.material_id}|${balance.location_id}|${
          balance.batch_id || "no_batch"
        }`;
        return {
          balance,
          available: Math.max(
            0,
            (parseFloat(balance.unrestricted_qty) || 0) -
              (huQtyMap.get(key) || 0) -
              (siblingStaged.get(key) || 0)
          ),
        };
      })
      .filter((candidate) => candidate.available > 0)
      .sort((a, b) => {
        const byBin =
          (b.balance.location_id === preferredBin ? 1 : 0) -
          (a.balance.location_id === preferredBin ? 1 : 0);
        return byBin !== 0
          ? byBin
          : String(a.balance.create_time || "").localeCompare(
              String(b.balance.create_time || "")
            );
      });

    let remaining = Math.max(0, requested);
    const picks = [];

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const take = q8(Math.min(candidate.available, remaining));
      if (take <= 0) continue;
      remaining = q8(remaining - take);

      const balance = candidate.balance;
      picks.push({
        material_id: balance.material_id,
        location_id: balance.location_id,
        storage_location_id: balance.storage_location_id || null,
        batch_id: balance.batch_id || null,
        balance_id: balance.id,
        sm_quantity: take,
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

    const allocated = q8(sumPicks(picks));

    let summary = "";
    if (picks.length > 0) {
      const binIds = [
        ...new Set(picks.map((pick) => pick.location_id).filter(Boolean)),
      ];
      const batchIds = [
        ...new Set(picks.map((pick) => pick.batch_id).filter(Boolean)),
      ];

      const [binRes, batchNameRes, uomRes] = await Promise.all([
        binIds.length
          ? fetchByIds("bin_location", binIds, "bin_location_combine")
          : Promise.resolve({ data: [] }),
        batchIds.length
          ? fetchByIds("batch", batchIds, "batch_number")
          : Promise.resolve({ data: [] }),
        row.quantity_uom
          ? fetchByIds("unit_of_measurement", [row.quantity_uom], "uom_name")
          : Promise.resolve({ data: [] }),
      ]);

      const binMap = new Map(
        (binRes.data || []).map((bin) => [bin.id, bin.bin_location_combine])
      );
      const batchMap = new Map(
        (batchNameRes.data || []).map((batch) => [batch.id, batch.batch_number])
      );
      const uomName = (uomRes.data || [])[0]?.uom_name || "";

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

      summary = `Total: ${allocated} ${uomName}\n\nDETAILS:\n${details}`;
    }

    // The re-pick is loose-only, so any handling unit staged earlier on this row
    // is no longer part of the allocation.
    await this.setData({
      [`stock_movement.${rowIndex}.total_quantity`]: allocated,
      [`stock_movement.${rowIndex}.temp_qty_data`]: picks.length
        ? JSON.stringify(picks)
        : "",
      [`stock_movement.${rowIndex}.temp_hu_data`]: "",
      [`stock_movement.${rowIndex}.stock_summary`]: summary,
    });

    if (remaining > 0) {
      this.$message.warning(
        `Only ${allocated} of ${requested} available as loose stock for ${
          row.item_name || item?.material_name || "this component"
        }. Open Transfer Stock to pick from handling units.`
      );
    }
  } catch (error) {
    console.error("Error allocating the component line:", error);
    this.$message.error(error.message || "Failed to allocate this component");
  } finally {
    this.models["ia_allocating_line"] = undefined;
  }
})();
