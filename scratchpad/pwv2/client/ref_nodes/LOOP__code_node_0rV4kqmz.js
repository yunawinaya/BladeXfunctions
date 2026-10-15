return {
  required_fields: JSON.stringify([
      { name: "plant_id", label: "Plant" },
      { name: "to_id", label: "Transfer Order No" },
      { name: "ref_doc_type", label: "Reference Document Type" },
      {
        name: "table_putaway_item",
        label: "Putaway Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
]),
  data: JSON.stringify({
    plant_id: {{node:code_node_kku8SAT9.data.data.plant_id}},
    to_id: {{node:code_node_kku8SAT9.data.data.to_id}},
    ref_doc_type: {{node:code_node_kku8SAT9.data.data.ref_doc_type}},
    table_putaway_item: {{node:code_node_kku8SAT9.data.data.table_putaway_item}},
  })
}