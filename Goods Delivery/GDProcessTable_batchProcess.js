/**
 * GDProcessTable_batchProcess.js
 *
 * PURPOSE: Process ALL allocations in a SINGLE code node execution
 * REPLACES: The nested loops + GLOBAL_RESERVED workflow calls
 *
 * This contains the same logic as:
 * - GDcreatedLogic.js (for saveAs === "Created")
 * - GDdeliveredLogic.js (for saveAs === "Completed")
 * - CleanupOrphanedAllocations.js (cleanup before processing)
 *
 * PERFORMANCE: Processes 100 items in ~1 second vs 60+ seconds with loops
 *
 * INPUT: Output from GDProcessTable_batchFetch.js
 * OUTPUT: All records to update/create and inventory movements
 */

// Get pre-fetched data from batch fetch node
const batchData = {{node:code_node_eOMvMZOj.data}};

const {
  allItemsData,
  allAllocatedData,
  allPendingData,
  processedTableData,
  isGDPP,
  docId,
  docNo,
  plantId,
  organizationId,
  saveAs,
  docDate,
  parentId,
  parentNo,
  pickingPlanId,
  isPacking,
  isLoadingBay
} = batchData;

// Create item lookup Map from array (workflow platform can't pass object maps)
const itemDataMap = {};
for (const item of allItemsData) {
  itemDataMap[item.id] = item;
}

// Helper functions
const roundQty = (value) => parseFloat(parseFloat(value || 0).toFixed(3));

// Filter itemData to only include fields needed by inventory workflow
const filterItemData = (itemData) => {
  if (!itemData) return null;
  return {
    stock_control: itemData.stock_control,
    based_uom: itemData.based_uom,
    table_uom_conversion: itemData.table_uom_conversion,
    material_costing_method: itemData.material_costing_method,
    purchase_unit_price: itemData.purchase_unit_price,
    item_batch_management: itemData.item_batch_management,
    material_code: itemData.material_code,
    material_name: itemData.material_name,
    material_desc: itemData.material_desc,
  };
};

// Priority order for allocation and release
const releaseOrderPriority = {
  "Good Delivery": 1,
  "Picking Plan": 1,
  "Sales Order": 2,
  "Production": 3,
};

const allocateOrderPriority = {
  "Production": 1,
  "Sales Order": 2,
  "Good Delivery": 3,
  "Picking Plan": 3,
};

// ============ STEP 1: CLEANUP ORPHANED ALLOCATIONS ============
const cleanupOrphanedAllocations = () => {
  if (!allAllocatedData || allAllocatedData.length === 0) {
    return { recordsToUpdate: [], inventoryMovements: [] };
  }

  // Build current temp data keys from ALL table items
  const currentTempDataKeys = [];
  for (const processed of processedTableData) {
    if (processed.skipProcessing) continue;

    for (const groupKey of processed.groupKeys) {
      const group = processed.groupedTempData[groupKey];
      currentTempDataKeys.push({
        doc_line_id: isGDPP === 1 ? (processed.picking_plan_line_id || processed.doc_line_id) : processed.doc_line_id,
        material_id: processed.material_id,
        batch_id: group.batch_id,
        bin_location: group.location_id,
        handling_unit_id: group.handling_unit_id || null,
      });
    }
  }

  // Find orphaned records (allocated but not in current temp data)
  const orphanedRecords = allAllocatedData.filter(
    (allocated) =>
      !currentTempDataKeys.some(
        (current) =>
          String(allocated.doc_line_id) === String(current.doc_line_id) &&
          String(allocated.material_id) === String(current.material_id) &&
          String(allocated.batch_id || "") === String(current.batch_id || "") &&
          String(allocated.bin_location || "") === String(current.bin_location || "") &&
          String(allocated.handling_unit_id || "") === String(current.handling_unit_id || "")
      )
  );

  if (orphanedRecords.length === 0) {
    return { recordsToUpdate: [], inventoryMovements: [] };
  }

  const sortedOrphanedRecords = [...orphanedRecords].sort(
    (a, b) =>
      (releaseOrderPriority[a.doc_type] || 99) -
      (releaseOrderPriority[b.doc_type] || 99)
  );

  const findExistingPendingToMerge = (docType, parentLineId, materialId, batchId, binLocation) => {
    return allPendingData.find(
      (record) =>
        record.status === "Pending" &&
        record.doc_type === docType &&
        String(record.parent_line_id) === String(parentLineId) &&
        String(record.material_id) === String(materialId) &&
        String(record.batch_id || "") === String(batchId || "") &&
        String(record.bin_location || "") === String(binLocation || "")
    );
  };

  const pendingMergeAccumulator = new Map();
  const recordsToUpdate = [];
  const inventoryMovementMap = new Map();

  for (const orphanedRecord of sortedOrphanedRecords) {
    const releaseQty = orphanedRecord.reserved_qty || 0;

    if (orphanedRecord.doc_type === "Good Delivery" || orphanedRecord.doc_type === "Picking Plan") {
      recordsToUpdate.push({
        id: orphanedRecord.id,
        reserved_qty: orphanedRecord.reserved_qty,
        open_qty: 0,
        status: "Cancelled",
        target_gd_id: null,
      });

      const invKey = `${orphanedRecord.material_id}|${orphanedRecord.batch_id || ""}|${orphanedRecord.bin_location || ""}|${orphanedRecord.doc_line_id || ""}|${orphanedRecord.handling_unit_id || ""}`;
      const existingMovement = inventoryMovementMap.get(invKey);
      if (existingMovement) {
        existingMovement.quantity = roundQty(existingMovement.quantity + releaseQty);
      } else {
        inventoryMovementMap.set(invKey, {
          material_id: orphanedRecord.material_id,
          material_code: orphanedRecord.item_code || "",
          material_name: orphanedRecord.item_name || "",
          material_uom: orphanedRecord.item_uom,
          batch_id: orphanedRecord.batch_id,
          bin_location: orphanedRecord.bin_location,
          handling_unit_id: orphanedRecord.handling_unit_id || null,
          quantity: releaseQty,
          movement_type: "RESERVED_TO_UNRESTRICTED",
          line_so_no: orphanedRecord.parent_no || "",
          doc_line_id: orphanedRecord.doc_line_id || "",
        });
      }
    } else {
      const existingPending = findExistingPendingToMerge(
        orphanedRecord.doc_type,
        orphanedRecord.parent_line_id,
        orphanedRecord.material_id,
        orphanedRecord.batch_id,
        orphanedRecord.bin_location
      );

      if (existingPending) {
        const accumulatedQty = pendingMergeAccumulator.get(existingPending.id) || 0;
        pendingMergeAccumulator.set(existingPending.id, roundQty(accumulatedQty + releaseQty));

        recordsToUpdate.push({
          id: orphanedRecord.id,
          reserved_qty: orphanedRecord.reserved_qty,
          open_qty: 0,
          status: "Cancelled",
          target_gd_id: null,
        });
      } else {
        recordsToUpdate.push({
          ...orphanedRecord,
          doc_id: "",
          doc_no: "",
          doc_line_id: "",
          status: "Pending",
          target_gd_id: null,
        });
      }
    }
  }

  // Apply accumulated pending merges
  for (const [pendingId, accumulatedQty] of pendingMergeAccumulator.entries()) {
    const existingPending = allPendingData.find((r) => String(r.id) === String(pendingId));
    if (existingPending) {
      recordsToUpdate.push({
        id: pendingId,
        reserved_qty: roundQty(existingPending.reserved_qty + accumulatedQty),
        open_qty: roundQty(existingPending.open_qty + accumulatedQty),
        status: "Pending",
      });
    }
  }

  return {
    recordsToUpdate,
    inventoryMovements: Array.from(inventoryMovementMap.values()),
  };
};

// ============ STEP 1.5: DETECT BIN+HU MIGRATIONS ============
// When Packing (or a direct-edit that changes bin/HU) moves qty from one
// (bin_location, handling_unit_id) to another for the same GD line, the old
// on_reserved_gd record and the new temp_qty_data entry share the same
// (doc_line_id, material_id, batch_id) triplet but differ on the 5-tuple.
//
// Without detection, cleanup releases Reserved at the old bin (underflow if
// the Reserved qty was physically moved by Packing's repack) and the main
// loop fresh-allocates at the new bin via UNRESTRICTED_TO_RESERVED (underflow
// because there's no Unrestricted at the new bin either). Both paths collide
// with the actual physical state.
//
// Detection emits a direct cross-bin Reserved shuttle (subtract at old,
// add at new), mutates in-memory allAllocatedData to reflect the split so
// downstream cleanup/processCreatedAllocation see the already-reconciled
// state, and flags fully-consumed temp entries so the main loop skips them.
const detectBinHuMigrations = () => {
  const recordsToUpdate = [];
  const recordsToCreate = [];
  const inventoryMovements = [];

  if (!allAllocatedData || allAllocatedData.length === 0) {
    return { recordsToUpdate, recordsToCreate, inventoryMovements };
  }

  // Group existing Allocated records for THIS GD by (doc_line_id, material_id, batch_id).
  const oldByTriplet = new Map();
  for (const rec of allAllocatedData) {
    if (rec.status !== "Allocated") continue;
    if (String(rec.target_gd_id) !== String(docId)) continue;
    const k = `${rec.doc_line_id}|${rec.material_id}|${rec.batch_id || ""}`;
    if (!oldByTriplet.has(k)) oldByTriplet.set(k, []);
    oldByTriplet.get(k).push(rec);
  }
  if (oldByTriplet.size === 0) {
    return { recordsToUpdate, recordsToCreate, inventoryMovements };
  }

  // Group current temp entries by the same triplet.
  const newByTriplet = new Map();
  for (const processed of processedTableData) {
    if (processed.skipProcessing) continue;
    const docLineId = isGDPP === 1
      ? (processed.picking_plan_line_id || processed.doc_line_id)
      : processed.doc_line_id;
    for (const groupKey of processed.groupKeys) {
      const group = processed.groupedTempData[groupKey];
      const k = `${docLineId}|${processed.material_id}|${group.batch_id || ""}`;
      if (!newByTriplet.has(k)) newByTriplet.set(k, []);
      newByTriplet.get(k).push({
        processed,
        group,
        binLocation: group.location_id,
        handlingUnitId: group.handling_unit_id || null,
      });
    }
  }

  const fullyMigratedOldIds = new Set();

  for (const [tripletKey, oldRecs] of oldByTriplet) {
    const newEntries = newByTriplet.get(tripletKey) || [];
    if (newEntries.length === 0) continue;

    const tupleMatch = (r, e) =>
      String(r.bin_location || "") === String(e.binLocation || "") &&
      String(r.handling_unit_id || "") === String(e.handlingUnitId || "");

    const unmatchedOld = oldRecs.filter((r) => !newEntries.some((e) => tupleMatch(r, e)));
    const unmatchedNew = newEntries.filter((e) => !oldRecs.some((r) => tupleMatch(r, e)));
    if (unmatchedOld.length === 0 || unmatchedNew.length === 0) continue;

    // Track how much of each new entry's qty is still unconsumed by migration.
    // Greedy pairing: for each unmatched old record, siphon qty into unmatched
    // new entries in order. Partial migration is fine — the rest of the new
    // entry falls through to processCreatedAllocation's fresh-alloc path.
    const newRemaining = new Map();
    for (const e of unmatchedNew) {
      newRemaining.set(e, roundQty(e.group.totalQty || 0));
    }

    for (const oldRec of unmatchedOld) {
      let oldRemaining = roundQty(oldRec.reserved_qty || 0);
      for (const entry of unmatchedNew) {
        if (oldRemaining <= 0) break;
        const avail = newRemaining.get(entry) || 0;
        if (avail <= 0) continue;
        const migrateQty = roundQty(Math.min(oldRemaining, avail));
        if (migrateQty <= 0) continue;

        // Reduce or Cancel the old record.
        const newOldQty = roundQty((oldRec.reserved_qty || 0) - migrateQty);
        if (newOldQty <= 0) {
          recordsToUpdate.push({
            id: oldRec.id,
            reserved_qty: oldRec.reserved_qty,
            open_qty: 0,
            status: "Cancelled",
            target_gd_id: null,
          });
          fullyMigratedOldIds.add(oldRec.id);
        } else {
          recordsToUpdate.push({
            ...oldRec,
            reserved_qty: newOldQty,
            open_qty: newOldQty,
          });
          oldRec.reserved_qty = newOldQty;
          oldRec.open_qty = newOldQty;
        }

        // Create the new record at the target 5-tuple, inheriting doc_type
        // and source_reserved_id chain so SO/Production lineage is preserved.
        const { _id: _oldUnderscoreId, id: _oldId, ...oldWithoutId } = oldRec;
        const newRecord = {
          ...oldWithoutId,
          bin_location: entry.binLocation,
          handling_unit_id: entry.handlingUnitId,
          reserved_qty: migrateQty,
          open_qty: migrateQty,
          delivered_qty: 0,
          status: "Allocated",
          source_reserved_id: oldRec.source_reserved_id || oldRec.id,
          target_gd_id: docId,
        };
        recordsToCreate.push(newRecord);
        // Also push into in-memory allAllocatedData (no DB id yet) so that
        // downstream processCreatedAllocation's 5-tuple match finds it —
        // important for partial-migration cases where the temp entry still
        // needs fresh alloc for the remainder.
        allAllocatedData.push({ ...newRecord });

        // Cross-bin Reserved shuttle.
        inventoryMovements.push({
          material_id: oldRec.material_id,
          material_code: oldRec.item_code || "",
          material_name: oldRec.item_name || "",
          material_uom: oldRec.item_uom,
          batch_id: oldRec.batch_id,
          bin_location: oldRec.bin_location,
          handling_unit_id: oldRec.handling_unit_id || null,
          quantity: migrateQty,
          movement_type: "RESERVED_SUBTRACT_CROSS_BIN",
          line_so_no: oldRec.parent_no || "",
          doc_line_id: oldRec.doc_line_id || "",
        });
        inventoryMovements.push({
          material_id: oldRec.material_id,
          material_code: oldRec.item_code || "",
          material_name: oldRec.item_name || "",
          material_uom: oldRec.item_uom,
          batch_id: oldRec.batch_id,
          bin_location: entry.binLocation,
          handling_unit_id: entry.handlingUnitId,
          quantity: migrateQty,
          movement_type: "RESERVED_ADD_CROSS_BIN",
          line_so_no: oldRec.parent_no || "",
          doc_line_id: oldRec.doc_line_id || "",
        });

        oldRemaining = roundQty(oldRemaining - migrateQty);
        const remainingOnEntry = roundQty(avail - migrateQty);
        newRemaining.set(entry, remainingOnEntry);
        if (remainingOnEntry <= 0) {
          // Main loop will skip this group — pre-step fully handled it.
          entry.group._fullyMigrated = true;
        }
      }
    }
  }

  // Strip fully-migrated old records from in-memory allAllocatedData so the
  // Step 1 cleanup pass below doesn't flag them as orphans and re-release.
  if (fullyMigratedOldIds.size > 0) {
    for (let i = allAllocatedData.length - 1; i >= 0; i--) {
      if (fullyMigratedOldIds.has(allAllocatedData[i].id)) {
        allAllocatedData.splice(i, 1);
      }
    }
  }

  return { recordsToUpdate, recordsToCreate, inventoryMovements };
};

// ============ STEP 2: PROCESS CREATED ALLOCATIONS ============
const processCreatedAllocation = (params) => {
  const {
    quantity,
    parentId,
    parentLineId,
    docLineId,
    materialId,
    itemData,
    batchId,
    locationId,
    materialUom,
    index,
    remark,
    isPP,
    lineSoNo,
    materialCode,
    materialName,
  } = params;

  const allocDocType = isPP ? "Picking Plan" : "Good Delivery";

  // Find matched allocated records for this specific item/location/batch/HU
  const handlingUnitId = params.handlingUnitId || null;
  const matchedOldRecords = allAllocatedData.filter(
    (record) =>
      String(record.doc_line_id) === String(docLineId) &&
      String(record.material_id) === String(materialId) &&
      String(record.batch_id || "") === String(batchId || "") &&
      String(record.bin_location || "") === String(locationId || "") &&
      String(record.handling_unit_id || "") === String(handlingUnitId || "") &&
      record.status === "Allocated" &&
      String(record.target_gd_id) === String(docId)
  );

  // Find relevant pending records for this material/location/batch/HU
  // HU must match: SO pending (HU=null) only matches loose picks (HU=null),
  // HU picks go to unrestricted since SO doesn't reserve at HU level
  const relevantPendingData = allPendingData.filter(
    (record) =>
      String(record.material_id) === String(materialId) &&
      String(record.batch_id || "") === String(batchId || "") &&
      String(record.bin_location || "") === String(locationId || "") &&
      String(record.handling_unit_id || "") === String(handlingUnitId || "") &&
      record.status === "Pending"
  );

  // If we have existing allocated records, handle updates
  if (matchedOldRecords.length > 0) {
    const oldQty = matchedOldRecords.reduce((sum, r) => sum + (r.reserved_qty || 0), 0);
    const netChange = roundQty(quantity - oldQty);

    if (netChange === 0) {
      return {
        recordsToUpdate: [],
        recordsToCreate: [],
        inventoryMovements: [],
      };
    }

    if (netChange < 0) {
      // Quantity decreased - release allocation
      const qtyToRelease = Math.abs(netChange);
      let remainingQtyToRelease = qtyToRelease;
      const recordsToUpdate = [];
      const recordsToCreate = [];
      let unrestrictedQtyToAdd = 0;

      const sortedRecordsForRelease = [...matchedOldRecords].sort(
        (a, b) =>
          (releaseOrderPriority[a.doc_type] || 99) -
          (releaseOrderPriority[b.doc_type] || 99)
      );

      const findExistingPendingToMerge = (docType) => {
        return relevantPendingData.find(
          (record) =>
            record.status === "Pending" &&
            record.doc_type === docType &&
            String(record.parent_line_id) === String(parentLineId)
        );
      };

      for (const oldRecord of sortedRecordsForRelease) {
        if (remainingQtyToRelease <= 0) break;

        const releaseFromThisRecord = Math.min(oldRecord.reserved_qty, remainingQtyToRelease);
        const isFromUnrestricted = oldRecord.doc_type === "Good Delivery" || oldRecord.doc_type === "Picking Plan";

        if (releaseFromThisRecord === oldRecord.reserved_qty) {
          if (isFromUnrestricted) {
            recordsToUpdate.push({
              ...oldRecord,
              reserved_qty: oldRecord.reserved_qty,
              open_qty: 0,
              status: "Cancelled",
              target_gd_id: null,
            });
            unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + releaseFromThisRecord);
          } else {
            const existingPending = findExistingPendingToMerge(oldRecord.doc_type);
            if (existingPending) {
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThisRecord),
                open_qty: roundQty(existingPending.open_qty + releaseFromThisRecord),
                status: "Pending",
              });
              recordsToUpdate.push({
                ...oldRecord,
                reserved_qty: oldRecord.reserved_qty,
                open_qty: 0,
                status: "Cancelled",
                target_gd_id: null,
              });
            } else {
              recordsToUpdate.push({
                ...oldRecord,
                doc_id: "",
                doc_no: "",
                doc_line_id: "",
                reserved_qty: oldRecord.reserved_qty,
                open_qty: oldRecord.reserved_qty,
                status: "Pending",
                target_gd_id: null,
              });
            }
          }
        } else {
          recordsToUpdate.push({
            ...oldRecord,
            reserved_qty: roundQty(oldRecord.reserved_qty - releaseFromThisRecord),
            open_qty: roundQty(oldRecord.reserved_qty - releaseFromThisRecord),
            status: "Allocated",
            target_gd_id: docId,
          });

          if (isFromUnrestricted) {
            const { _id, id, ...recordWithoutId } = oldRecord;
            recordsToCreate.push({
              ...recordWithoutId,
              reserved_qty: releaseFromThisRecord,
              open_qty: 0,
              status: "Cancelled",
              source_reserved_id: oldRecord.id,
              target_gd_id: null,
            });
            unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + releaseFromThisRecord);
          } else {
            const existingPending = findExistingPendingToMerge(oldRecord.doc_type);
            if (existingPending) {
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThisRecord),
                open_qty: roundQty(existingPending.open_qty + releaseFromThisRecord),
                status: "Pending",
              });
            } else {
              const { _id, id, ...recordWithoutId } = oldRecord;
              recordsToCreate.push({
                ...recordWithoutId,
                doc_id: "",
                doc_no: "",
                doc_line_id: "",
                reserved_qty: releaseFromThisRecord,
                open_qty: releaseFromThisRecord,
                status: "Pending",
                source_reserved_id: oldRecord.id,
                target_gd_id: null,
              });
            }
          }
        }

        remainingQtyToRelease = roundQty(remainingQtyToRelease - releaseFromThisRecord);
      }

      const inventoryMovements = [];
      if (unrestrictedQtyToAdd > 0) {
        inventoryMovements.push({
          material_id: materialId,
          material_code: materialCode,
          material_name: materialName,
          material_uom: materialUom,
          batch_id: batchId,
          bin_location: locationId,
          handling_unit_id: handlingUnitId,
          quantity: unrestrictedQtyToAdd,
          movement_type: "RESERVED_TO_UNRESTRICTED",
          line_so_no: lineSoNo,
          doc_line_id: docLineId,
          itemData: filterItemData(itemData),
        });
      }

      return { recordsToUpdate, recordsToCreate, inventoryMovements };
    }

    if (netChange > 0) {
      // Quantity increased - allocate more
      const additionalQty = netChange;
      return allocateFromPending(additionalQty, relevantPendingData, params, allocDocType);
    }
  }

  // No existing allocated records - fresh allocation
  return allocateFromPending(quantity, relevantPendingData, params, allocDocType);
};

// Helper: Allocate from pending records following priority
const allocateFromPending = (qtyToAllocate, pendingData, params, allocDocType) => {
  const {
    parentId: lineParentId,
    parentLineId,
    docLineId,
    materialId,
    itemData,
    batchId,
    locationId,
    materialUom,
    index,
    remark,
    lineSoNo,
    materialCode,
    materialName,
  } = params;

  // When GD line is linked to a specific SO (parentLineId is set), only consume
  // that SO's pending record - prevents cross-SO contamination
  const pendingSOData = pendingData.filter((item) => {
    if (item.doc_type !== "Sales Order") return false;
    if (parentLineId) {
      return String(item.parent_line_id) === String(parentLineId);
    }
    return true;
  });
  const pendingProdData = pendingData.filter((item) => {
    if (item.doc_type !== "Production") return false;
    if (parentLineId) {
      return String(item.parent_line_id) === String(parentLineId);
    }
    return true;
  });

  let remainingQtyToAllocate = qtyToAllocate;
  const recordsToUpdate = [];
  const recordsToCreate = [];

  // Allocate from Production first (priority 1)
  if (pendingProdData.length > 0 && remainingQtyToAllocate > 0) {
    const prodRecord = pendingProdData[0];
    const availableQty = getPendingAvailableQty(prodRecord);
    if (availableQty > 0) {
      const allocateQty = Math.min(availableQty, remainingQtyToAllocate);
      const isFirstConsumer = (pendingConsumed.get(prodRecord.id) || 0) === 0;
      markPendingConsumed(prodRecord.id, allocateQty);

      if (isFirstConsumer) {
        // First consumer: update original record in-place
        recordsToUpdate.push({
          ...prodRecord,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          handling_unit_id: params.handlingUnitId || null,
          reserved_qty: allocateQty,
          open_qty: allocateQty,
          status: "Allocated",
          target_gd_id: docId,
        });
      } else {
        // Subsequent consumer: create new record (original already taken by first consumer)
        const { _id, id, ...prodWithoutId } = prodRecord;
        recordsToCreate.push({
          ...prodWithoutId,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          handling_unit_id: params.handlingUnitId || null,
          reserved_qty: allocateQty,
          open_qty: allocateQty,
          status: "Allocated",
          source_reserved_id: prodRecord.source_reserved_id || prodRecord.id,
          target_gd_id: docId,
        });
      }
      // Remainder is handled post-loop via pendingConsumed map
      remainingQtyToAllocate = roundQty(remainingQtyToAllocate - allocateQty);
    }
  }

  // Allocate from Sales Order (priority 2)
  if (pendingSOData.length > 0 && remainingQtyToAllocate > 0) {
    const soRecord = pendingSOData[0];
    const availableQty = getPendingAvailableQty(soRecord);
    if (availableQty > 0) {
      const allocateQty = Math.min(availableQty, remainingQtyToAllocate);
      const isFirstConsumer = (pendingConsumed.get(soRecord.id) || 0) === 0;
      markPendingConsumed(soRecord.id, allocateQty);

      if (isFirstConsumer) {
        recordsToUpdate.push({
          ...soRecord,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          handling_unit_id: params.handlingUnitId || null,
          reserved_qty: allocateQty,
          open_qty: allocateQty,
          status: "Allocated",
          target_gd_id: docId,
        });
      } else {
        const { _id, id, ...soWithoutId } = soRecord;
        recordsToCreate.push({
          ...soWithoutId,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          handling_unit_id: params.handlingUnitId || null,
          reserved_qty: allocateQty,
          open_qty: allocateQty,
          status: "Allocated",
          source_reserved_id: soRecord.source_reserved_id || soRecord.id,
          target_gd_id: docId,
        });
      }
      remainingQtyToAllocate = roundQty(remainingQtyToAllocate - allocateQty);
    }
  }

  // Allocate from unrestricted (priority 3) - create new GD record
  const inventoryMovements = [];
  if (remainingQtyToAllocate > 0) {
    recordsToCreate.push({
      doc_type: allocDocType,
      status: "Allocated",
      source_reserved_id: null,
      parent_id: lineParentId,
      parent_line_id: parentLineId,
      parent_no: lineSoNo,
      doc_no: docNo,
      doc_id: docId,
      doc_line_id: docLineId,
      material_id: materialId,
      item_code: itemData?.material_code || "",
      item_name: itemData?.material_name || "",
      item_desc: itemData?.material_desc || "",
      batch_id: batchId,
      bin_location: locationId,
      handling_unit_id: params.handlingUnitId || null,
      item_uom: materialUom,
      reserved_qty: remainingQtyToAllocate,
      delivered_qty: 0,
      open_qty: remainingQtyToAllocate,
      reserved_date: docDate,
      line_no: index,
      plant_id: plantId,
      organization_id: organizationId,
      remark: remark,
      target_gd_id: docId,
    });

    inventoryMovements.push({
      material_id: materialId,
      material_code: materialCode,
      material_name: materialName,
      material_uom: materialUom,
      batch_id: batchId,
      bin_location: locationId,
      handling_unit_id: params.handlingUnitId || null,
      quantity: remainingQtyToAllocate,
      movement_type: "UNRESTRICTED_TO_RESERVED",
      line_so_no: lineSoNo,
      doc_line_id: docLineId,
      itemData: filterItemData(itemData),
    });
  }

  return { recordsToUpdate, recordsToCreate, inventoryMovements };
};

// ============ STEP 3: PROCESS COMPLETED/DELIVERED ALLOCATIONS ============
const processDeliveredAllocation = (params) => {
  const {
    quantity,
    parentId: lineParentId,
    parentLineId,
    docLineId,
    materialId,
    itemData,
    batchId,
    locationId,
    materialUom,
    index,
    remark,
    isPP,
    pickingPlanLineId,
    linePpId,
    lineSoNo,
    materialCode,
    materialName,
  } = params;

  // Match allocated records based on isGDPP
  const handlingUnitId = params.handlingUnitId || null;
  let matchedAllocatedRecords;
  if (isGDPP === 1) {
    matchedAllocatedRecords = allAllocatedData.filter(
      (record) =>
        String(record.doc_line_id) === String(pickingPlanLineId) &&
        String(record.material_id) === String(materialId) &&
        String(record.batch_id || "") === String(batchId || "") &&
        String(record.bin_location || "") === String(locationId || "") &&
        String(record.handling_unit_id || "") === String(handlingUnitId || "") &&
        record.status === "Allocated" &&
        String(record.target_gd_id) === String(linePpId)
    );
  } else {
    matchedAllocatedRecords = allAllocatedData.filter(
      (record) =>
        String(record.doc_line_id) === String(docLineId) &&
        String(record.material_id) === String(materialId) &&
        String(record.batch_id || "") === String(batchId || "") &&
        String(record.bin_location || "") === String(locationId || "") &&
        String(record.handling_unit_id || "") === String(handlingUnitId || "") &&
        record.status === "Allocated" &&
        String(record.target_gd_id) === String(docId)
    );
  }

  const relevantPendingData = allPendingData.filter(
    (record) =>
      String(record.material_id) === String(materialId) &&
      String(record.batch_id || "") === String(batchId || "") &&
      String(record.bin_location || "") === String(locationId || "") &&
      String(record.handling_unit_id || "") === String(handlingUnitId || "") &&
      record.status === "Pending"
  );

  const recordsToUpdate = [];
  const recordsToCreate = [];
  const inventoryMovements = [];
  let reservedQtyToSubtract = 0;

  if (matchedAllocatedRecords.length > 0) {
    const totalAllocatedQty = matchedAllocatedRecords.reduce(
      (sum, r) => sum + (r.open_qty || 0),
      0
    );

    if (quantity <= totalAllocatedQty) {
      // Delivery from allocated - may need to release excess
      let remainingQtyToDeliver = quantity;
      let remainingQtyToRelease = roundQty(totalAllocatedQty - quantity);
      let unrestrictedQtyToAdd = 0;

      const sortedAllocatedRecords = [...matchedAllocatedRecords].sort(
        (a, b) =>
          (releaseOrderPriority[a.doc_type] || 99) -
          (releaseOrderPriority[b.doc_type] || 99)
      );

      const findExistingPendingToMerge = (docType, recordParentLineId) => {
        return relevantPendingData.find(
          (record) =>
            record.status === "Pending" &&
            record.doc_type === docType &&
            String(record.parent_line_id) === String(recordParentLineId)
        );
      };

      for (const allocatedRecord of sortedAllocatedRecords) {
        if (remainingQtyToDeliver <= 0 && remainingQtyToRelease <= 0) break;

        const recordQty = allocatedRecord.open_qty || 0;
        const isFromUnrestricted = allocatedRecord.doc_type === "Good Delivery";
        const isFromPP = allocatedRecord.doc_type === "Picking Plan";

        if (remainingQtyToDeliver > 0) {
          const deliverFromThisRecord = Math.min(recordQty, remainingQtyToDeliver);

          if (deliverFromThisRecord === recordQty) {
            recordsToUpdate.push({
              ...allocatedRecord,
              reserved_qty: allocatedRecord.reserved_qty,
              open_qty: 0,
              delivered_qty: roundQty((allocatedRecord.delivered_qty || 0) + deliverFromThisRecord),
              status: "Delivered",
              doc_id: isFromPP ? docId : allocatedRecord.doc_id,
              doc_no: isFromPP ? docNo : allocatedRecord.doc_no,
              doc_line_id: isFromPP ? docLineId : allocatedRecord.doc_line_id,
              doc_type: isFromPP ? "Good Delivery" : allocatedRecord.doc_type,
              target_gd_id: isFromPP ? docId : allocatedRecord.target_gd_id,
            });
          } else {
            recordsToUpdate.push({
              ...allocatedRecord,
              reserved_qty: deliverFromThisRecord,
              open_qty: 0,
              delivered_qty: deliverFromThisRecord,
              status: "Delivered",
              doc_id: isFromPP ? docId : allocatedRecord.doc_id,
              doc_no: isFromPP ? docNo : allocatedRecord.doc_no,
              doc_line_id: isFromPP ? docLineId : allocatedRecord.doc_line_id,
              doc_type: isFromPP ? "Good Delivery" : allocatedRecord.doc_type,
              target_gd_id: isFromPP ? docId : allocatedRecord.target_gd_id,
            });

            const remainderQty = roundQty(recordQty - deliverFromThisRecord);
            if (isFromPP) {
              const { _id, id, ...recordWithoutId } = allocatedRecord;
              recordsToCreate.push({
                ...recordWithoutId,
                reserved_qty: remainderQty,
                open_qty: remainderQty,
                delivered_qty: 0,
                status: "Allocated",
                source_reserved_id: allocatedRecord.id,
              });
            } else if (isFromUnrestricted) {
              const { _id, id, ...recordWithoutId } = allocatedRecord;
              recordsToCreate.push({
                ...recordWithoutId,
                reserved_qty: remainderQty,
                open_qty: 0,
                delivered_qty: 0,
                status: "Cancelled",
                source_reserved_id: allocatedRecord.id,
                target_gd_id: null,
              });
              unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + remainderQty);
            } else {
              const existingPending = findExistingPendingToMerge(
                allocatedRecord.doc_type,
                allocatedRecord.parent_line_id
              );
              if (existingPending) {
                recordsToUpdate.push({
                  ...existingPending,
                  reserved_qty: roundQty(existingPending.reserved_qty + remainderQty),
                  open_qty: roundQty(existingPending.open_qty + remainderQty),
                  status: "Pending",
                });
              } else {
                const { _id, id, ...recordWithoutId } = allocatedRecord;
                recordsToCreate.push({
                  ...recordWithoutId,
                  doc_id: "",
                  doc_no: "",
                  doc_line_id: "",
                  reserved_qty: remainderQty,
                  open_qty: remainderQty,
                  delivered_qty: 0,
                  status: "Pending",
                  source_reserved_id: allocatedRecord.source_reserved_id || allocatedRecord.id,
                  target_gd_id: null,
                });
              }
            }
          }

          remainingQtyToDeliver = roundQty(remainingQtyToDeliver - deliverFromThisRecord);
          reservedQtyToSubtract = roundQty(reservedQtyToSubtract + deliverFromThisRecord);
        } else if (remainingQtyToRelease > 0) {
          // Release excess allocation
          const releaseFromThisRecord = Math.min(recordQty, remainingQtyToRelease);

          if (releaseFromThisRecord === recordQty) {
            if (isFromPP) {
              recordsToUpdate.push({
                ...allocatedRecord,
                status: "Allocated",
              });
            } else if (isFromUnrestricted) {
              recordsToUpdate.push({
                ...allocatedRecord,
                open_qty: 0,
                status: "Cancelled",
                target_gd_id: null,
              });
              unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + releaseFromThisRecord);
            } else {
              const existingPending = findExistingPendingToMerge(
                allocatedRecord.doc_type,
                allocatedRecord.parent_line_id
              );
              if (existingPending) {
                recordsToUpdate.push({
                  ...existingPending,
                  reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThisRecord),
                  open_qty: roundQty(existingPending.open_qty + releaseFromThisRecord),
                  status: "Pending",
                });
                recordsToUpdate.push({
                  ...allocatedRecord,
                  reserved_qty: allocatedRecord.reserved_qty,
                  open_qty: 0,
                  status: "Cancelled",
                  target_gd_id: null,
                });
              } else {
                recordsToUpdate.push({
                  ...allocatedRecord,
                  doc_id: "",
                  doc_no: "",
                  doc_line_id: "",
                  status: "Pending",
                  target_gd_id: null,
                });
              }
            }
          } else {
            // Partial release
            if (isFromPP) {
              // PP: Keep as Allocated, no partial release - don't reduce the record
              remainingQtyToRelease = 0;
            } else if (isFromUnrestricted) {
              recordsToUpdate.push({
                ...allocatedRecord,
                reserved_qty: roundQty(recordQty - releaseFromThisRecord),
                open_qty: roundQty(recordQty - releaseFromThisRecord),
                status: "Allocated",
              });

              const { _id, id, ...recordWithoutId } = allocatedRecord;
              recordsToCreate.push({
                ...recordWithoutId,
                reserved_qty: releaseFromThisRecord,
                open_qty: 0,
                delivered_qty: 0,
                status: "Cancelled",
                source_reserved_id: allocatedRecord.id,
                target_gd_id: null,
              });
              unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + releaseFromThisRecord);
            } else {
              // SO/Production: Reduce record and create pending
              recordsToUpdate.push({
                ...allocatedRecord,
                reserved_qty: roundQty(recordQty - releaseFromThisRecord),
                open_qty: roundQty(recordQty - releaseFromThisRecord),
                status: "Allocated",
              });

              const existingPending = findExistingPendingToMerge(
                allocatedRecord.doc_type,
                allocatedRecord.parent_line_id
              );

              if (existingPending) {
                recordsToUpdate.push({
                  ...existingPending,
                  reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThisRecord),
                  open_qty: roundQty(existingPending.open_qty + releaseFromThisRecord),
                  status: "Pending",
                });
              } else {
                const { _id, id, ...recordWithoutId } = allocatedRecord;
                recordsToCreate.push({
                  ...recordWithoutId,
                  doc_id: "",
                  doc_no: "",
                  doc_line_id: "",
                  reserved_qty: releaseFromThisRecord,
                  open_qty: releaseFromThisRecord,
                  delivered_qty: 0,
                  status: "Pending",
                  source_reserved_id: allocatedRecord.source_reserved_id || allocatedRecord.id,
                  target_gd_id: null,
                });
              }
            }
          }
          remainingQtyToRelease = roundQty(remainingQtyToRelease - releaseFromThisRecord);
        }
      }

      if (reservedQtyToSubtract > 0) {
        inventoryMovements.push({
          material_id: materialId,
          material_code: materialCode,
          material_name: materialName,
          material_uom: materialUom,
          batch_id: batchId,
          bin_location: locationId,
          handling_unit_id: handlingUnitId,
          source: "Reserved",
          quantity: reservedQtyToSubtract,
          operation: "subtract",
          movement_type: "DELIVERY",
          line_so_no: lineSoNo,
          doc_line_id: docLineId,
          itemData: filterItemData(itemData),
        });
      }

      if (unrestrictedQtyToAdd > 0) {
        inventoryMovements.push({
          material_id: materialId,
          material_code: materialCode,
          material_name: materialName,
          material_uom: materialUom,
          batch_id: batchId,
          bin_location: locationId,
          handling_unit_id: handlingUnitId,
          quantity: unrestrictedQtyToAdd,
          movement_type: "RESERVED_TO_UNRESTRICTED",
          line_so_no: lineSoNo,
          doc_line_id: docLineId,
          itemData: filterItemData(itemData),
        });
      }

      return { recordsToUpdate, recordsToCreate, inventoryMovements };
    }

    // quantity > totalAllocatedQty - need to deliver all allocated + get more
    for (const allocatedRecord of matchedAllocatedRecords) {
      const isFromPP = allocatedRecord.doc_type === "Picking Plan";
      recordsToUpdate.push({
        ...allocatedRecord,
        open_qty: 0,
        delivered_qty: roundQty((allocatedRecord.delivered_qty || 0) + allocatedRecord.open_qty),
        status: "Delivered",
        doc_id: isFromPP ? docId : allocatedRecord.doc_id,
        doc_no: isFromPP ? docNo : allocatedRecord.doc_no,
        doc_line_id: isFromPP ? docLineId : allocatedRecord.doc_line_id,
        doc_type: isFromPP ? "Good Delivery" : allocatedRecord.doc_type,
        target_gd_id: isFromPP ? docId : allocatedRecord.target_gd_id,
      });
    }
    reservedQtyToSubtract = totalAllocatedQty;

    // Allocate additional from pending
    let additionalQtyNeeded = roundQty(quantity - totalAllocatedQty);
    const pendingProdData = relevantPendingData.filter((item) => {
      if (item.doc_type !== "Production") return false;
      if (parentLineId) {
        return String(item.parent_line_id) === String(parentLineId);
      }
      return true;
    });
    const pendingSOData = relevantPendingData.filter((item) => {
      if (item.doc_type !== "Sales Order") return false;
      if (parentLineId) {
        return String(item.parent_line_id) === String(parentLineId);
      }
      return true;
    });

    if (pendingProdData.length > 0 && additionalQtyNeeded > 0) {
      const prodRecord = pendingProdData[0];
      const availableQty = getPendingAvailableQty(prodRecord);
      if (availableQty > 0) {
        const deliverQty = Math.min(availableQty, additionalQtyNeeded);
        const isFirstConsumer = (pendingConsumed.get(prodRecord.id) || 0) === 0;
        markPendingConsumed(prodRecord.id, deliverQty);

        if (isFirstConsumer) {
          recordsToUpdate.push({
            ...prodRecord,
            reserved_qty: deliverQty,
            open_qty: 0,
            delivered_qty: deliverQty,
            doc_id: docId,
            doc_no: docNo,
            doc_line_id: docLineId,
            handling_unit_id: params.handlingUnitId || null,
            status: "Delivered",
            target_gd_id: docId,
          });
        } else {
          const { _id, id, ...prodWithoutId } = prodRecord;
          recordsToCreate.push({
            ...prodWithoutId,
            reserved_qty: deliverQty,
            open_qty: 0,
            delivered_qty: deliverQty,
            doc_id: docId,
            doc_no: docNo,
            doc_line_id: docLineId,
            handling_unit_id: params.handlingUnitId || null,
            status: "Delivered",
            source_reserved_id: prodRecord.source_reserved_id || prodRecord.id,
            target_gd_id: docId,
          });
        }
        reservedQtyToSubtract = roundQty(reservedQtyToSubtract + deliverQty);
        additionalQtyNeeded = roundQty(additionalQtyNeeded - deliverQty);
      }
    }

    if (pendingSOData.length > 0 && additionalQtyNeeded > 0) {
      const soRecord = pendingSOData[0];
      const availableQty = getPendingAvailableQty(soRecord);
      if (availableQty > 0) {
        const deliverQty = Math.min(availableQty, additionalQtyNeeded);
        const isFirstConsumer = (pendingConsumed.get(soRecord.id) || 0) === 0;
        markPendingConsumed(soRecord.id, deliverQty);

        if (isFirstConsumer) {
          recordsToUpdate.push({
            ...soRecord,
            reserved_qty: deliverQty,
            open_qty: 0,
            delivered_qty: deliverQty,
            doc_id: docId,
            doc_no: docNo,
            doc_line_id: docLineId,
            handling_unit_id: params.handlingUnitId || null,
            status: "Delivered",
            target_gd_id: docId,
          });
        } else {
          const { _id, id, ...soWithoutId } = soRecord;
          recordsToCreate.push({
            ...soWithoutId,
            reserved_qty: deliverQty,
            open_qty: 0,
            delivered_qty: deliverQty,
            doc_id: docId,
            doc_no: docNo,
            doc_line_id: docLineId,
            handling_unit_id: params.handlingUnitId || null,
            status: "Delivered",
            source_reserved_id: soRecord.source_reserved_id || soRecord.id,
            target_gd_id: docId,
          });
        }
        reservedQtyToSubtract = roundQty(reservedQtyToSubtract + deliverQty);
        additionalQtyNeeded = roundQty(additionalQtyNeeded - deliverQty);
      }
    }

    // Deliver remaining directly from unrestricted (no reserved record needed)
    let unrestrictedQtyToAllocate = 0;
    if (additionalQtyNeeded > 0) {
      unrestrictedQtyToAllocate = additionalQtyNeeded;
    }

    if (reservedQtyToSubtract > 0) {
      inventoryMovements.push({
        material_id: materialId,
        material_code: materialCode,
        material_name: materialName,
        material_uom: materialUom,
        batch_id: batchId,
        bin_location: locationId,
        handling_unit_id: handlingUnitId,
        source: "Reserved",
        quantity: reservedQtyToSubtract,
        operation: "subtract",
        movement_type: "DELIVERY",
        line_so_no: lineSoNo,
        doc_line_id: docLineId,
        itemData: filterItemData(itemData),
      });
    }

    if (unrestrictedQtyToAllocate > 0) {
      inventoryMovements.push({
        material_id: materialId,
        material_code: materialCode,
        material_name: materialName,
        material_uom: materialUom,
        batch_id: batchId,
        bin_location: locationId,
        handling_unit_id: handlingUnitId,
        source: "Unrestricted",
        quantity: unrestrictedQtyToAllocate,
        operation: "subtract",
        movement_type: "DELIVERY",
        line_so_no: lineSoNo,
        doc_line_id: docLineId,
        itemData: filterItemData(itemData),
      });
    }

    return { recordsToUpdate, recordsToCreate, inventoryMovements };
  }

  // No existing allocated records - direct delivery from pending/unrestricted
  const pendingSOData = relevantPendingData.filter((item) => {
    if (item.doc_type !== "Sales Order") return false;
    if (parentLineId) {
      return String(item.parent_line_id) === String(parentLineId);
    }
    return true;
  });
  const pendingProdData = relevantPendingData.filter((item) => {
    if (item.doc_type !== "Production") return false;
    if (parentLineId) {
      return String(item.parent_line_id) === String(parentLineId);
    }
    return true;
  });

  let remainingQtyToDeliver = quantity;
  let reservedQty = 0;

  if (pendingProdData.length > 0 && remainingQtyToDeliver > 0) {
    const prodRecord = pendingProdData[0];
    const availableQty = getPendingAvailableQty(prodRecord);
    if (availableQty > 0) {
      const deliverQty = Math.min(availableQty, remainingQtyToDeliver);
      const isFirstConsumer = (pendingConsumed.get(prodRecord.id) || 0) === 0;
      markPendingConsumed(prodRecord.id, deliverQty);

      if (isFirstConsumer) {
        recordsToUpdate.push({
          ...prodRecord,
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          handling_unit_id: params.handlingUnitId || null,
          status: "Delivered",
          target_gd_id: docId,
        });
      } else {
        const { _id, id, ...prodWithoutId } = prodRecord;
        recordsToCreate.push({
          ...prodWithoutId,
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          handling_unit_id: params.handlingUnitId || null,
          status: "Delivered",
          source_reserved_id: prodRecord.source_reserved_id || prodRecord.id,
          target_gd_id: docId,
        });
      }
      reservedQty = roundQty(reservedQty + deliverQty);
      remainingQtyToDeliver = roundQty(remainingQtyToDeliver - deliverQty);
    }
  }

  if (pendingSOData.length > 0 && remainingQtyToDeliver > 0) {
    const soRecord = pendingSOData[0];
    const availableQty = getPendingAvailableQty(soRecord);
    if (availableQty > 0) {
      const deliverQty = Math.min(availableQty, remainingQtyToDeliver);
      const isFirstConsumer = (pendingConsumed.get(soRecord.id) || 0) === 0;
      markPendingConsumed(soRecord.id, deliverQty);

      if (isFirstConsumer) {
        recordsToUpdate.push({
          ...soRecord,
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          handling_unit_id: params.handlingUnitId || null,
          status: "Delivered",
          target_gd_id: docId,
        });
      } else {
        const { _id, id, ...soWithoutId } = soRecord;
        recordsToCreate.push({
          ...soWithoutId,
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          handling_unit_id: params.handlingUnitId || null,
          status: "Delivered",
          source_reserved_id: soRecord.source_reserved_id || soRecord.id,
          target_gd_id: docId,
        });
      }
      reservedQty = roundQty(reservedQty + deliverQty);
      remainingQtyToDeliver = roundQty(remainingQtyToDeliver - deliverQty);
    }
  }

  // Deliver remaining directly from unrestricted (no reserved record needed)
  let unrestrictedQtyToAllocate = 0;
  if (remainingQtyToDeliver > 0) {
    unrestrictedQtyToAllocate = remainingQtyToDeliver;
  }

  if (reservedQty > 0) {
    inventoryMovements.push({
      material_id: materialId,
      material_code: materialCode,
      material_name: materialName,
      material_uom: materialUom,
      batch_id: batchId,
      bin_location: locationId,
      handling_unit_id: handlingUnitId,
      source: "Reserved",
      quantity: reservedQty,
      operation: "subtract",
      movement_type: "DELIVERY",
      line_so_no: lineSoNo,
      doc_line_id: docLineId,
      itemData: filterItemData(itemData),
    });
  }

  if (unrestrictedQtyToAllocate > 0) {
    inventoryMovements.push({
      material_id: materialId,
      material_code: materialCode,
      material_name: materialName,
      material_uom: materialUom,
      batch_id: batchId,
      bin_location: locationId,
      handling_unit_id: handlingUnitId,
      source: "Unrestricted",
      quantity: unrestrictedQtyToAllocate,
      operation: "subtract",
      movement_type: "DELIVERY",
      line_so_no: lineSoNo,
      doc_line_id: docLineId,
      itemData: filterItemData(itemData),
    });
  }

  return { recordsToUpdate, recordsToCreate, inventoryMovements };
};

// ============ MAIN PROCESSING LOOP ============
// Track how much qty has been consumed from each pending record across groups
// This prevents stale allPendingData from being double-consumed
const pendingConsumed = new Map(); // pendingId -> qty consumed so far

const getPendingAvailableQty = (pendingRecord) => {
  const consumed = pendingConsumed.get(pendingRecord.id) || 0;
  return roundQty(pendingRecord.open_qty - consumed);
};

const markPendingConsumed = (pendingId, qty) => {
  const prev = pendingConsumed.get(pendingId) || 0;
  pendingConsumed.set(pendingId, roundQty(prev + qty));
};

// Collect all results
const allRecordsToUpdate = [];
const allRecordsToCreate = [];
const allInventoryMovements = [];
const allHuUpdates = [];

// Step 0: Detect bin+HU migrations (Packing- or LoadingBay-triggered Created saves).
// Gated because direct user bin edits in temp_qty_data should keep going through
// the release+reallocate path (cleanup RESERVED_TO_UNRESTRICTED + fresh
// UNRESTRICTED_TO_RESERVED): the physical items follow the user's bin change,
// so Unrestricted exists at the new bin and the two-step works.
// Packing and LoadingBay are different — the move is paper-only relative to the
// allocation lineage (Packing keeps items at source while bin/HU changes on paper;
// LoadingBay shifts items to a staging bin via Picking but the same Reserved
// allocation should follow). Both emit a direct Reserved shuttle without the
// Unrestricted intermediate to preserve source_reserved_id and SO/Production chain.
if (saveAs === "Created" && (isPacking === 1 || isLoadingBay === 1)) {
  const migrationResult = detectBinHuMigrations();
  allRecordsToUpdate.push(...migrationResult.recordsToUpdate);
  allRecordsToCreate.push(...migrationResult.recordsToCreate);
  allInventoryMovements.push(...migrationResult.inventoryMovements);
}

// Step 1: Cleanup orphaned allocations (if saveAs !== "Cancelled")
if (saveAs !== "Cancelled") {
  const cleanupResult = cleanupOrphanedAllocations();
  allRecordsToUpdate.push(...cleanupResult.recordsToUpdate);
  allInventoryMovements.push(...cleanupResult.inventoryMovements);
}

// Step 2: Process each table item and its groups
for (const processed of processedTableData) {
  if (processed.skipProcessing) continue;

  const { item, itemData, groupedTempData, groupKeys } = processed;
  const isPP = isGDPP === 1;

  for (const groupKey of groupKeys) {
    const group = groupedTempData[groupKey];
    // Pre-step migrated this group's full qty; skip fresh alloc for it.
    if (group._fullyMigrated) continue;
    const quantity = roundQty(group.totalQty);

    const params = {
      quantity,
      parentId: processed.parent_id,
      parentLineId: processed.parent_line_id,
      docLineId: processed.doc_line_id,
      materialId: processed.material_id,
      itemData,
      batchId: group.batch_id,
      locationId: group.location_id,
      handlingUnitId: group.handling_unit_id || null,
      materialUom: processed.material_uom,
      index: processed.tableIndex,
      remark: processed.remark,
      isPP,
      pickingPlanLineId: processed.picking_plan_line_id,
      linePpId: processed.line_pp_id,
      // Additional fields for inventory movement records
      lineSoNo: processed.line_so_no,
      materialCode: processed.material_code || itemData?.material_code || "",
      materialName: processed.material_name || itemData?.material_name || "",
    };

    let result;
    if (saveAs === "Created") {
      result = processCreatedAllocation(params);
    } else if (saveAs === "Completed") {
      result = processDeliveredAllocation(params);
    } else if (saveAs === "Cancelled") {
      // For cancelled, use release logic (similar to decreasing qty to 0)
      params.quantity = 0;
      result = processCreatedAllocation(params);
    } else {
      continue;
    }

    if (result.recordsToUpdate) {
      allRecordsToUpdate.push(...result.recordsToUpdate);
    }
    if (result.recordsToCreate && result.recordsToCreate.length > 0) {
      allRecordsToCreate.push(...result.recordsToCreate);
    }
    if (result.inventoryMovements) {
      allInventoryMovements.push(...result.inventoryMovements);
    }
    // Collect HU updates for Completed status
    if (saveAs === "Completed" && params.handlingUnitId && quantity > 0) {
      allHuUpdates.push({
        handling_unit_id: params.handlingUnitId,
        material_id: params.materialId,
        batch_id: params.batchId || null,
        deliver_quantity: quantity,
      });
    }
  }

  // Release excess quantities at GD Completed (whole-HU picks where HU qty > GD line need)
  if (saveAs === "Completed") {
    const tempExcessStr = processed.temp_excess_data;
    if (tempExcessStr && tempExcessStr !== "[]" && tempExcessStr.trim() !== "") {
      try {
        const excessData = JSON.parse(tempExcessStr);
        for (const excess of excessData) {
          const excessQty = roundQty(parseFloat(excess.quantity));
          if (excessQty <= 0) continue;

          const excessHandlingUnitId = excess.handling_unit_id || null;
          const excessMaterialId = excess.material_id;
          const excessBatchId = excess.batch_id || null;
          const excessLocationId = excess.location_id;

          // Find the allocated record for this excess (matched by HU + material + batch + location)
          const matchedExcessRecords = allAllocatedData.filter(
            (record) =>
              String(record.material_id) === String(excessMaterialId) &&
              String(record.batch_id || "") === String(excessBatchId || "") &&
              String(record.bin_location || "") === String(excessLocationId || "") &&
              String(record.handling_unit_id || "") === String(excessHandlingUnitId || "") &&
              record.status === "Allocated" &&
              (String(record.target_gd_id) === String(docId) ||
                (isGDPP === 1 && String(record.target_gd_id) === String(processed.line_pp_id)))
          );

          if (matchedExcessRecords.length > 0) {
            // Release excess from existing allocated records
            let remainingExcess = excessQty;
            for (const allocRecord of matchedExcessRecords) {
              if (remainingExcess <= 0) break;
              const releaseFromThis = Math.min(allocRecord.open_qty || 0, remainingExcess);
              if (releaseFromThis <= 0) continue;

              const isFromUnrestricted = allocRecord.doc_type === "Good Delivery" || allocRecord.doc_type === "Picking Plan";

              if (isFromUnrestricted) {
                // Cancel the excess portion - release back to unrestricted
                if (releaseFromThis === (allocRecord.open_qty || 0)) {
                  allRecordsToUpdate.push({
                    ...allocRecord,
                    open_qty: 0,
                    status: "Cancelled",
                    target_gd_id: null,
                  });
                } else {
                  allRecordsToUpdate.push({
                    ...allocRecord,
                    reserved_qty: roundQty(allocRecord.reserved_qty - releaseFromThis),
                    open_qty: roundQty((allocRecord.open_qty || 0) - releaseFromThis),
                    status: "Allocated",
                  });
                  const { _id, id, ...recordWithoutId } = allocRecord;
                  allRecordsToCreate.push({
                    ...recordWithoutId,
                    reserved_qty: releaseFromThis,
                    open_qty: 0,
                    status: "Cancelled",
                    source_reserved_id: allocRecord.id,
                    target_gd_id: null,
                  });
                }
              } else {
                // SO/Production: release back to Pending
                const existingPending = allPendingData.find(
                  (record) =>
                    record.status === "Pending" &&
                    record.doc_type === allocRecord.doc_type &&
                    String(record.parent_line_id) === String(allocRecord.parent_line_id) &&
                    String(record.material_id) === String(excessMaterialId) &&
                    String(record.batch_id || "") === String(excessBatchId || "") &&
                    String(record.bin_location || "") === String(excessLocationId || "")
                );

                if (releaseFromThis === (allocRecord.open_qty || 0)) {
                  if (existingPending) {
                    allRecordsToUpdate.push({
                      ...existingPending,
                      reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThis),
                      open_qty: roundQty(existingPending.open_qty + releaseFromThis),
                      status: "Pending",
                    });
                    allRecordsToUpdate.push({
                      ...allocRecord,
                      open_qty: 0,
                      status: "Cancelled",
                      target_gd_id: null,
                    });
                  } else {
                    allRecordsToUpdate.push({
                      ...allocRecord,
                      doc_id: "",
                      doc_no: "",
                      doc_line_id: "",
                      status: "Pending",
                      target_gd_id: null,
                    });
                  }
                } else {
                  allRecordsToUpdate.push({
                    ...allocRecord,
                    reserved_qty: roundQty(allocRecord.reserved_qty - releaseFromThis),
                    open_qty: roundQty((allocRecord.open_qty || 0) - releaseFromThis),
                    status: "Allocated",
                  });
                  if (existingPending) {
                    allRecordsToUpdate.push({
                      ...existingPending,
                      reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThis),
                      open_qty: roundQty(existingPending.open_qty + releaseFromThis),
                      status: "Pending",
                    });
                  } else {
                    const { _id, id, ...recordWithoutId } = allocRecord;
                    allRecordsToCreate.push({
                      ...recordWithoutId,
                      doc_id: "",
                      doc_no: "",
                      doc_line_id: "",
                      reserved_qty: releaseFromThis,
                      open_qty: releaseFromThis,
                      delivered_qty: 0,
                      status: "Pending",
                      source_reserved_id: allocRecord.source_reserved_id || allocRecord.id,
                      target_gd_id: null,
                    });
                  }
                }
              }

              // Add inventory movement to release excess back to unrestricted
              if (isFromUnrestricted) {
                allInventoryMovements.push({
                  material_id: excessMaterialId,
                  material_code: excess.material_name || "",
                  material_name: excess.material_name || "",
                  material_uom: processed.material_uom,
                  batch_id: excessBatchId,
                  bin_location: excessLocationId,
                  handling_unit_id: excessHandlingUnitId,
                  quantity: releaseFromThis,
                  movement_type: "RESERVED_TO_UNRESTRICTED",
                  line_so_no: processed.line_so_no,
                  doc_line_id: processed.doc_line_id,
                  itemData: filterItemData(itemDataMap[excessMaterialId] || processed.itemData),
                });
              }

              remainingExcess = roundQty(remainingExcess - releaseFromThis);
            }
          } else {
            // No allocated record found - the excess was reserved from unrestricted during Created
            // Create a cancellation record and release back to unrestricted
            const allocDocType = isPP ? "Picking Plan" : "Good Delivery";
            allRecordsToCreate.push({
              doc_type: allocDocType,
              status: "Cancelled",
              source_reserved_id: null,
              parent_id: processed.parent_id,
              parent_line_id: processed.parent_line_id,
              parent_no: processed.line_so_no,
              doc_no: docNo,
              doc_id: docId,
              doc_line_id: processed.doc_line_id,
              material_id: excessMaterialId,
              item_code: excess.material_name || "",
              item_name: excess.material_name || "",
              item_desc: "",
              batch_id: excessBatchId,
              bin_location: excessLocationId,
              handling_unit_id: excessHandlingUnitId,
              item_uom: processed.material_uom,
              reserved_qty: excessQty,
              delivered_qty: 0,
              open_qty: 0,
              reserved_date: docDate,
              line_no: processed.tableIndex,
              plant_id: plantId,
              organization_id: organizationId,
              remark: "Auto-released excess from whole-HU pick",
              target_gd_id: null,
            });

            allInventoryMovements.push({
              material_id: excessMaterialId,
              material_code: excess.material_name || "",
              material_name: excess.material_name || "",
              material_uom: processed.material_uom,
              batch_id: excessBatchId,
              bin_location: excessLocationId,
              handling_unit_id: excessHandlingUnitId,
              quantity: excessQty,
              movement_type: "RESERVED_TO_UNRESTRICTED",
              line_so_no: processed.line_so_no,
              doc_line_id: processed.doc_line_id,
              itemData: filterItemData(itemDataMap[excessMaterialId] || processed.itemData),
            });
          }
        }
      } catch (e) {
        console.error("Error processing excess data for line " + processed.tableIndex + ":", e);
      }
    }
  }
}

// Create remainder records for partially consumed pending records
for (const [pendingId, consumedQty] of pendingConsumed.entries()) {
  const originalPending = allPendingData.find((r) => String(r.id) === String(pendingId));
  if (!originalPending) continue;

  const remainderQty = roundQty(originalPending.open_qty - consumedQty);
  if (remainderQty > 0) {
    const { _id, id, ...withoutId } = originalPending;
    allRecordsToCreate.push({
      ...withoutId,
      doc_id: "",
      doc_no: "",
      doc_line_id: "",
      reserved_qty: remainderQty,
      open_qty: remainderQty,
      delivered_qty: 0,
      status: "Pending",
      source_reserved_id: originalPending.source_reserved_id || originalPending.id,
      target_gd_id: null,
    });
  }
}

// Deduplicate records by ID (keep last update for each ID)
const recordUpdateMap = new Map();
for (const record of allRecordsToUpdate) {
  if (record.id) {
    recordUpdateMap.set(record.id, record);
  }
}
const deduplicatedRecordsToUpdate = Array.from(recordUpdateMap.values());

return {
  code: "200",
  recordsToUpdate: deduplicatedRecordsToUpdate,
  recordsToUpdateLength: deduplicatedRecordsToUpdate.length,
  recordsToCreate: allRecordsToCreate,
  recordsToCreateLength: allRecordsToCreate.length,
  inventoryMovements: allInventoryMovements,
  inventoryMovementsLength: allInventoryMovements.length,
  huUpdates: allHuUpdates,
  huUpdatesLength: allHuUpdates.length,
  message: `Batch processing complete: ${deduplicatedRecordsToUpdate.length} updates, ${allRecordsToCreate.length} creates, ${allInventoryMovements.length} movements, ${allHuUpdates.length} HU updates`
};
