# Goods Receiving Processing Code Explanation

This document provides a detailed explanation of the goods receiving processing code, breaking it down into logical sections with examples and explanations.

## 1. Initial Setup and Data Retrieval

```javascript
const data = this.getValues();
const items = data.table_gr;

if (Array.isArray(items)) {
  items.forEach((item, itemIndex) => {
    console.log(`Processing item ${itemIndex + 1}/${items.length}`);
    // ... rest of the code
  });
}
```

This section:

- Retrieves the goods receiving data using `getValues()`
- Extracts the items table from the data
- Verifies that items is an array
- Iterates through each item in the table

## 2. Goods Receiving Line Creation

```javascript
db.collection("goods_receiving_line")
  .add({
    goods_receiving_id: data.gr_no,
    material_id: item.item_id,
    order_quantity: item.ordered_qty,
    order_quantity_uom_id: item.item_uom,
    received_quantity: item.received_qty,
    to_receive_quantity: item.to_received_qty,
  })
  .catch((error) => {
    console.error(
      `Error adding goods_receiving_line for item ${itemIndex + 1}:`,
      error
    );
  });
```

This section:

- Creates a record in the `goods_receiving_line` collection
- Stores basic information about the received item
- Includes error handling for the database operation

## 3. Inventory Movement Recording

```javascript
db.collection("inventory_movement")
  .add({
    transaction_type: "GRN",
    trx_no: data.gr_no,
    parent_trx_no: data.purchase_order_number,
    movement: "IN",
    unit_price: item.unit_price,
    total_price: item.total_price,
    quantity: item.received_qty,
    material_id: item.item_id,
  })
  .catch((error) => {
    console.error(
      `Error adding inventory_movement for item ${itemIndex + 1}:`,
      error
    );
  });
```

This section:

- Records the inventory movement transaction
- Uses "GRN" (Goods Receipt Note) as the transaction type
- Tracks the movement as "IN" (incoming)
- Includes pricing information

## 4. Purchase Order Update

```javascript
db.collection("on_order_purchase_order")
  .where({
    purchase_order_number: data.purchase_order_number,
    material_id: item.item_id,
  })
  .get()
  .then((response) => {
    const result = response.data;
    if (result && Array.isArray(result) && result.length > 0) {
      const doc = result[0];
      if (doc && doc.id) {
        const orderedQty = parseFloat(item.ordered_qty || 0);
        const existingReceived = parseFloat(doc.received_qty || 0);
        const newReceived =
          existingReceived + parseFloat(item.received_qty || 0);
        const openQuantity = orderedQty - newReceived;

        db.collection("on_order_purchase_order").doc(doc.id).update({
          received_qty: newReceived,
          open_qty: openQuantity,
        });
      }
    }
  });
```

This section:

- Finds the corresponding purchase order line
- Calculates new received quantity
- Updates the open quantity
- Updates the purchase order record

## 5. Inventory Category Processing

```javascript
let block_qty = 0,
  reserved_qty = 0,
  unrestricted_qty = 0,
  qualityinsp_qty = 0;

const receivedQty = parseFloat(item.received_qty || 0);

if (item.inv_category === "BLK") {
  block_qty = receivedQty;
} else if (item.inv_category === "RES") {
  reserved_qty = receivedQty;
} else if (item.inv_category === "UNR") {
  unrestricted_qty = receivedQty;
} else if (item.inv_category === "QIP") {
  qualityinsp_qty = receivedQty;
} else {
  unrestricted_qty = receivedQty;
}
```

This section:

- Initializes quantity variables for different inventory categories
- Assigns the received quantity to the appropriate category based on `inv_category`
- Defaults to unrestricted if no category matches

## 6. Batch Processing

```javascript
if (item.item_batch_no) {
  db.collection("batch")
    .add({
      batch_number: item.item_batch_no,
      material_id: item.item_id,
      initial_quantity: item.received_qty,
      goods_receiving_no: data.gr_no,
      goods_receiving_id: data.id || "",
    })
    .then(() => {
      // ... batch balance processing
    });
}
```

This section:

- Checks if the item has a batch number
- Creates a new batch record if applicable
- Processes batch-specific inventory balances

## 7. Inventory Balance Management

```javascript
db.collection("item_balance")
  .where(itemBalanceParams)
  .get()
  .then((response) => {
    const result = response.data;
    const hasExistingBalance =
      result && Array.isArray(result) && result.length > 0;
    const existingDoc = hasExistingBalance ? result[0] : null;

    if (existingDoc && existingDoc.id) {
      // Update existing balance
      const updatedBlockQty =
        parseFloat(existingDoc.block_qty || 0) + block_qty;
      const updatedReservedQty =
        parseFloat(existingDoc.reserved_qty || 0) + reserved_qty;
      // ... update other quantities
    } else {
      // Create new balance
      balance_quantity =
        block_qty + reserved_qty + unrestricted_qty + qualityinsp_qty;
      // ... create new balance record
    }
  });
```

This section:

- Checks for existing inventory balance
- Updates existing balance or creates new one
- Maintains separate quantities for each inventory category

## 8. FIFO Costing History

```javascript
db.collection("fifo_costing_history")
  .where({ material_id: item.item_id })
  .get()
  .then((response) => {
    const result = response.data;
    const sequenceNumber =
      result && Array.isArray(result) && result.length > 0
        ? result.length + 1
        : 1;

    db.collection("fifo_costing_history").add({
      fifo_cost_price: item.unit_price,
      fifo_initial_quantity: item.received_qty,
      fifo_available_quantity: item.received_qty,
      material_id: item.item_id,
      fifo_sequence: sequenceNumber,
    });
  });
```

This section:

- Maintains FIFO (First In, First Out) costing history
- Assigns sequence numbers to new entries
- Records cost and quantity information

## Error Handling

Throughout the code, error handling is implemented using `.catch()` blocks:

```javascript
.catch((error) => {
  console.error(`Error message for item ${itemIndex + 1}:`, error);
});
```

Each database operation includes:

- Specific error messages
- Item index reference
- Error object logging

## Key Points to Remember

1. The code processes items sequentially
2. Each item can have different inventory categories
3. Batch tracking is optional
4. All quantities are parsed as floats
5. Default values are used when data is missing
6. Error handling is comprehensive
7. FIFO costing is maintained for cost tracking
