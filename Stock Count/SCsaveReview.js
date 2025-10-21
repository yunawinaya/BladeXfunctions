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

const updateEntry = async (entry, stockCountId) => {
  try {
    await db.collection("stock_count").doc(stockCountId).update(entry);

    this.$message.success("Update successfully");
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

      // Check if all items are approved
      const allApproved = entry.table_stock_count.every(
        (item) => item.line_status === "Approved"
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
        // Some items are not approved and not recount
        const pendingCount = entry.table_stock_count.filter(
          (item) =>
            item.line_status !== "Approved" && item.line_status !== "Recount"
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
