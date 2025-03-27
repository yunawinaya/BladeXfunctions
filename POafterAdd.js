const data = this.getValues();

const items = data.table_po;

if (Array.isArray(items)) {
  items.forEach((item, index) => {

    const poLineData = {
      'po_line_material_id': item.item_id,
      'po_line_qty': item.quantity,
      'po_line_amount': item.po_amount,
      'po_line_unit_price': item.unit_price,
      'po_line_gross': item.gross,
      'po_line_uom_id': item.quantity_uom,
      'po_line_tax_inclusive': item.tax_inclusive,
      'purchase_order_number': data.purchase_order_no,
      'po_line_tax_rate_id': item.tax_preference,
      'po_line_tax_rate_percent': item.tax_rate,
      'po_line_tax_fee_amount': item.tax_amount,
      'po_line_discount_uom_id': item.discount_uom,
      'po_line_discount': item.discount,
      'po_line_discount_amount': item.discount_amount
    };
    
    db.collection("purchase_order_line").add(poLineData)
      .then(result => {
        console.log(`Successfully added purchase_order_line for item ${index + 1}:`, result);
      })
      .catch(error => {
        console.error(`Error adding purchase_order_line for item ${index + 1}:`, error);
      });
    
    const onOrderData = {
      'purchase_order_number': data.purchase_order_no,
      'material_id': item.item_id,
      'purchase_order_line': index + 1,
      'scheduled_qty': item.quantity,
    };
        
    db.collection("on_order_purchase_order").add(onOrderData)
      .then(result => {
        console.log(`Successfully added on_order_purchase_order for item ${index + 1}:`, result);
      })
      .catch(error => {
        console.error(`Error adding on_order_purchase_order for item ${index + 1}:`, error);
      });
  });
} else {
  console.error("table_po is not an array:", items);
}