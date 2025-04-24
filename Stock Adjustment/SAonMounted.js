const page_status = this.getParamsVariables("page_status");
let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

if (page_status !== "Add") {
  const stockAdjustmentId = this.getParamsVariables("stock_adjustment_no");
  db.collection("stock_adjustment")
    .where({ id: stockAdjustmentId })
    .get()
    .then(async (resSA) => {
      const stockAdjustment = resSA.data[0];
      const {
        stock_adjustment_status,
        adjustment_no,
        organization_id,
        adjustment_date,
        adjustment_type,
        adjusted_by,
        plant_id,
        adjustment_remarks,
        reference_documents,
        subform_dus1f9ob,
        table_index,
      } = stockAdjustment;

      const sa = {
        stock_adjustment_status,
        adjustment_no,
        organization_id,
        adjustment_date,
        adjustment_type,
        adjusted_by,
        plant_id,
        adjustment_remarks,
        reference_documents,
        subform_dus1f9ob,
        table_index,
      };

      this.setData(sa);
      switch (stock_adjustment_status) {
        case "Draft":
          this.display(["draft_status"]);
          break;
        case "Completed":
          this.display(["completed_status"]);
          break;
        case "Fully Posted":
          this.display(["fullyposted_status"]);
          break;
      }

      if (page_status === "Edit") {
        if (stock_adjustment_status === "Draft") {
          this.hide("button_posted");
          this.hide("subform_dus1f9ob.link_adjust_stock");
          this.hide("subform_dus1f9ob.view_link");
          this.hide("subform_dus1f9ob.balance_index");
        }

        const prefixEntry = await db
          .collection("prefix_configuration")
          .where({
            document_types: "Stock Adjustment",
            is_deleted: 0,
            organization_id: organizationId,
          })
          .get()
          .then((prefixEntry) => {
            if (prefixEntry.data[0].is_active === 0) {
              this.disabled(["adjustment_no"], false);
            }
          });
      } else if (page_status === "View") {
        this.disabled(
          [
            "stock_adjustment_status",
            "adjustment_no",
            "adjustment_date",
            "adjustment_type",
            "adjusted_by",
            "plant_id",
            "adjustment_remarks",
            "table_item_balance",
            "reference_documents",
            "subform_dus1f9ob.adjustment_reason",
            "subform_dus1f9ob.adjustment_remarks",
            "subform_dus1f9ob.divider_tiqnndpq",
            "subform_dus1f9ob.material_id",
            "subform_dus1f9ob.total_quantity",
          ],
          true
        );
        document.querySelector(
          ".form-subform-action .el-button--primary"
        ).disabled = true;
        this.disabled(["subform_dus1f9ob.view_link"], false);
        this.hide("subform_dus1f9ob.link_adjust_stock");
        this.hide("subform_dus1f9ob.readjust_link");
        if (stock_adjustment_status === "Completed") {
          this.hide([
            "button_save_as_draft",
            "button_completed",
            "button_completed_posted",
          ]);
        } else {
          this.hide([
            "button_save_as_draft",
            "button_completed",
            "button_posted",
            "button_completed_posted",
          ]);
        }
      }
    });
} else {
  // Handle new stock adjustment (Add mode)
  this.display(["draft_status"]);
  this.hide("subform_dus1f9ob.view_link");
  this.hide("subform_dus1f9ob.readjust_link");
  this.hide("subform_dus1f9ob.balance_index");
  this.hide("button_posted");
  this.reset();

  // Generate prefix for Stock Adjustment

  const prefixEntry = db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Adjustment",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get()
    .then((prefixEntry) => {
      const prefixData = prefixEntry.data[0];
      const now = new Date();
      let prefixToShow;
      let runningNumber = prefixData.running_number;
      let isUnique = false;
      let maxAttempts = 10;
      let attempts = 0;
      console.log("prefixEntry", prefixData);
      if (prefixData.is_active === 0) {
        this.disabled(["adjustment_no"], false);
      }

      const generatePrefix = (runNumber) => {
        let generated = prefixData.current_prefix_config;
        generated = generated.replace("prefix", prefixData.prefix_value);
        generated = generated.replace("suffix", prefixData.suffix_value);
        generated = generated.replace(
          "month",
          String(now.getMonth() + 1).padStart(2, "0")
        );
        generated = generated.replace(
          "day",
          String(now.getDate()).padStart(2, "0")
        );
        generated = generated.replace("year", now.getFullYear());
        generated = generated.replace(
          "running_number",
          String(runNumber).padStart(prefixData.padding_zeroes, "0")
        );
        return generated;
      };

      const checkUniqueness = async (generatedPrefix) => {
        const existingDoc = await db
          .collection("stock_adjustment")
          .where({ adjustment_no: generatedPrefix })
          .get();
        return existingDoc.data[0] ? false : true;
      };

      const findUniquePrefix = async () => {
        while (!isUnique && attempts < maxAttempts) {
          attempts++;
          prefixToShow = generatePrefix(runningNumber);
          isUnique = await checkUniqueness(prefixToShow);
          if (!isUnique) {
            runningNumber++;
          }
        }

        if (!isUnique) {
          throw new Error(
            "Could not generate a unique Stock Adjustment number after maximum attempts"
          );
        }
        return { prefixToShow, runningNumber };
      };

      return findUniquePrefix();
    })
    .then(({ prefixToShow, runningNumber }) => {
      this.setData({ adjustment_no: prefixToShow });
    })
    .catch((error) => {
      alert(error);
    });
}
