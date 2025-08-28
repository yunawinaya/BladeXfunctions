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
    .collection("basic_inspection_lot")
    .where({
      inspection_lot_no: generatedPrefix,
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
      "Could not generate a unique Inspection Lot number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);

  this.setData({ inspection_lot_no: prefixToShow });
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Receiving Inspection",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();
  const prefixData = await prefixEntry.data[0];

  if (prefixData.is_active === 0) {
    this.disabled(["inspection_lot_no"], false);
  }

  return prefixData;
};

const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
  }
};

const isViewMode = async () => {
  this.hide(["button_save_as_draft", "button_completed"]);
};

const disabledEditField = async (status) => {
  if (status === "Completed") {
    this.disabled(
      [
        "plant_id",
        "goods_receiving_no",
        "insp_lot_created_on",
        "insp_start_time",
        "insp_end_time",
        "table_insp_mat",
        "remarks",
        "ref_doc",
      ],
      true
    );

    this.hide(["button_save_as_draft", "button_completed"]);
  } else {
    this.disabled(
      ["plant_id", "goods_receiving_no", "insp_lot_created_on"],
      true
    );

    if (status === "Created") {
      this.hide(["button_save_as_draft"]);
    }
  }
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";

  if (deptId === organizationId) {
    const resPlant = await db
      .collection("blade_dept")
      .where({ parent_id: deptId })
      .get();

    if (!resPlant && resPlant.data.length === 0) {
      plantId = deptId;
    } else {
      plantId = "";
    }
  } else {
    plantId = deptId;
  }

  this.setData({
    organization_id: organizationId,
    plant_id: plantId,
    insp_lot_created_on: new Date().toISOString().split("T")[0],
    lot_created_by: this.getVarGlobal("nickname"),
  });
};

const displayBatchField = async () => {
  const data = this.getValues();
  const tableInspMat = data.table_insp_mat;

  for (const mat of tableInspMat) {
    if (mat.batch_id === "-") {
      this.hide("table_insp_mat.batch_id");
    } else {
      this.display("table_insp_mat.batch_id");
    }
  }
};

const displaySerialField = async () => {
  const tableInspMat = this.getValue("table_insp_mat");

  for (const [index, mat] of tableInspMat.entries()) {
    if (mat.is_serialized_item === 1) {
      this.display(`table_insp_mat.select_serial_number`);
      this.disabled(`table_insp_mat.${index}.passed_qty`, true);
      this.disabled(`table_insp_mat.${index}.failed_qty`, true);
    } else {
      this.disabled(`table_insp_mat.${index}.select_serial_number`, true);
      this.disabled(`table_insp_mat.${index}.passed_qty`, false);
      this.disabled(`table_insp_mat.${index}.failed_qty`, false);
    }
  }
};

(async () => {
  try {
    const status = await this.getValue("receiving_insp_status");

    const pageStatus = this.isAdd
      ? "Add"
      : this.isEdit
      ? "Edit"
      : this.isView
      ? "View"
      : (() => {
          throw new Error("Invalid page status");
        })();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        await setPlant(organizationId);
        await setPrefix(organizationId);
        break;

      case "Edit":
        await getPrefixData(organizationId);
        await disabledEditField(status);
        await showStatusHTML(status);
        await displayBatchField();
        await displaySerialField();
        break;

      case "View":
        await showStatusHTML(status);
        await isViewMode();
        break;
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
