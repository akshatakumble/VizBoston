"""Time period classification helpers shared across cleaning modules."""

from __future__ import annotations

import pandas as pd


def classify_time_period(seconds_since_midnight: pd.Series) -> pd.Series:
    """Classify MBTA service into standard time periods.

    Period definitions:
    - AM Peak: 06:30-09:00
    - Midday: 09:00-15:30
    - PM Peak: 15:30-18:30
    - Evening: 18:30-23:00
    - Late Night: 23:00-01:00
    - Other: all remaining times
    """

    tod = seconds_since_midnight % 86400
    result = pd.Series("Other", index=seconds_since_midnight.index, dtype="object")

    result[(tod >= 23400) & (tod < 32400)] = "AM Peak"
    result[(tod >= 32400) & (tod < 55800)] = "Midday"
    result[(tod >= 55800) & (tod < 66600)] = "PM Peak"
    result[(tod >= 66600) & (tod < 82800)] = "Evening"
    result[(tod >= 82800) | (tod < 3600)] = "Late Night"

    return result
