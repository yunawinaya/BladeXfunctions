const main = async () => {
  try {
    const self = this;
    const allData = self.getValues();
    const salesOrder = arguments[0].value;
    const materialId = allData.material_id; // e.g., "item A"
    const plantId = allData.plant_id;

    console.log("salesOrder", arguments[0]);

    // Function to fetch and filter sales orders for options
    const fetchSalesOrders = async () => {
      try {
        const response = await db
          .collection("sales_order")
          .where({ plant_name: plantId })
          .get();
        const salesOrderData = response.data || [];

        // Deduplicate sales orders
        const uniqueSalesOrders = Array.from(
          new Map(salesOrderData.map((so) => [so.id, so])).values()
        );

        // Filter by materialId
        const filteredSalesOrders = uniqueSalesOrders.filter((salesOrder) =>
          salesOrder.table_so.some((item) => item.item_name === materialId)
        );
        console.log("Filtered Sales Orders:", filteredSalesOrders);

        const fieldPath = `table_sales_order.${arguments[0].rowIndex}.sales_order_id`;

        // Set options only for new rows or if not set by addrow.js
        if (!self.getOptionData(fieldPath)?.length) {
          self.setOptionData(fieldPath, filteredSalesOrders);
        }

        return filteredSalesOrders;
      } catch (error) {
        console.error("Error fetching sales orders:", error);
        self.showError?.("Failed to load sales orders");
        return [];
      }
    };

    // Fetch sales orders for dropdown options
    await fetchSalesOrders();

    // Handle specific sales order selection
    if (salesOrder) {
      try {
        const response = await db
          .collection("sales_order")
          .where({ id: salesOrder })
          .get();

        const salesOrderData = response.data[0];
        console.log("salesOrderData", salesOrderData);

        if (!salesOrderData) {
          throw new Error("Sales order not found");
        }

        // Fetch customer information
        const customerResponse = await db
          .collection("Customer")
          .where({ id: salesOrderData.customer_name })
          .get();

        const customerInfo = customerResponse.data[0];
        console.log("customerInfo", customerInfo);

        if (!customerInfo) {
          throw new Error("Customer not found");
        }

        // Filter table_so to find items matching materialId
        const matchingItem =
          salesOrderData.table_so && salesOrderData.table_so.length > 0
            ? salesOrderData.table_so.find(
                (item) => item.item_name === materialId
              )
            : null;

        // Use so_quantity from matching item or fallback to 0
        const soQuantity = matchingItem ? matchingItem.so_quantity : 0;

        // Update the form data
        this.setData({
          [`table_sales_order.${arguments[0].rowIndex}.customer_name`]:
            customerInfo.customer_com_name,
          [`table_sales_order.${arguments[0].rowIndex}.so_quantity`]:
            soQuantity,
          [`table_sales_order.${arguments[0].rowIndex}.so_expected_ship_date`]:
            salesOrderData.so_shipping_date,
        });
      } catch (error) {
        console.error("Error processing selected sales order:", error);
        self.showError?.("Failed to load sales order details");
      }
    }
  } catch (error) {
    console.error("Error in main execution:", error);
    self.showError?.("An error occurred while processing the sales order");
  }
};

main();
