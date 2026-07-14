// autoPi: "" (not decided yet) | "confirmed" | "skip". Once decided it is threaded through the
// 401/403 retries below so the user is never asked the same question twice.
const handleConvertSI = async (
  selectedRecords,
  convertTo,
  isMultiple,
  filterDraft,
  autoPi,
) => {
  const gdIds = [...new Set(selectedRecords.map((r) => r.id))];

  // Internal trading = the GD is the source of a "Linked" GD->GR row in document_linkage.
  // Two separate checks need that fact, so read it once:
  //   - the mix guard, only when building ONE SI out of 2+ GDs
  //   - the Purchase Invoice confirm, only when completing (see below)
  const needsMixGuard = isMultiple === "single" && selectedRecords.length > 1;
  const needsPiAnswer = convertTo === "completed" && !autoPi;

  let internalCount = 0;
  if (needsMixGuard || needsPiAnswer) {
    const linkRes = await db
      .collection("document_linkage")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            {
              prop: "source_doc_type",
              operator: "equal",
              value: "Goods Delivery",
            },
            { prop: "source_doc_id", operator: "in", value: gdIds },
            { prop: "link_status", operator: "equal", value: "Linked" },
          ],
        },
      ])
      .get();

    const internalSet = new Set(
      (linkRes?.data || []).map((r) => r.source_doc_id),
    );
    internalCount = gdIds.filter((id) => internalSet.has(id)).length;
  }

  // Block combining internal-trading and non-internal Goods Deliveries into ONE
  // Sales Invoice. "multiple" gives each GD its own SI, so there is no mix to block.
  if (needsMixGuard && internalCount > 0 && internalCount < gdIds.length) {
    await this.$alert(
      "Cannot combine internal trading and non-internal Goods Deliveries in the same Sales Invoice. Please select only one type, or convert to multiple Sales Invoices.",
      "Error",
      { confirmButtonText: "OK", type: "error" },
    );
    return;
  }

  // SI_SAVE will not write an internal-trading COMPLETED invoice until it is told whether to also
  // create the buyer organization's Purchase Invoice -- it returns pi_confirm 411 and saves
  // nothing. The SI form answers that (SIsaveAsCompleted.js); this path never did, so completing
  // an internal GD silently produced no invoice at all while still reporting success. Ask here and
  // pass the answer through. (Draft never arms the gate, so it is only asked when completing.)
  if (needsPiAnswer) {
    if (internalCount > 0) {
      const proceed = await this.$confirm(
        `${internalCount} of the selected Goods Delivery(s) are linked to internal Purchase Orders.<br><br>Auto-create the Purchase Invoice in the buyer organization?`,
        "Internal Trading – Auto-create Purchase Invoice",
        {
          confirmButtonText: "Yes, create PI",
          cancelButtonText: "No, invoice only",
          type: "info",
          dangerouslyUseHTMLString: true,
        },
      )
        .then(() => true)
        .catch(() => false);

      autoPi = proceed ? "confirmed" : "skip";
    } else {
      // Nothing internal — the gate never arms. Memoised so a retry does not re-query.
      autoPi = "skip";
    }
  }

  this.showLoading("Converting Goods Delivery to Sales Invoice...");
  await this.runWorkflow(
    "2070069049332416514",
    {
      ids: selectedRecords.map((record) => record.id),
      convert_to: convertTo,
      is_multiple: isMultiple,
      filter_draft: filterDraft,
      auto_pi: autoPi || "",
    },
    async (res) => {
      console.log("SI Data", res.data);
      this.$alert(
        "Convert Goods Delivery to Sales Invoice Success",
        "Success",
        {
          confirmButtonText: "OK",
          type: "success",
        },
      );
      this.refresh();
      this.hideLoading();
    },
    async (err) => {
      console.error(err);
      this.hideLoading();
      if (err.data?.code === 401) {
        // Draft SO cannot be converted.
        await this.$confirm(err.data.msg, "GD cannot be converted.", {
          confirmButtonText: "Proceed",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Converting sales invoice cancelled.");
        });

        await handleConvertSI(
          selectedRecords,
          convertTo,
          isMultiple,
          "yes",
          autoPi,
        );
      } else if (err.data?.code === 402) {
        // Selected Goods Delivery(s) already has a related Sales Invoice and cannot be converted.
        await this.$alert(err.data.msg, "Error", {
          confirmButtonText: "OK",
          type: "error",
        });
      } else if (err.data?.code === 403) {
        // All selected Goods Delivery(s) must be from the same plant/organization to create a single Sales Invoice.
        await this.$confirm(err.data.msg, "", {
          confirmButtonText: "Convert to Multiple SI",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Converting sales invoice cancelled.");
        });

        await handleConvertSI(
          selectedRecords,
          convertTo,
          "multiple",
          filterDraft,
          autoPi,
        );
      }
    },
  );
  this.hideLoading();
};

(async () => {
  try {
    const allListID = "custom_ezwb0qqp";
    let selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;
    let convertTo = "";
    let isMultiple = "single";

    if (selectedRecords && selectedRecords.length > 0) {
      await this.$confirm(
        `Would you like to convert these into 'Draft' or 'Completed' sales invoices?<br><br>`,
        "Confirm Conversion",
        {
          confirmButtonText: "Draft SI",
          cancelButtonText: "Completed SI",
          dangerouslyUseHTMLString: true,
          type: "info",
          distinguishCancelAndClose: true,
          beforeClose: async (action, instance, done) => {
            if (action === "confirm") {
              convertTo = "draft";
              done();
            } else if (action === "cancel") {
              convertTo = "completed";
              if (selectedRecords.length > 1) {
                done();
                await this.$confirm(
                  `Would you like to convert these into a single sales invoice or into multiple sales invoices?<br><br>
          <strong>Selected Records:</strong><br> ${selectedRecords
            .map((item) => item.delivery_no)
            .join("<br>")}`,
                  "Confirm Conversion",
                  {
                    confirmButtonText: "Single SI",
                    cancelButtonText: "Multiple SIs",
                    dangerouslyUseHTMLString: true,
                    type: "info",
                    distinguishCancelAndClose: true,
                    beforeClose: async (action, instance, done) => {
                      if (action === "confirm") {
                        isMultiple = "single";
                        done();
                      } else if (action === "cancel") {
                        isMultiple = "multiple";
                        await handleConvertSI(
                          selectedRecords,
                          convertTo,
                          isMultiple,
                          "no",
                        );

                        done();
                      } else {
                        done();
                      }
                    },
                  },
                );
              }

              await handleConvertSI(
                selectedRecords,
                convertTo,
                isMultiple,
                "no",
              );

              done();
            } else {
              done();
            }
          },
        },
      );

      if (selectedRecords.length > 1) {
        await this.$confirm(
          `Would you like to convert these into a single sales invoice or into multiple sales invoices?<br><br>
          <strong>Selected Records:</strong><br> ${selectedRecords
            .map((item) => item.delivery_no)
            .join("<br>")}`,
          "Confirm Conversion",
          {
            confirmButtonText: "Single SI",
            cancelButtonText: "Multiple SIs",
            dangerouslyUseHTMLString: true,
            type: "info",
            distinguishCancelAndClose: true,
            beforeClose: async (action, instance, done) => {
              if (action === "confirm") {
                isMultiple = "single";
                done();
              } else if (action === "cancel") {
                isMultiple = "multiple";
                await handleConvertSI(
                  selectedRecords,
                  convertTo,
                  isMultiple,
                  "no",
                );

                done();
              } else {
                done();
              }
            },
          },
        );
      }

      await handleConvertSI(selectedRecords, convertTo, isMultiple, "no");
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
