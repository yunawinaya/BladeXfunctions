const data = this.getValues();
console.log("Data", data);

// Check if purchase_order_id has a value
const purchaseOrderId = data.purchase_order_id;
if (!purchaseOrderId) {
    console.log("No purchase order ID found");
    return;
}

// First, get all existing goods receiving data for this purchase order
db.collection("goods_receiving")
  .where({
    purchase_order_id: purchaseOrderId,
  })
  .get()
  .then(result => {
    const GRData = result.data || [];
    console.log("Retrieved data:", GRData);
    
    // Get source items from the purchase order
    const sourceItems = arguments[0]?.fieldModel?.item?.table_po;
    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
        console.log("No source items found in purchase order");
        return;
    }
    
    console.log("Source items length:", sourceItems.length);
    
    // Calculate accumulated received quantities for each item
    const accumulatedQty = {};
    GRData.forEach(grRecord => {
        if (Array.isArray(grRecord.table_gr)) {
            grRecord.table_gr.forEach(grItem => {
                const itemId = grItem.item_id;
                if (itemId) {
                    // Initialize if not exists
                    if (!accumulatedQty[itemId]) {
                        accumulatedQty[itemId] = 0;
                    }
                    // Add to accumulated quantity
                    accumulatedQty[itemId] += parseFloat(grItem.received_qty || 0);
                }
            });
        }
    });
    
    console.log("Accumulated quantities:", accumulatedQty);
    
    try {
        // First, clear the existing array
        this.setData({
            'table_gr': []
        });
        
        // Create a better delay to ensure the clearing is complete
        setTimeout(() => {
            // Create the new items with proper structure including fm_key
            const newTableGr = sourceItems.map(() => ({
                "item_id": "",
                "item_desc": "",
                "ordered_qty": "",
                "to_received_qty": "",
                "received_qty": 0,
                "item_uom": "",
                "fm_key": Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
            }));
            
            // Set the new array structure
            this.setData({
                'table_gr': newTableGr
            });
            
            // Use a longer delay to ensure the array is created
            setTimeout(() => {
                sourceItems.forEach((sourceItem, index) => {
                    const itemId = sourceItem.item_id || "";
                    const orderedQty = parseFloat(sourceItem.quantity || 0);
                    
                    // Calculate remaining quantity to receive
                    const receivedSoFar = accumulatedQty[itemId] || 0;
                    const remainingQty = Math.max(0, orderedQty - receivedSoFar);
                    
                    // Update each field with correct values
                    this.setData({
                        [`table_gr.${index}.item_id`]: itemId,
                        [`table_gr.${index}.item_desc`]: sourceItem.item_desc || "",
                        [`table_gr.${index}.ordered_qty`]: orderedQty,
                        [`table_gr.${index}.to_received_qty`]: remainingQty,
                        [`table_gr.${index}.item_uom`]: sourceItem.quantity_uom || ""
                    });
                    
                    console.log(`Item ${itemId}: Ordered=${orderedQty}, Received so far=${receivedSoFar}, Remaining=${remainingQty}`);
                });
                
                console.log("Finished recreating and populating table_gr");
            }, 200);
        }, 100);
    } catch (e) {
        console.error("Error setting up table_gr:", e);
    }
  })
  .catch(error => {
    console.error("Error retrieving data:", error);
  });