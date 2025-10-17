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
      document_types: "Stock Count",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Stock Count",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
  } catch (error) {
    this.$message.error(error);
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  let generated = prefixData.current_prefix_config;
  generated = generated.replace("prefix", prefixData.prefix_value);
  generated = generated.replace("suffix", prefixData.suffix_value);
  generated = generated.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0")
  );
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(runNumber).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("stock_count")
    .where({
      stock_count_no: generatedPrefix,
      organization_id: organizationId,
    })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Stock Count number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.stock_count_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        entry.stock_count_no,
        organizationId
      );
      if (!isUnique) {
        throw new Error(
          `Stock Count Number "${entry.stock_count_no}" already exists. Please use a different number.`
        );
      }
    }

    console.log(this.getValue("stock_count_status"));
    await db.collection("stock_count").add(entry);
    this.$message.success("Add successfully");
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, stockCountId) => {
  try {
    const currentStockCountStatus = await this.getValue("stock_count_status");

    if (!currentStockCountStatus || currentStockCountStatus !== "Issued") {
      const prefixData = await getPrefixData(organizationId);

      if (prefixData !== null) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId
        );

        await updatePrefix(organizationId, runningNumber);

        entry.stock_count_no = prefixToShow;
      } else {
        const isUnique = await checkUniqueness(
          entry.stock_count_no,
          organizationId
        );
        if (!isUnique) {
          throw new Error(
            `Stock Count Number "${entry.stock_count_no}" already exists. Please use a different number.`
          );
        }
      }
    }

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
    const data = this.getValues();
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "count_type", label: "Count Type" },
    ];

    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;
      const stockCountId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const entry = {
        stock_count_status: "Issued",
        review_status: data.review_status,
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
        total_counted: data.total_counted,
        total_variance: data.total_variance,
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

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        await updateEntry(organizationId, entry, stockCountId);
      }
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
