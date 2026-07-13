// picking_setup.convert_gd_created: 0 = Draft GDs (a single one opens the form),
// 1 = Created GDs, saved server-side by SOconvertGDCreatedWorkflow. Gates for the Created
// path (picking mode, shortfall, credit limit) live in that workflow.

const CONVERT_GD_CREATED_WORKFLOW_ID = "2076557490389835777";
const CONVERT_GD_DRAFT_WORKFLOW_ID = "1985267806223810561";

// Org-scoped like GDheadWorkflow: a plant-scoped read is empty for plants with no row of
// their own, which would read as "no picking setup".
const checkPickingSetup = async (organizationID) => {
  try {
    const resPickingSetup = await db
      .collection("picking_setup")
      .where({ organization_id: organizationID })
      .get();

    return resPickingSetup;
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
};

const escapeHTML = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const handleConvertGDDraft = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
) => {
  this.showLoading("Converting...");
  await this.runWorkflow(
    CONVERT_GD_DRAFT_WORKFLOW_ID,
    {
      gd_type: convertType,
      so_ids: selectedRecords.map((record) => record.id),
      plant_id: plantID,
      organization_id: organizationID,
    },
    async (res) => {
      console.log("Mapped GD Data", res.data);
      const mappedData = res.data.data;

      if (convertType === "single") {
        this.hideLoading();
        await this.toView({
          target: "1902054888473481218",
          type: "add",
          data: {
            ...mappedData[0],
          },
          params: {
            allItems: mappedData[0].all_item,
          },
          position: "rtl",
          mode: "dialog",
          width: "80%",
          title: "Add",
        });
      } else if (convertType === "multiple") {
        this.hideLoading();
        await this.refresh();
        await this.$alert(
          `Successfully created ${
            mappedData.length
          } draft goods deliveries.<br><br>
    <strong>Goods Delivery Numbers:</strong><br> ${mappedData
      .map((item) => item.delivery_no)
      .join("<br>")}`,
          "Success Converted to Goods Deliveries",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "success",
          },
        );
      }
    },
    async (err) => {
      this.hideLoading();
      this.$alert(err, "Error", {
        confirmButtonText: "OK",
        type: "error",
        dangerouslyUseHTMLString: true,
      });
    },
  );
};

const buildCreatedSummary = (created, blocked) => {
  const sections = [];

  if (created.length > 0) {
    sections.push(
      `<strong>Created ${created.length} goods deliver${
        created.length === 1 ? "y" : "ies"
      }:</strong><br>${created
        .map(
          (item) =>
            `${escapeHTML(item.delivery_no)} <span style="color:#909399">(${escapeHTML(
              item.so_no,
            )})</span>`,
        )
        .join("<br>")}`,
    );
  }

  if (blocked.length > 0) {
    sections.push(
      `<strong>Not converted (${blocked.length}):</strong><br>${blocked
        .map((item) => `${escapeHTML(item.so_no)} — ${escapeHTML(item.reason)}`)
        .join("<br>")}`,
    );
  }

  return sections.join("<br><br>");
};

const handleConvertGDCreated = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
) => {
  this.showLoading("Converting to Goods Delivery...");

  await this.runWorkflow(
    CONVERT_GD_CREATED_WORKFLOW_ID,
    {
      so_ids: selectedRecords.map((record) => record.id),
      gd_type: convertType,
      plant_id: plantID,
      organization_id: organizationID,
      created_by: this.getVarGlobal("nickname"),
    },
    async (res) => {
      this.hideLoading();

      const result = res?.data || {};
      const created = result.created || [];
      const blocked = result.blocked || [];

      // Per-SO reasons first: result.message is only a count when the loop ran, and carries
      // the real text only when a setup gate fired before it.
      if (created.length === 0) {
        await this.$alert(
          blocked.length > 0
            ? blocked
                .map(
                  (item) =>
                    `<strong>${escapeHTML(item.so_no)}</strong><br>${escapeHTML(
                      item.reason,
                    )}`,
                )
                .join("<br><br>")
            : result.message || "No goods deliveries were created.",
          "Could Not Convert to Goods Delivery",
          {
            confirmButtonText: "OK",
            type: "error",
            dangerouslyUseHTMLString: true,
          },
        );
        return;
      }

      await this.refresh();
      await this.$alert(
        buildCreatedSummary(created, blocked),
        blocked.length > 0
          ? "Converted with Exceptions"
          : "Converted to Goods Deliveries",
        {
          confirmButtonText: "OK",
          type: blocked.length > 0 ? "warning" : "success",
          dangerouslyUseHTMLString: true,
        },
      );
    },
    async (err) => {
      this.hideLoading();
      this.$alert(err, "Error", {
        confirmButtonText: "OK",
        type: "error",
        dangerouslyUseHTMLString: true,
      });
    },
  );
};

const handleConvertGD = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
  convertAsCreated,
) => {
  try {
    if (convertAsCreated) {
      await handleConvertGDCreated(
        selectedRecords,
        plantID,
        organizationID,
        convertType,
      );
      return;
    }

    await handleConvertGDDraft(
      selectedRecords,
      plantID,
      organizationID,
      convertType,
    );
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
};

(async () => {
  try {
    const selectedRecords = arguments[0].selectedRecords;
    const plantID = arguments[0].plantID;
    const organizationID = arguments[0].organizationID;

    console.log("handleConvertGD selectedRecords:", selectedRecords);

    const resPickingSetup = await checkPickingSetup(organizationID);

    // return if picking setup is not found or SO -> Picking -> GD
    if (!resPickingSetup || resPickingSetup.data.length === 0) {
      await this.$alert(
        "Cannot convert to Goods Delivery. Please check your picking setup.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        },
      );

      throw new Error(
        "Cannot convert to Goods Delivery. Please check your picking setup.",
      );
    }

    const pickingSetup = resPickingSetup.data[0];

    if (
      pickingSetup.picking_required === 1 &&
      pickingSetup.picking_after === "Sales Order"
    ) {
      await this.$alert(
        "Cannot convert to Goods Delivery after Sales Order. Please check your picking setup.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        },
      );
      throw new Error(
        "Cannot convert to Goods Delivery after Sales Order. Please check your picking setup.",
      );
    }

    const convertAsCreated = Number(pickingSetup.convert_gd_created) === 1;

    if (selectedRecords.length > 1) {
      await this.$confirm(
        `Would you like to convert these into a single goods delivery or into multiple goods deliveries?<br><br>
          <strong>Single GD:</strong> All items combined into one document<br>
          <strong>Multiple GDs:</strong> Separate deliveries for better tracking`,
        "Sales Order Conversion",
        {
          confirmButtonText: "Single GD",
          cancelButtonText: "Multiple GDs",
          dangerouslyUseHTMLString: true,
          type: "info",
          distinguishCancelAndClose: true,

          beforeClose: async (action, instance, done) => {
            // handle single GD
            if (action === "confirm") {
              const uniqueCustomers = new Set(
                selectedRecords.map((record) => record.customer_name.id),
              );

              const allSameCustomer = uniqueCustomers.size === 1;

              if (!allSameCustomer) {
                await this.$confirm(
                  `Selected SOs contain multiple customers. Create individual goods deliveries - one GD per SO?`,
                  "Multiple Customers Detected",
                  {
                    confirmButtonText: "Proceed",
                    cancelButtonText: "Cancel",
                    dangerouslyUseHTMLString: true,
                    type: "info",
                  },
                ).catch(() => {
                  console.log("User clicked Cancel or closed the dialog");
                  throw new Error();
                });

                await handleConvertGD(
                  selectedRecords,
                  plantID,
                  organizationID,
                  "multiple",
                  convertAsCreated,
                );
                return;
              } else {
                await handleConvertGD(
                  selectedRecords,
                  plantID,
                  organizationID,
                  "single",
                  convertAsCreated,
                );
              }
              done();
            } else if (action === "cancel") {
              // handle multiple GD
              await handleConvertGD(
                selectedRecords,
                plantID,
                organizationID,
                "multiple",
                convertAsCreated,
              );
              done();
            } else {
              done();
            }
          },
        },
      );
    } else {
      await handleConvertGD(
        selectedRecords,
        plantID,
        organizationID,
        "single",
        convertAsCreated,
      );
    }
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
})();
