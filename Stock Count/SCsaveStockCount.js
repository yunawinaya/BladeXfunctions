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

      const approvedItems = this.models["approvedItems"] || [];

      if (approvedItems.length > 0) {
        data.table_stock_count = [...data.table_stock_count, ...approvedItems];
      }

      // Calculate total_counted: locked items / total items
      const totalItems = data.table_stock_count.length;
      const lockedItems = data.table_stock_count.filter(
        (item) => item.is_counted === 1
      ).length;
      const total_counted = `${lockedItems} / ${totalItems}`;

      // Calculate total_variance: (total variance_qty / total system_qty) * 100
      const totalCountQty = data.table_stock_count.reduce(
        (sum, item) => sum + (parseFloat(item.count_qty) || 0),
        0
      );
      const totalSystemQty = data.table_stock_count.reduce(
        (sum, item) => sum + (parseFloat(item.system_qty) || 0),
        0
      );

      const totalVarianceQty = totalCountQty - totalSystemQty;

      const variancePercentage =
        totalSystemQty > 0
          ? Math.abs(totalVarianceQty / totalSystemQty) * 100
          : 0;
      const total_variance = `${variancePercentage.toFixed(2)}%`;

      const entry = {
        review_status:
          data.review_status === "Recount" ||
          !data.review_status ||
          data.review_status === ""
            ? "To Be Reviewed"
            : data.review_status,
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

      // Check if any item has is_counted = 0 (not locked)
      const hasUnlockedItems = entry.table_stock_count.some(
        (item) => item.is_counted === 0 || !item.is_counted
      );

      // Determine stock count status based on locked state
      if (hasUnlockedItems) {
        const unlockedCount = entry.table_stock_count.filter(
          (item) => item.is_counted === 0 || !item.is_counted
        ).length;

        const result = await this.$confirm(
          `Not all line items are locked. <br><br><strong>${unlockedCount} item(s)</strong> are not locked.<br><br>Stock Count status will be set to <strong>'In Progress'</strong>.<br><br>Do you want to proceed?`,
          "Unlocked Line Items Warning",
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

        entry.stock_count_status = "In Progress";
      } else {
        entry.stock_count_status = "Completed";
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
