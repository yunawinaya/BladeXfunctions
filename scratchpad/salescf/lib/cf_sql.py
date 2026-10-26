"""cf_sql.py: the id -> name step for a custom-field JSON column read by SQL.

The database stores custom fields keyed by each table's own definition ids; read nodes and forms turn them into field names,
raw SQL does not. A producer that reads a header by SQL and writes it to ANOTHER table must hand over names (the target
translates names into its own ids on write). cf_names_sql(col) is a SELECT-list scalar subquery (never EXISTS: a correlated
JSON_TABLE there matches nothing on MySQL 8.4) that returns the column as a name-keyed object:
  - a key that is all digits and an active definition's id becomes that definition's field_name;
  - a key that is all digits with no active definition is dropped (never copied as a foreign id);
  - any other key (already a name) is kept;
  - values keep their JSON type (false stays false); NULL / non-object / empty gives {} (never NULL).
"""


def cf_names_sql(col):
    return (
        "(SELECT IFNULL(JSON_OBJECTAGG(IFNULL(d.field_name, k.k),\n"
        "                              JSON_EXTRACT(%(c)s, CONCAT('$.\"', k.k, '\"'))), JSON_OBJECT())\n"
        "   FROM JSON_TABLE(IFNULL(JSON_KEYS(%(c)s), JSON_ARRAY()), '$[*]' COLUMNS (k VARCHAR(64) PATH '$')) k\n"
        "   LEFT JOIN su_code_custom_field d\n"
        "     ON d.id = IF(k.k REGEXP '^[0-9]+$', CAST(k.k AS UNSIGNED), NULL)\n"
        "    AND d.is_deleted = 0\n"
        "  WHERE NOT (k.k REGEXP '^[0-9]+$' AND d.id IS NULL))"
    ) % {"c": col}
