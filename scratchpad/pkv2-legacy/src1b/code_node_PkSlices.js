// At most 25 Packings per add-node call (one Picking of 300 GDs made 300 in one call).
const list = {{node:code_node_gudzrvMQ.data.packingDataList}} || [];
const slices = [];
for (let i = 0; i < list.length; i += 25) slices.push({ rows: list.slice(i, i + 25) });
return { slices };
