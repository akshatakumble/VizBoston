# Data Quality Report

Year: 2025
Source: raw (../data/raw)

| Dataset | Rows | Columns | Date Range | Missing Service Dates | Outliers | Green Line Coverage |
|---|---:|---:|---|---:|---:|---:|
| rapid_transit_events | 10000 | 9 | 2025-01-01 to 2025-01-31 | 0 | 0 | 0 (0.0%) |
| rapid_transit_headways | 10000 | 10 | 2025-01-01 to 2025-01-31 | 0 | 0 | 0 (0.0%) |
| rapid_transit_travel_times | 10000 | 9 | 2025-01-01 to 2025-01-31 | 0 | 0 | 0 (0.0%) |
| gtfs_schedules | 10000 | 9 | 2025-01-01 to 2025-01-31 | 0 | 0 | 0 (0.0%) |

## Notes

- Null rate and value distribution details are documented inside each dataset notebook.
- Outlier rules are dataset-specific and intentionally conservative for initial exploration.
- Green Line coverage is based on `route_id` values starting with `Green`.
