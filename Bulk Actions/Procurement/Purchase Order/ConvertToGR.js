(async () => {
  try {
    const unCompletedListID = "custom_y9e0c53q";
    const allListID = "custom_6f0yz6lm";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted"
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      selectedRecords = selectedRecords.filter(
        (item) => item.po_status === "Issued" || item.po_status === "Processing"
      );

      if (selectedRecords.length === 0) {
        await this.$alert(
          "No selected records are available for conversion. Please select records with status 'Issued' or 'Processing'.",
          "No Records to Convert",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "warning",
          }
        );
        return;
      }

      // Filter out records that are not "Issued" / "Processing"
      await this.$confirm(
        `Only these purchase order records available for conversion. Proceed?<br><br>
        <strong>Selected Records:</strong><br> ${selectedRecords
          .map((item) => item.purchase_order_no)
          .join("<br>")}`,
        "Confirm Conversion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      // Process multiple selections
      if (selectedRecords.length > 0) {
        let organizationId = this.getVarGlobal("deptParentId");
        if (organizationId === "0") {
          organizationId = this.getVarSystem("deptIds");

          const response = await db
            .collection("blade_dept")
            .where({ parent_id: organizationId })
            .get();

          if (response.data.length > 0) {
            let plants = new Set(
              selectedRecords.map((record) => record.po_plant.id)
            );

            plants.delete(organizationId);

            console.log("plants", plants);

            if (plants.size > 1) {
              await this.$alert(
                "All selected purchase orders must be from the same plant/organization to create a single goods receipt.",
                "Error",
                {
                  confirmButtonText: "OK",
                  type: "error",
                }
              );
              return;
            }

            if (plants.size === 1) {
              const plantID = Array.from(plants)[0];
              if (plantID !== organizationId) {
                await this.triggerEvent("func_handleConvertGR", {
                  selectedRecords,
                  plantID,
                });
              }
            } else {
              await this.openDialog("dialog_select_plant");
              this.models["_data"] = selectedRecords;
              this.setData({
                [`dialog_select_plant.organization_id`]: organizationId,
                [`dialog_select_plant.plant_id`]: "",
              });
            }
          } else {
            await this.triggerEvent("func_handleConvertGR", {
              selectedRecords,
              plantID: organizationId,
            });
          }
        } else {
          await this.triggerEvent("func_handleConvertGR", {
            selectedRecords,
            plantID: this.getVarSystem("deptIds"),
          });
        }

        await this.getComponent(
          activeTab === "Uncompleted" ? unCompletedListID : allListID
        )?.$refs.crud.clearSelection();
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
