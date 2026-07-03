const handleConvertSI = async (
  selectedRecords,
  convertTo,
  isMultiple,
  plantID,
  filterDraft,
) => {
  this.showLoading("Converting Sales Order to Sales Invoice...");
  await this.runWorkflow(
    "2029006184569364481",
    {
      so_ids: selectedRecords.map((record) => record.id),
      convert_to: convertTo,
      is_multiple: isMultiple,
      plant_id: plantID,
      filter_draft: filterDraft,
    },
    async (res) => {
      console.log("SI Data", res.data);
      this.$alert("Convert Sales Order to Sales Invoice Success", "Success", {
        confirmButtonText: "OK",
        type: "success",
      });
      this.refresh();
      this.hideLoading();
    },
    async (err) => {
      console.error(err);
      this.hideLoading();
      if (err.data?.code === 401) {
        // Draft SO cannot be converted.
        await this.$confirm(err.data.msg, "Draft SO cannot be converted.", {
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
          plantID,
          "yes",
        );
      } else if (err.data?.code === 402) {
        // Selected Sales Order(s) already has a related Sales Invoice and cannot be converted.
        await this.$alert(err.data.msg, "Error", {
          confirmButtonText: "OK",
          type: "error",
        });
      } else if (err.data?.code === 403) {
        await this.openDialog("dialog_select_plant");
        this.models["_data"] = {
          selectedRecords: {
            so_ids: selectedRecords.map((record) => record.id),
            convert_to: convertTo,
            is_multiple: isMultiple,
            plant_id: plantID,
            filter_draft: filterDraft,
          },
          doc_type: "sales invoice",
        };
        this.setData({
          [`dialog_select_plant.organization_id`]:
            selectedRecords[0].organization_id,
          [`dialog_select_plant.plant_id`]: "",
        });
        this.hideLoading();
      } else if (err.data?.code === 404 || err.data?.code === 405) {
        // All selected Sales Order(s) must be from the same plant/organization to create a single Sales Invoice.
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
          plantID,
          filterDraft,
        );
      }
    },
  );
  this.hideLoading();
};

(async () => {
  try {
    const allListID = "custom_ysv40u3j";
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
            .map((item) => item.so_no)
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
                          "",
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
                "",
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
            .map((item) => item.so_no)
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
                  "",
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

      await handleConvertSI(selectedRecords, convertTo, isMultiple, "", "no");
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
