(async () => {
  const so_id = this.getValue("so_id");

  const salesOrderIds = Array.isArray(so_id) ? so_id : [so_id];

  if (salesOrderIds.length > 0 && salesOrderIds[0]) {
    this.disabled(["plant_id"], false);

    const customerContact = arguments[0]?.fieldModel[0]?.item.cust_cp;
    if (customerContact) {
      this.setData({
        contact_person: customerContact,
      });
    }

    if (salesOrderIds.length > 1) {
      // Multiple SOs - fetch and join numbers
      Promise.all(
        salesOrderIds.map((soId) =>
          db
            .collection("sales_order")
            .where({ id: soId })
            .get()
            .then((response) => {
              if (response.data && response.data.length > 0) {
                return response.data[0].so_no;
              }
              return "";
            })
        )
      )
        .then((soNumbers) => {
          const validSoNumbers = soNumbers.filter(Boolean);
          this.setData({
            so_no_display: validSoNumbers.join(", "),
          });
        })
        .catch((error) => {
          console.error("Error fetching SO numbers:", error);
        });
    } else {
      // Single SO - fetch and set number
      db.collection("sales_order")
        .where({ id: salesOrderIds[0] })
        .get()
        .then((response) => {
          if (response.data && response.data.length > 0) {
            this.setData({
              so_no_display: response.data[0].so_no,
            });
          }
        })
        .catch((error) => {
          console.error("Error fetching SO number:", error);
        });
    }
  }
})();
