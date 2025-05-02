const page_status = this.getParamsVariables("page_status");
let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

if (page_status !== "Add") {
  const supplierId = this.getParamsVariables("supplier_no");
  db.collection("supplier_head")
    .where({ id: supplierId })
    .get()
    .then((resSupplier) => {
      const supplier = resSupplier.data[0];

      const {
        supplier_status,
        supplier_type,
        supplier_com_name,
        supplier_com_reg_no,
        supplier_business_type,
        supplier_irbm_id,
        supplier_code,
        supplier_com_old_reg_no,
        business_activity_id,
        supplier_area_id,
        supplier_agent_id,
        currency_id,
        supplier_tax_rate,
        supplier_tax_percent,
        supplier_tin_no,
        supplier_credit_limit,
        supplier_payment_term_id,
        supplier_sst_sales_no,
        supplier_sst_service_no,
        supplier_exceed_limit,
        address_list,
        contact_list,
        supplier_website,
        remarks,
        attachment,
        switch_save_as_default,
        address_purpose_id,
        address_name,
        address_country_id,
        address_line_1,
        address_line_2,
        address_line_3,
        address_line_4,
        address_city,
        adddress_state,
        address_postal_code,
        address_phone,
        address_fax_no,
      } = supplier;

      const supp = {
        supplier_status,
        supplier_type,
        supplier_com_name,
        supplier_com_reg_no,
        supplier_business_type,
        supplier_irbm_id,
        supplier_code,
        supplier_com_old_reg_no,
        business_activity_id,
        supplier_area_id,
        supplier_agent_id,
        currency_id,
        supplier_tax_rate,
        supplier_tax_percent,
        supplier_tin_no,
        supplier_credit_limit,
        supplier_payment_term_id,
        supplier_sst_sales_no,
        supplier_sst_service_no,
        supplier_exceed_limit,
        address_list,
        contact_list,
        supplier_website,
        remarks,
        attachment,
        switch_save_as_default,
        address_purpose_id,
        address_name,
        address_country_id,
        address_line_1,
        address_line_2,
        address_line_3,
        address_line_4,
        address_city,
        adddress_state,
        address_postal_code,
        address_phone,
        address_fax_no,
      };

      this.setData(supp);

      switch (supplier_status) {
        case "Active":
          this.display(["active_status"]);
          break;
        case "Inactive":
          this.display(["inactive_status"]);
          break;
        case "Suspended":
          this.display(["suspended_status"]);
          break;
        case "Prospect":
          this.display(["prospect_status"]);
          break;
        case "Pending":
          this.display(["pending_status"]);
          break;
      }

      if (page_status === "View") {
        this.disabled(
          [
            "supplier_status",
            "supplier_type",
            "supplier_com_name",
            "supplier_com_reg_no",
            "supplier_business_type",
            "supplier_irbm_id",
            "supplier_code",
            "supplier_com_old_reg_no",
            "business_activity_id",
            "supplier_area_id",
            "supplier_agent_id",
            "currency_id",
            "supplier_tax_rate",
            "supplier_tax_percent",
            "supplier_tin_no",
            "supplier_credit_limit",
            "supplier_payment_term_id",
            "supplier_sst_sales_no",
            "supplier_sst_service_no",
            "supplier_exceed_limit",
            "address_list",
            "contact_list",
            "supplier_website",
            "remarks",
            "attachment",
            "switch_save_as_default",
            "address_purpose_id",
            "address_name",
            "address_country_id",
            "address_line_1",
            "address_line_2",
            "address_line_3",
            "address_line_4",
            "address_city",
            "address_state",
            "address_postal_code",
            "address_phone",
            "address_fax_no",
          ],
          true
        );

        this.hide(["button_cancel", "button_save"]);
      } else if (page_status === "Edit") {
        this.disabled(
          [
            "supplier_type",
            "supplier_com_name",
            "supplier_com_reg_no",
            "supplier_business_type",
            "supplier_irbm_id",
            "supplier_code",
            "supplier_com_old_reg_no",
            "business_activity_id",
            "supplier_area_id",
            "supplier_agent_id",
          ],
          true
        );
      }
    });
} else {
  this.display(["active_status"]);
  this.reset();

  const prefixEntry = db
    .collection("prefix_configuration")
    .where({
      document_types: "Suppliers",
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

      if (prefixData.is_active === 0) {
        this.disabled(["supplier_code"], false);
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
          .collection("supplier_head")
          .where({ supplier_code: generatedPrefix })
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
            "Could not generate a unique Supplier Code after maximum attempts"
          );
        }
        return { prefixToShow, runningNumber };
      };

      return findUniquePrefix();
    })
    .then(({ prefixToShow, runningNumber }) => {
      this.setData({ supplier_code: prefixToShow });
    });
}
