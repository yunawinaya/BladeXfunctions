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
    .collection("sales_return_receiving")
    .where({
      srr_no: generatedPrefix,
      organization_id: organizationId,
      is_deleted: 0,
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
      "Could not generate a unique Sales Return Receiving number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  let newPrefix = "";

  if (prefixData.is_active === 1) {
    const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);
    newPrefix = prefixToShow;
  }

  this.setData({ srr_no: newPrefix });
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Sales Return Receiving",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();
  const prefixData = await prefixEntry.data[0];

  if (prefixData.is_active === 0) {
    this.disabled(["srr_no"], false);
  }

  return prefixData;
};

const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
  }
};

const disabledField = async (status) => {
  if (status !== "Draft") {
    this.disabled(
      [
        "contact_person",
        "received_date",
        "fileupload_ed0qx6ga",
        "table_srr",
        "input_y0dr1vke",
        "remarks",
      ],
      true
    );

    this.hide(["button_save_as_draft", "button_completed"]);
  }
};

const setPlant = async (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds");

  if (currentDept === organizationId) {
    this.disabled("plant_id", false);
    this.disabled("table_srr", true);
  } else {
    if (pageStatus === "Add") {
      setTimeout(() => {
        this.setData({ plant_id: currentDept });
      }, 50);
    }
    this.disabled("plant_id", true);
  }
};

const displayManufacturingAndExpiredDate = async (status, pageStatus) => {
  const tableSRR = this.getValue("table_srr");
  if (pageStatus === "Edit") {
    if (status === "Draft") {
      for (const [index, item] of tableSRR.entries()) {
        if (item.batch_no !== "-") {
          await this.display([
            "table_srr.manufacturing_date",
            "table_srr.expired_date",
          ]);
        } else {
          await this.disabled(
            [
              `table_srr.${index}.manufacturing_date`,
              `table_srr.${index}.expired_date`,
            ],
            true
          );
        }
      }
    } else {
      for (const [_index, item] of tableSRR.entries()) {
        if (item.batch_no !== "-") {
          await this.display([
            "table_srr.manufacturing_date",
            "table_srr.expired_date",
          ]);
        }
      }
    }
  } else {
    for (const [_index, item] of tableSRR.entries()) {
      if (item.batch_no !== "-") {
        await this.display([
          "table_srr.manufacturing_date",
          "table_srr.expired_date",
        ]);
      }
    }
  }
};

const editSerialNumbers = async (tableSRR) => {
  for (const [index, item] of tableSRR.entries()) {
    if (
      item.serial_numbers &&
      item.serial_numbers !== "" &&
      item.serial_numbers !== null
    ) {
      await this.display(`table_srr.select_serial_number`);
      await this.disabled(`table_srr.${index}.received_qty`, true);
    } else {
      await this.disabled(`table_srr.${index}.received_qty`, false);
      await this.disabled(`table_srr.${index}.select_serial_number`, true);
    }
  }
};

const viewSerialNumbers = async (tableSRR) => {
  console.log("tableSRR", tableSRR);
  for (const item of tableSRR) {
    if (
      item.serial_numbers &&
      item.serial_numbers !== "" &&
      item.serial_numbers !== null
    ) {
      await this.display(`table_srr.serial_numbers`);
    }
  }
};

(async () => {
  try {
    const status = await this.getValue("srr_status");

    const pageStatus = this.isAdd
      ? "Add"
      : this.isEdit
      ? "Edit"
      : this.isView
      ? "View"
      : this.isCopy
      ? "Clone"
      : (() => {
          this.$message.error("Invalid page status");
        })();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });
    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        this.setData({
          organization_id: organizationId,
          user_id: this.getVarGlobal("nickname"),
          received_date: new Date().toISOString().split("T")[0],
        });
        await setPlant(organizationId, pageStatus);
        await setPrefix(organizationId);
        break;

      case "Edit":
        await getPrefixData(organizationId);
        await disabledField(status);
        await showStatusHTML(status);
        await displayManufacturingAndExpiredDate(status, pageStatus);
        setTimeout(async () => {
          await editSerialNumbers(this.getValue("table_srr"));
        }, 200);

        break;

      case "View":
        this.hide(["button_save_as_draft", "button_completed"]);
        await showStatusHTML(status);
        await displayManufacturingAndExpiredDate(status, pageStatus);
        setTimeout(async () => {
          await viewSerialNumbers(this.getValue("table_srr"));
        }, 200);

        break;
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
