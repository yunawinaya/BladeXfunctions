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
      true,
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
            true,
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

const checkAccIntegrationType = async (organizationId) => {
  if (organizationId) {
    const resAI = await db
      .collection("accounting_integration")
      .where({ organization_id: organizationId })
      .get();

    if (resAI && resAI.data.length > 0) {
      const aiData = resAI.data[0];
      this.setData({ acc_integration_type: aiData.acc_integration_type });
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
        await checkAccIntegrationType(organizationId);
        break;

      case "Edit":
        this.setData({ previous_status: status });
        await disabledField(status);
        await showStatusHTML(status);
        await checkAccIntegrationType(organizationId);
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

setTimeout(async () => {
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("srr_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("srr_no");
  const { options } = params;

  const optionsData = this.getOptionData("srr_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("srr_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        srr_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ srr_no_type: defaultData.value });
    }
  }
}, 200);
