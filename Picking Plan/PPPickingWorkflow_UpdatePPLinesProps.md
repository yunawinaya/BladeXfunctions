# Update PP Lines Node - Props Configuration

Add these props to the **Update PP Lines** node (`update_node_ryYGanwi`) to include the new picked tracking fields.

## New Props to Add

Add these three props to the existing `props.list` array:

```json
{
  "prop": "picked_temp_qty_data",
  "valueType": "field",
  "value": "{{node:code_node_y493PW6G.data.updatedToLines.picked_temp_qty_data}}",
  "valueLabel": "",
  "propLabel": "Picked Temp Qty Data"
},
{
  "prop": "picked_view_stock",
  "valueType": "field",
  "value": "{{node:code_node_y493PW6G.data.updatedToLines.picked_view_stock}}",
  "valueLabel": "",
  "propLabel": "Picked View Stock"
},
{
  "prop": "picked_qty",
  "valueType": "field",
  "value": "{{node:code_node_y493PW6G.data.updatedToLines.picked_qty}}",
  "valueLabel": "",
  "propLabel": "Picked Quantity"
}
```

## Complete Props List (with new fields)

Here's the complete `props.list` array for the Update PP Lines node with all fields including the new ones:

```json
{
  "modelName": "",
  "list": [
    {
      "prop": "id",
      "valueType": "field",
      "value": "{{node:code_node_y493PW6G.data.updatedToLines.id}}",
      "propLabel": "Primary Key ID"
    },
    {
      "prop": "temp_qty_data",
      "valueType": "field",
      "value": "{{node:code_node_y493PW6G.data.updatedToLines.temp_qty_data}}",
      "propLabel": "Temporary Qty Data"
    },
    {
      "prop": "prev_temp_qty_data",
      "valueType": "field",
      "value": "{{node:code_node_y493PW6G.data.updatedToLines.prev_temp_qty_data}}",
      "propLabel": "Prev Temporary Qty Data"
    },
    {
      "prop": "view_stock",
      "valueType": "field",
      "value": "{{node:code_node_y493PW6G.data.updatedToLines.view_stock}}",
      "propLabel": "Delivery Summary"
    },
    {
      "prop": "picking_status",
      "valueType": "field",
      "value": "{{node:code_node_y493PW6G.data.updatedToLines.picking_status}}",
      "propLabel": "Line Picking Status"
    },
    {
      "prop": "picked_temp_qty_data",
      "valueType": "field",
      "value": "{{node:code_node_y493PW6G.data.updatedToLines.picked_temp_qty_data}}",
      "propLabel": "Picked Temp Qty Data"
    },
    {
      "prop": "picked_view_stock",
      "valueType": "field",
      "value": "{{node:code_node_y493PW6G.data.updatedToLines.picked_view_stock}}",
      "propLabel": "Picked View Stock"
    },
    {
      "prop": "picked_qty",
      "valueType": "field",
      "value": "{{node:code_node_y493PW6G.data.updatedToLines.picked_qty}}",
      "propLabel": "Picked Quantity"
    }
  ]
}
```

## Note on Node References

Make sure to update the node reference `code_node_y493PW6G` to match the actual ID of your **PP Lines Preparation** code node in your workflow.

## Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `picked_temp_qty_data` | JSON String | Cumulative picked quantities by target location and batch. Accumulates across multiple picking sessions. |
| `picked_view_stock` | Text | Human-readable summary of picked quantities. Format: "Total: X UOM\n\nDETAILS:\n1. Location: Qty" |
| `picked_qty` | Number | Total quantity picked for this line (sum of all sessions) |

## Response JSON for PP Lines Preparation Code Node

Add these to the `response_json` array in the PP Lines Preparation code node configuration:

```json
[
  {
    "key": "picked_temp_qty_data_key",
    "name": "picked_temp_qty_data",
    "title": "picked_temp_qty_data",
    "description": "Cumulative picked quantities by location/batch",
    "bsonType": "string"
  },
  {
    "key": "picked_view_stock_key",
    "name": "picked_view_stock",
    "title": "picked_view_stock",
    "description": "Human-readable summary of picked quantities",
    "bsonType": "string"
  },
  {
    "key": "picked_qty_key",
    "name": "picked_qty",
    "title": "picked_qty",
    "description": "Total picked quantity for the line",
    "bsonType": "double"
  }
]
```

These should be added to the `updatedToLines` array item definition in the response_json.
