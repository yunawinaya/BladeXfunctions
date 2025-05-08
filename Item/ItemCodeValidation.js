const page_status = this.getValue("page_status");

if (page_status === "View" || !value) {
  callback();
  return;
}

db.collection("Item")
  .where({ material_code: value })
  .get()
  .then((response) => {
    const matchingItems = response.data || [];

    if (matchingItems.length === 0) {
      callback();
      return;
    }

    if (page_status === "Edit") {
      const currentItemId = this.getValue("id");
      const isSameItem = matchingItems.some(
        (item) => item.id === currentItemId
      );
      callback(isSameItem ? undefined : "Item code already exists.");
    } else {
      callback("Item code already exists.");
    }
  })
  .catch((error) => {
    console.error("Error checking item:", error);
    callback("Error validating item code.");
  });
