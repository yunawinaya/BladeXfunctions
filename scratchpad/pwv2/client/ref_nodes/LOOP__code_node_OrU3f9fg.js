const pageStatus = {{workflowparams:pageStatus}}

let putawayData = {{node:code_node_kku8SAT9.data.data}}
  
if (pageStatus === 'Add') {
  const rawData = {{node:add_node_sjzNkA59.data}}
  putawayData = rawData[0]
  putawayData.table_putaway_item = {{node:search_node_hrs91pu9.data.data}}
} else {
  putawayData = {{node:get_node_gbE86P3e.data.data}}
}

const grId = putawayData.gr_id

const filteredPutawayItems = putawayData.table_putaway_item.filter((item) => item.line_status !== "Cancelled",);

return {
  grId,
  filteredPutawayItems,
}