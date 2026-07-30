const resetFormFields = () => {
  console.log("resetFormFields");
  this.setData({
    cust_billing_name: "",
    cust_billing_cp: "",
    cust_billing_address: "",
    cust_shipping_address: "",
    so_area_id: "",
    billing_address_line_1: "",
    billing_address_line_2: "",
    billing_address_line_3: "",
    billing_address_line_4: "",
    billing_address_city: "",
    billing_address_state: "",
    billing_postal_code: "",
    billing_address_country: "",
    billing_address_name: "",
    billing_address_phone: "",
    billing_address_fax: "",
    billing_attention: "",
    billing_address_code: "",
    shipping_address_line_1: "",
    shipping_address_line_2: "",
    shipping_address_line_3: "",
    shipping_address_line_4: "",
    shipping_address_city: "",
    shipping_address_state: "",
    shipping_postal_code: "",
    shipping_address_country: "",
    shipping_address_name: "",
    shipping_address_phone: "",
    shipping_address_fax: "",
    shipping_attention: "",
    shipping_address_code: "",
  });
};

const setDialogAddressFields = (addressType, address) => {
  this.setData({
    [`${addressType}_address_line_1`]: address.address_line_1,
    [`${addressType}_address_line_2`]: address.address_line_2,
    [`${addressType}_address_line_3`]: address.address_line_3,
    [`${addressType}_address_line_4`]: address.address_line_4,
    [`${addressType}_address_city`]: address.address_city,
    [`${addressType}_address_state`]: address.adddress_state,
    [`${addressType}_postal_code`]: address.address_postal_code,
    [`${addressType}_address_country`]: address.address_country_id,
    [`${addressType}_address_name`]: address.address_name,
    [`${addressType}_address_phone`]: address.address_phone,
    [`${addressType}_attention`]: address.address_attention,
    [`${addressType}_address_code`]: address.address_code,
  });
};

const fetchCurrencyData = async (currencyID) => {
  try {
    const resCurrency = await db
      .collection("currency")
      .where({ id: currencyID })
      .get();

    if (!resCurrency || resCurrency.data.length === 0)
      throw new Error("Error fetching currency data");

    const currencyEntry = resCurrency.data[0];

    const currencyCode = currencyEntry.currency_code;
    if (!currencyCode) {
      this.hide([
        "exchange_rate",
        "exchange_rate_myr",
        "exchange_rate_currency",
        "myr_total_amount",
        "total_amount_myr",
      ]);
      return;
    } else {
      this.setData({
        total_gross_currency: currencyCode,
        total_discount_currency: currencyCode,
        total_tax_currency: currencyCode,
        total_amount_currency: currencyCode,
        exchange_rate_currency: currencyCode,
      });

      if (currencyCode !== "----" && currencyCode !== "MYR") {
        await this.setData({ so_currency: "" });
        await this.setData({
          exchange_rate: currencyEntry.currency_buying_rate,
          so_currency: currencyCode,
        });

        this.display([
          "exchange_rate",
          "exchange_rate_myr",
          "exchange_rate_currency",
          "myr_total_amount",
          "total_amount_myr",
        ]);
      } else {
        await this.setData({ so_currency: "" });
        await this.setData({
          exchange_rate: 1,
          so_currency: currencyCode,
        });
        this.hide([
          "exchange_rate",
          "exchange_rate_myr",
          "exchange_rate_currency",
          "myr_total_amount",
          "total_amount_myr",
        ]);
      }
    }
  } catch (error) {
    throw new Error(error.toString());
  }
};

const formatAddress = (address, state, country, addressTypeUpperCase) => {
  const addressLines = [
    address.address_line_1,
    address.address_line_2,
    address.address_line_3,
    address.address_line_4,
  ]
    .filter((line) => line)
    .join(
      (
        [
          address.address_line_1,
          address.address_line_2,
          address.address_line_3,
          address.address_line_4,
        ]
          .filter((line) => line)
          .pop() || ""
      ).endsWith(",")
        ? " "
        : ", ",
    );

  const cityDetails = [
    address.address_city,
    address.address_postal_code,
    address.adddress_state ? state : "",
    address.address_country_id ? country : "",
  ]
    .filter((detail) => detail)
    .join(
      (
        [
          address.address_city,
          address.address_postal_code,
          address.adddress_state ? state : "",
          address.address_country_id ? country : "",
        ]
          .filter((detail) => detail)
          .pop() || ""
      ).endsWith(",")
        ? " "
        : ", ",
    );

  const addressAttention = address.address_attention
    ? "\nAttention: " + address.address_attention
    : "";

  const addressPurposeName = `\n${addressTypeUpperCase}` + " Address";

  const addressPersonParts = [
    address.address_name,
    address.address_phone,
  ].filter((part) => part); // Remove undefined or null
  const addressPerson =
    addressPersonParts.length > 0 ? addressPersonParts.join(" | ") : "";

  const formattedAddress = [
    addressPerson,
    addressPurposeName,
    addressLines,
    cityDetails,
    addressAttention,
  ]
    .filter(Boolean)
    .join("\n");

  return formattedAddress;
};

// Pick the description this customer has bound to the item on the Item master.
// An item may carry several rows for the same customer -- take the first one
// that actually has a description. Falls back to the item's own material_desc.
const resolveItemDesc = (item, customerId) => {
  const fallback = item?.material_desc || "";
  if (!customerId || Array.isArray(customerId)) return fallback;

  const binds = Array.isArray(item?.table_cust_item_bind)
    ? item.table_cust_item_bind
    : [];
  const wanted = String(customerId).trim();

  for (const row of binds) {
    if (!row) continue;
    if (String(row.customer_id ?? "").trim() !== wanted) continue;
    const desc = String(row.item_desc ?? "").trim();
    if (desc) return desc;
  }

  return fallback;
};

const fetchLatestPricing = async (
  result,
  overwrite,
  itemById,
  itemIdByLine,
  customerId,
) => {
  const updates = {};

  for (const item of result) {
    if (overwrite === "Yes") {
      updates[`table_so.${item.line_index}.so_item_price`] = item.unit_price;
      updates[`table_so.${item.line_index}.so_item_uom`] = item.uom_id;
      updates[`table_so.${item.line_index}.so_tax_preference`] = item.tax_rate;
      updates[`table_so.${item.line_index}.so_tax_percentage`] =
        item.tax_percent;
      updates[`table_so.${item.line_index}.from_historical`] =
        item.from_historical;

      updates[`table_so.${item.line_index}.so_quantity`] = item.quantity;
      updates[`table_so.${item.line_index}.so_discount`] = item.discount;
      updates[`table_so.${item.line_index}.so_discount_uom`] =
        item.discount_uom;
      updates[`table_so.${item.line_index}.trigger_calc`] = "Yes";

      // Re-resolve the line description against the new customer's binding.
      const masterId = itemIdByLine[item.line_index];
      const master = masterId ? itemById[String(masterId)] : null;
      if (master) {
        updates[`table_so.${item.line_index}.so_desc`] = resolveItemDesc(
          master,
          customerId,
        );
      }
    }

    updates[`table_so.${item.line_index}.max_price`] = item.max_price;
    updates[`table_so.${item.line_index}.min_price`] = item.min_price;
  }

  await this.setData(updates);
};

(async () => {
  try {
    const customerItem = arguments[0]?.fieldModel?.item;
    const customerId = customerItem?.id;
    console.log("customer", customerItem);
    const plantID = this.getValue("plant_name");

    const tableSO = this.getValue("table_so");
    if (tableSO.length > 0) {
      const hasItemID = tableSO.some((item) => item.item_name);

      if (hasItemID) {
        // Line -> item master, needed to re-resolve so_desc for the new
        // customer. Started here (not awaited) so the single batched fetch
        // overlaps the pricing workflow round-trip.
        const itemIdByLine = {};
        tableSO.forEach((line, index) => {
          if (line.item_name) itemIdByLine[index] = line.item_name;
        });
        const itemIds = [...new Set(Object.values(itemIdByLine))];
        const itemsPromise = itemIds.length
          ? db
              .collection("Item")
              .filter(new Filter().in("id", itemIds).build())
              .get()
              .catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] });

        await this.runWorkflow(
          "2067818102244966401",
          {
            document_type: "SO",
            supp_cust_id: customerId,
            plant_id: plantID,
            item_data: tableSO.map((item, index) => {
              return {
                item_id: item.item_name,
                unit_price: item.so_item_price,
                line_index: index,
                uom_id: item.so_item_uom,
                tax_rate: item.so_tax_preference || null,
                tax_percent: item.so_tax_percentage || null,
                quantity: item.so_quantity,
                discount: item.so_discount,
                discount_uom: item.so_discount_uom,
              };
            }),
          },
          async (result) => {
            console.log("result", result);

            const resItems = await itemsPromise;
            const itemById = {};
            for (const it of (resItems && resItems.data) || [])
              itemById[String(it.id)] = it;

            if (result.data.needOverwrite === "No")
              await fetchLatestPricing(
                result.data.data,
                "No",
                itemById,
                itemIdByLine,
                customerId,
              );

            await this.$confirm(
              `The customer has been changed. Please choose one: <br><br>
        <strong>Overwrite:</strong> Replace the price and description based on the latest customer. <em>(If any)</em><br>
        <strong>Keep:</strong> Keep the existing item price and description.`,
              "Customer Change Detected",
              {
                confirmButtonText: "Overwrite",
                cancelButtonText: "Keep",
                dangerouslyUseHTMLString: true,
                type: "info",
                distinguishCancelAndClose: true,

                beforeClose: async (action, instance, done) => {
                  if (action === "confirm") {
                    await fetchLatestPricing(
                      result.data.data,
                      "Yes",
                      itemById,
                      itemIdByLine,
                      customerId,
                    );
                    done();
                  } else if (action === "cancel") {
                    await fetchLatestPricing(
                      result.data.data,
                      "No",
                      itemById,
                      itemIdByLine,
                      customerId,
                    );
                    done();
                  } else {
                    done();
                  }
                },
              },
            );

            const tableSO = this.getValue("table_so");
            for (const [index, item] of tableSO.entries()) {
              let Row = {};
              Row.row = item;
              Row.rowIndex = index;

              await this.triggerEvent("SOCalculation", Row);
            }
          },
          (error) => {
            console.log("error", error);
          },
        );
      }
    }

    if (customerId && !Array.isArray(customerId)) {
      this.display("address_grid");

      await resetFormFields();

      const resCustomer = await db
        .collection("Customer")
        .field(
          "customer_currency_id,customer_payment_term_id,customer_agent_id,last_sync_date,customer_credit_limit,overdue_limit,outstanding_balance,overdue_inv_total_amount,is_accurate,access_group,price_tag_id,customer_area_id",
        )
        .where({ id: customerId })
        .get();

      if (!resCustomer || resCustomer.data.length === 0)
        throw new Error("Error fetching customer");

      const customerData = resCustomer.data[0];

      if (customerData.customer_currency_id)
        await fetchCurrencyData(customerData.customer_currency_id);

      this.setData({
        so_payment_term: customerData.customer_payment_term_id || null,
        so_sales_person: customerData.customer_agent_id || null,
        access_group: customerData.access_group || [],
        price_tag_id: customerData.price_tag_id || null,
        so_area_id: customerData.customer_area_id || null,
      });

      const resAddress = await db
        .collection("Customer_skgkxqcn_sub")
        .where({
          Customer_id: customerId,
          switch_save_as_default: 1,
          is_deleted: 0,
        })
        .get();

      if (resAddress && resAddress.data.length > 0) {
        const resShipping = await db
          .collection("address_purpose")
          .where({ purpose_name: "Shipping" })
          .get();

        const shippingAddrId = resShipping.data[0].id;

        const addresses = resAddress.data;

        for (const address of addresses) {
          let country = "";
          let state = "";

          if (address.address_country_id) {
            const resCountry = await db
              .collection("country")
              .where({ id: address.address_country_id })
              .get();
            country = resCountry?.data[0]?.country_name || "";
          }

          if (address.adddress_state) {
            const resState = await db
              .collection("state")
              .where({ id: address.adddress_state })
              .get();
            state = resState?.data[0]?.state_name || "";
          }

          const isShipping = address.address_purpose_id === shippingAddrId;
          const addressType = isShipping ? "shipping" : "billing";
          const addressTypeUpperCase = isShipping ? "Shipping" : "Billing";

          const formattedAddress = await formatAddress(
            address,
            state,
            country,
            addressTypeUpperCase,
          );

          setDialogAddressFields(addressType, address);

          console.log(
            "cust_shipping_address before set Data",
            this.getValue("cust_shipping_address"),
          );
          console.log(
            "cust_billing_address before set Data",
            this.getValue("cust_billing_address"),
          );

          if (addressType === "shipping") {
            await this.setData({ cust_shipping_address: "" });
            await this.setData({
              cust_shipping_address: formattedAddress,
            });
          } else {
            await this.setData({ cust_billing_address: "" });
            await this.setData({
              cust_billing_address: formattedAddress,
            });
          }

          console.log(
            "cust_shipping_address after set Data",
            this.getValue("cust_shipping_address"),
          );
          console.log(
            "cust_billing_address after set Data",
            this.getValue("cust_billing_address"),
          );
        }

        if (customerData.is_accurate === 0) {
          this.openDialog("dialog_accurate");
        }

        this.setData({
          last_sync_date: customerData.last_sync_date,
          customer_credit_limit: customerData.customer_credit_limit,
          overdue_limit: customerData.overdue_limit,
          outstanding_balance: customerData.outstanding_balance,
          overdue_inv_total_amount: customerData.overdue_inv_total_amount,
          is_accurate: customerData.is_accurate,
        });
      }
    }

    this.disabled("table_so", false);
    this.display("price_history");
  } catch (error) {
    this.$message.error(error.toString());
  }
})();
