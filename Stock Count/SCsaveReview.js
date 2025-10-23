const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return !value;
  });
  return missingFields;
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Adjustment",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const generateDraftPrefix = async (organizationId) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData.length !== 0) {
      const currDraftNum = parseInt(prefixData.draft_number) + 1;
      const newPrefix = "DRAFT-SA-" + currDraftNum;

      db.collection("prefix_configuration")
        .where({
          document_types: "Stock Adjustment",
          organization_id: organizationId,
          is_deleted: 0,
        })
        .update({ draft_number: currDraftNum });

      return newPrefix;
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const createDraftStockAdjustment = async (
  entry,
  organizationId,
  stockCountId
) => {
  try {
    // Filter items with variance (variance_qty !== 0)
    const itemsWithVariance = entry.table_stock_count.filter(
      (item) => item.variance_qty !== 0 && item.line_status === "Approved"
    );

    if (itemsWithVariance.length === 0) {
      console.log("No items with variance - no stock adjustment needed");
      return;
    }

    // Group items by material_id
    const groupedByMaterial = {};

    for (const item of itemsWithVariance) {
      if (!groupedByMaterial[item.material_id]) {
        groupedByMaterial[item.material_id] = [];
      }
      groupedByMaterial[item.material_id].push(item);
    }

    // Create stock adjustment table entries
    const stockAdjustmentTable = [];

    for (const materialId in groupedByMaterial) {
      const items = groupedByMaterial[materialId];
      const firstItem = items[0];

      // Fetch item balance data for each item
      const balanceIndex = [];
      let totalQuantity = 0;
      const adjSummaryDetails = [];

      for (const item of items) {
        // Fetch the item balance record
        // Use item_batch_balance for batched items, item_balance for non-batched
        const collectionName = item.batch_id
          ? "item_batch_balance"
          : "item_balance";

        const itemBalanceQuery = db.collection(collectionName).where({
          material_id: item.material_id,
          plant_id: item.plant_id,
          location_id: item.location_id,
          is_deleted: 0,
        });

        // Add batch filter for batched items
        if (item.batch_id) {
          itemBalanceQuery.where({ batch_id: item.batch_id });
        }

        const itemBalanceResult = await itemBalanceQuery.get();

        if (itemBalanceResult.data && itemBalanceResult.data.length > 0) {
          const balanceData = itemBalanceResult.data[0];

          // Determine movement type based on variance
          const movementType = item.variance_qty > 0 ? "In" : "Out";
          const saQuantity = Math.abs(item.variance_qty);

          totalQuantity += saQuantity;

          // Create balance index entry
          const balanceIndexEntry = {
            balance_id: balanceData.id,
            material_id: balanceData.material_id,
            plant_id: balanceData.plant_id,
            location_id: balanceData.location_id,
            batch_id: balanceData.batch_id || null,
            balance_quantity: balanceData.balance_quantity,
            unrestricted_qty: balanceData.unrestricted_qty,
            block_qty: balanceData.block_qty,
            qualityinsp_qty: balanceData.qualityinsp_qty,
            reserved_qty: balanceData.reserved_qty,
            intransit_qty: balanceData.intransit_qty,
            organization_id: balanceData.organization_id,
            tenant_id: balanceData.tenant_id,
            create_user: balanceData.create_user,
            create_time: balanceData.create_time,
            create_dept: balanceData.create_dept,
            update_user: balanceData.update_user,
            update_time: balanceData.update_time,
            is_deleted: balanceData.is_deleted,
            category: "Unrestricted",
            movement_type: movementType,
            sa_quantity: saQuantity,
          };

          balanceIndex.push(balanceIndexEntry);

          // Get location name
          const locationResult = await db
            .collection("bin_location")
            .where({ id: item.location_id })
            .get();
          const locationName =
            locationResult.data?.[0]?.bin_location_combine || item.location_id;

          // Get UOM name
          const uomResult = await db
            .collection("unit_of_measurement")
            .where({ id: item.uom_id })
            .get();
          const uomName = uomResult.data?.[0]?.uom_name || "";

          // Get batch name if exists
          let batchName = "";
          if (item.batch_id) {
            const batchResult = await db
              .collection("batch")
              .where({ id: item.batch_id })
              .get();
            batchName = batchResult.data?.[0]?.batch_number || "";
          }

          // Build adjustment summary detail
          const categoryAbbr = "UNR"; // Unrestricted
          const movementTypeLabel = movementType === "In" ? "IN" : "OUT";
          let detailLine = `${locationName}: ${saQuantity} ${uomName} (${categoryAbbr}) - ${movementTypeLabel}`;
          if (batchName) {
            detailLine += `\n[${batchName}]`;
          }
          adjSummaryDetails.push(detailLine);
        }
      }

      // Get UOM name for summary
      const uomResult = await db
        .collection("unit_of_measurement")
        .where({ id: firstItem.uom_id })
        .get();
      const uomName = uomResult.data?.[0]?.uom_name || "";

      // Build adjustment summary
      const adjSummary = `Total: ${totalQuantity} ${uomName}\nDETAILS:\n${adjSummaryDetails
        .map((detail, idx) => `${idx + 1}. ${detail}`)
        .join("\n")}`;

      // Get material name
      const materialResult = await db
        .collection("Item")
        .where({ id: materialId })
        .get();
      const materialName = materialResult.data?.[0]?.material_code || "";

      // Create stock adjustment entry
      stockAdjustmentTable.push({
        material_id: materialId,
        uom_id: firstItem.uom_id,
        material_name: materialName,
        item_category: firstItem.item_category,
        is_serialized_item: firstItem.is_serialized || 0,
        is_single_serial: firstItem.is_single || 0,
        total_quantity: totalQuantity,
        balance_index: JSON.stringify(balanceIndex),
        adj_summary: adjSummary,
      });
    }

    // Generate draft prefix
    const newPrefix = await generateDraftPrefix(organizationId);

    // Create stock adjustment document
    const stockAdjustmentDoc = {
      stock_adjustment_status: "Draft",
      organization_id: organizationId,
      adjustment_no: newPrefix,
      stock_count_id: stockCountId,
      adjustment_date: new Date().toISOString().split("T")[0],
      adjustment_type: "Stock Count",
      adjusted_by: this.getVarGlobal("nickname"),
      plant_id: entry.plant_id,
      adjustment_remarks: entry.stock_count_remark || "",
      adjustment_remarks2: entry.stock_count_remark2 || "",
      adjustment_remarks3: entry.stock_count_remark3 || "",
      stock_adjustment: stockAdjustmentTable,
    };

    // Save to database
    const stockAdjustmentResult = await db
      .collection("stock_adjustment")
      .add(stockAdjustmentDoc);

    console.log("Stock Adjustment Created:", stockAdjustmentDoc);
    this.$message.success(
      `Draft Stock Adjustment created: ${newPrefix} with ${stockAdjustmentTable.length} item(s)`
    );

    return stockAdjustmentResult.data[0];
  } catch (error) {
    console.error("Error creating stock adjustment:", error);
    this.$message.error("Failed to create stock adjustment");
  }
};

const updateEntry = async (entry, stockCountId) => {
  try {
    await db.collection("stock_count").doc(stockCountId).update(entry);
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

(async () => {
  try {
    this.showLoading();
    let data = this.getValues();
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "count_type", label: "Count Type" },
    ];

    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const stockCountId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      // Filter out canceled items
      data.table_stock_count = data.table_stock_count.filter(
        (item) => item.line_status !== "Cancel"
      );

      // Calculate total_counted: locked items / total items
      const totalItems = data.table_stock_count.length;
      const lockedItems = data.table_stock_count.filter(
        (item) => item.is_counted === 1
      ).length;
      const total_counted = `${lockedItems} / ${totalItems}`;

      // Calculate total_variance: (total count_qty / total system_qty) * 100
      const totalCountQty = data.table_stock_count.reduce(
        (sum, item) => sum + (parseFloat(item.count_qty) || 0),
        0
      );
      const totalSystemQty = data.table_stock_count.reduce(
        (sum, item) => sum + (parseFloat(item.system_qty) || 0),
        0
      );
      const variancePercentage =
        totalSystemQty > 0 ? (totalCountQty / totalSystemQty) * 100 : 0;
      const total_variance = `${variancePercentage.toFixed(2)}%`;

      const entry = {
        review_status: "Completed",
        stock_count_status: data.stock_count_status,
        adjustment_status: data.adjustment_status,
        plant_id: data.plant_id,
        organization_id: organizationId,
        count_method: data.count_method,
        count_type: data.count_type,
        item_list: data.item_list,
        start_date: data.start_date,
        end_date: data.end_date,
        assignees: data.assignees,
        user_assignees: data.user_assignees,
        work_group_assignees: data.work_group_assignees,
        blind_count: data.blind_count,
        total_counted: total_counted,
        total_variance: total_variance,
        table_stock_count: data.table_stock_count,
        stock_count_remark: data.stock_count_remark,
        stock_count_remark2: data.stock_count_remark2,
        stock_count_remark3: data.stock_count_remark3,
      };

      if (!entry.table_stock_count || entry.table_stock_count.length === 0) {
        this.$message.error("No stock count items found");
        this.hideLoading();
        return;
      }

      // Check again after filtering cancelled items
      if (entry.table_stock_count.length === 0) {
        this.$message.error(
          "No valid stock count items (all items are cancelled)"
        );
        this.hideLoading();
        return;
      }

      // Check if any item has line_status = Recount
      const hasRecountItems = entry.table_stock_count.some(
        (item) => item.line_status === "Recount"
      );

      // Check if all items are approved or adjusted (considered completed)
      const allApproved = entry.table_stock_count.every(
        (item) => item.line_status === "Approved" || item.line_status === "Adjusted"
      );

      // Determine review status based on item statuses
      if (hasRecountItems) {
        const recountCount = entry.table_stock_count.filter(
          (item) => item.line_status === "Recount"
        ).length;

        const result = await this.$confirm(
          `There are <strong>${recountCount} item(s)</strong> that need to be recounted.<br><br>Review status will be set to <strong>'Recount'</strong>.<br><br>Do you want to proceed?`,
          "Recount Items Warning",
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {
          this.hideLoading();
          return null;
        });

        if (result !== "confirm") {
          return;
        }

        entry.review_status = "Recount";
        entry.stock_count_status = "In Progress";
      } else if (allApproved) {
        // All items are approved - review is complete
        entry.review_status = "Completed";
        entry.stock_count_status = "Completed";
      } else {
        // Some items are not approved/adjusted and not recount
        const pendingCount = entry.table_stock_count.filter(
          (item) =>
            item.line_status !== "Approved" &&
            item.line_status !== "Adjusted" &&
            item.line_status !== "Recount"
        ).length;

        const result = await this.$confirm(
          `There are <strong>${pendingCount} item(s)</strong> that are not approved.<br><br>Review status will be set to <strong>'In Review'</strong>.<br><br>Do you want to proceed?`,
          "Pending Items Warning",
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {
          this.hideLoading();
          return null;
        });

        if (result !== "confirm") {
          return;
        }

        entry.review_status = "In Review";
      }

      // Check if there are approved items that can be adjusted
      const approvedItems = entry.table_stock_count.filter(
        (item) =>
          item.review_status === "Approved" && item.line_status !== "Adjusted"
      );

      // Only show confirmation for partial adjustments (not fully approved)
      if (approvedItems.length > 0 && !allApproved) {
        const adjustResult = await this.$confirm(
          `There are <strong>${approvedItems.length} approved item(s)</strong> ready for adjustment.<br><br>Do you want to create Stock Adjustment and mark them as 'Adjusted'?`,
          "Create Stock Adjustment",
          {
            confirmButtonText: "Yes, Create Adjustment",
            cancelButtonText: "No, Skip",
            type: "info",
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {
          return null;
        });

        if (adjustResult === "confirm") {
          // Create stock adjustment for approved items only
          const approvedEntry = {
            ...entry,
            table_stock_count: approvedItems,
          };

          const stockAdjustmentResult = await createDraftStockAdjustment(
            approvedEntry,
            organizationId,
            stockCountId
          );

          console.log("stockAdjustmentResult", stockAdjustmentResult);
          console.log("stockAdjustmentId", stockAdjustmentResult.id);

          this.triggerEvent("SCtriggerSAcompleted", {
            data: stockAdjustmentResult,
            stockAdjustmentId: stockAdjustmentResult.id,
          });

          // Mark approved items as "Adjusted"
          entry.table_stock_count = entry.table_stock_count.map((item) => {
            if (
              item.review_status === "Approved" &&
              item.line_status !== "Adjusted"
            ) {
              return {
                ...item,
                line_status: "Adjusted",
              };
            }
            return item;
          });

          // Check if all items are now adjusted
          const allAdjusted = entry.table_stock_count.every(
            (item) => item.line_status === "Adjusted"
          );

          if (allAdjusted) {
            entry.adjustment_status = "Fully Adjusted";
          } else {
            entry.adjustment_status = "Partially Adjusted";
          }
        }
      } else if (approvedItems.length > 0 && allApproved) {
        // If all items are approved, create stock adjustment automatically without confirmation
        const approvedEntry = {
          ...entry,
          table_stock_count: approvedItems,
        };

        const stockAdjustmentResult = await createDraftStockAdjustment(
          approvedEntry,
          organizationId,
          stockCountId
        );

        console.log("stockAdjustmentResult", stockAdjustmentResult);
        console.log("stockAdjustmentId", stockAdjustmentResult.id);

        this.triggerEvent("SCtriggerSAcompleted", {
          data: stockAdjustmentResult,
          stockAdjustmentId: stockAdjustmentResult.id,
        });

        // Mark all items as "Adjusted"
        entry.table_stock_count = entry.table_stock_count.map((item) => {
          if (
            item.review_status === "Approved" &&
            item.line_status !== "Adjusted"
          ) {
            return {
              ...item,
              line_status: "Adjusted",
            };
          }
          return item;
        });

        entry.adjustment_status = "Fully Adjusted";
      }

      await updateEntry(entry, stockCountId);

      closeDialog();
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
