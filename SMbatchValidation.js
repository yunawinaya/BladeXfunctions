db.collection("batch")
  .where({
    batch_number: value,
  })
  .get()
  .then((response) => {
    const matchingBatches = response.data || [];
    console.log("Matching batches:", matchingBatches);

    if (matchingBatches.length > 0 && value) {
      callback("Batch number already exists");
    } else {
      callback();
    }
  })
  .catch((error) => {
    console.error("Error checking batch number:", error);
    callback("Error checking batch number");
  });
