// picking_setup.convert_gd_created = 1 makes a Multiple-GDs conversion save straight to
// Created, server-side, via SOconvertGDCreatedWorkflow (gates for that path -- picking mode,
// shortfall, credit limit -- live in the workflow). A single GD always opens the form for
// review instead, so the flag never applies to it.

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

// GD_SO_CONVERT_CHECK (read-only): the selected sales orders that still have a delivery saving in the background (an
// unfinished GD Created V2 save). A check that cannot run answers none: GD_ASYNC_SUBMIT still refuses such a save.
const SO_CONVERT_CHECK_WORKFLOW_ID = "2112084100104495105";

const checkSavingInBackground = (records) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        SO_CONVERT_CHECK_WORKFLOW_ID,
        { so_ids: records.map((record) => String(record.id)) },
        (res) => {
          let busy = [];
          try {
            busy = JSON.parse((res && res.data && res.data.busy_json) || "[]");
          } catch (error) {
            busy = [];
          }
          resolve(Array.isArray(busy) ? busy : []);
        },
        (err) => {
          console.error("Convert check failed:", err);
          resolve([]);
        },
      );
    } catch (error) {
      console.error("Convert check could not run:", error);
      resolve([]);
    }
  });

// A few sales orders per call: one call for 250 ran 54 minutes, and a single failing
// sales order ended the whole batch.
const CONVERT_BATCH_SIZE = 5;

const runConvertBatch = (soIds, plantID, organizationID, convertType) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        CONVERT_GD_CREATED_WORKFLOW_ID,
        {
          so_ids: soIds,
          gd_type: convertType,
          plant_id: plantID,
          organization_id: organizationID,
          created_by: this.getVarGlobal("nickname"),
        },
        (res) => resolve({ ok: true, result: res?.data || {} }),
        (err) => resolve({ ok: false, error: err }),
      );
    } catch (error) {
      resolve({ ok: false, error });
    }
  });

const handleConvertGDCreated = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
) => {
  // A second click while a batch is still running would convert the same sales orders again.
  if (window.__soConvertGdBusy) {
    await this.$alert(
      "A conversion to Goods Delivery is still running. Wait for it to finish.",
      "Conversion Running",
      { confirmButtonText: "OK", type: "warning" },
    );
    return;
  }
  window.__soConvertGdBusy = true;

  const total = selectedRecords.length;
  const created = [];
  const blocked = [];
  let setupMessage = "";

  try {
    for (let start = 0; start < total; start += CONVERT_BATCH_SIZE) {
      const batch = selectedRecords.slice(start, start + CONVERT_BATCH_SIZE);
      this.hideLoading();
      this.showLoading(
        total > CONVERT_BATCH_SIZE
          ? `Converting to Goods Delivery: ${start} of ${total} sales orders done...`
          : "Converting to Goods Delivery...",
      );

      const reply = await runConvertBatch(
        batch.map((record) => record.id),
        plantID,
        organizationID,
        convertType,
      );

      if (!reply.ok) {
        // The server may still have converted some of these; converting again reports
        // those as having nothing left to deliver.
        for (const record of batch) {
          blocked.push({
            so_no: record.so_no || record.id,
            reason:
              "No answer from the server. Check whether it already has a goods delivery before converting it again.",
          });
        }
        continue;
      }

      const result = reply.result;
      const batchCreated = result.created || [];
      const batchBlocked = result.blocked || [];
      created.push(...batchCreated);
      blocked.push(...batchBlocked);

      // A setup gate (picking setup, picking mode) refuses every batch alike: stop at the first.
      if (
        batchCreated.length === 0 &&
        batchBlocked.length === 0 &&
        String(result.code) !== "200"
      ) {
        setupMessage = result.message || "";
        break;
      }
    }
  } finally {
    this.hideLoading();
    window.__soConvertGdBusy = false;
  }

  // Per-SO reasons first: the server message carries real text only when a setup gate fired.
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
        : setupMessage || "No goods deliveries were created.",
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
};

const handleConvertGD = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
  convertAsCreated,
) => {
  try {
    // One GD means the user gets to look at it: a single document (one SO, or several merged)
    // always opens the form, whatever convert_gd_created says. Only a batch of one-GD-per-SO
    // is worth saving headlessly.
    if (convertAsCreated && convertType === "multiple") {
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
    let selectedRecords = arguments[0].selectedRecords;
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

    // A sales order whose delivery is still saving in the background is not converted again: its remaining quantity only
    // drops once that save finishes, so a second delivery now would deliver it twice
    const saving = await checkSavingInBackground(selectedRecords);
    if (saving.length > 0) {
      const savingIds = new Set(saving.map((item) => String(item.so_id)));
      const savingNos = selectedRecords
        .filter((record) => savingIds.has(String(record.id)))
        .map((record) => escapeHTML(record.so_no || record.id));
      const rest = selectedRecords.filter((record) => !savingIds.has(String(record.id)));
      const intro = `${
        savingNos.length === 1 ? "This sales order has" : "These sales orders have"
      } a goods delivery that is still being saved in the background. Wait until it appears in the Goods Delivery list, then convert again:<br><br>${savingNos.join("<br>")}`;
      if (rest.length === 0) {
        await this.$alert(intro, "Delivery Still Saving", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });
        return;
      }
      try {
        await this.$confirm(
          `${intro}<br><br>Convert the other ${rest.length} sales order${rest.length === 1 ? "" : "s"}?`,
          "Delivery Still Saving",
          {
            confirmButtonText: "Convert the others",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          },
        );
      } catch (error) {
        return;
      }
      selectedRecords = rest;
    }

    if (selectedRecords.length > 1) {
      await this.$confirm(
        `Would you like to convert these into a single goods delivery or into multiple goods deliveries?<br><br>
          <strong>Single GD:</strong> All items combined into one document, opened for review<br>
          <strong>Multiple GDs:</strong> Separate deliveries for better tracking${
            convertAsCreated
              ? `<br><br>Multiple GDs will be saved as <strong>Created</strong> with stock allocated, without opening the form. Any sales order that cannot be covered is reported and left unconverted.`
              : ""
          }`,
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
