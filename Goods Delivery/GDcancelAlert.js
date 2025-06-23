const { gd_status } = arguments[0].row;
const { picking_status } = arguments[0].row;
console.log("GD Data", arguments[0].row);
this.setData({ goods_delivery_id: arguments[0].row.id });

if (gd_status !== "Created") {
  alert("You can only cancel created records.");
  return;
}

if (picking_status === "In Progress" || picking_status === "Completed") {
  alert(
    "Can't cancel goods delivery with picking status in progress or completed."
  );
  return;
}
