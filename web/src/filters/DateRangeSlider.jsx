import { useMemo } from "react";

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function closestIndex(dates, targetDate) {
  if (!targetDate || dates.length === 0) {
    return -1;
  }
  const target = new Date(targetDate).getTime();
  if (Number.isNaN(target)) {
    return -1;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  dates.forEach((date, index) => {
    const current = new Date(date).getTime();
    const distance = Math.abs(current - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function prettyDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function DateRangeSlider({ dates = [], startDate, endDate, onChange }) {
  const { minIndex, maxIndex, startIndex, endIndex } = useMemo(() => {
    const min = 0;
    const max = Math.max(0, dates.length - 1);
    const start = closestIndex(dates, startDate);
    const end = closestIndex(dates, endDate);

    const normalizedStart = start === -1 ? min : clamp(start, min, max);
    const normalizedEnd = end === -1 ? max : clamp(end, min, max);
    return {
      minIndex: min,
      maxIndex: max,
      startIndex: Math.min(normalizedStart, normalizedEnd),
      endIndex: Math.max(normalizedStart, normalizedEnd),
    };
  }, [dates, startDate, endDate]);

  if (dates.length <= 1) {
    return null;
  }

  return (
    <section className="range-slider-card">
      <div className="range-slider-head">
        <h3>Date Range (Slider)</h3>
        <p>
          {prettyDate(dates[startIndex])} - {prettyDate(dates[endIndex])}
        </p>
      </div>

      <div className="range-slider-controls">
        <label>
          Start
          <input
            type="range"
            min={minIndex}
            max={maxIndex}
            step={1}
            value={startIndex}
            onChange={(event) => {
              const next = Number(event.target.value);
              const bounded = Math.min(next, endIndex);
              onChange?.(dates[bounded], dates[endIndex]);
            }}
          />
        </label>
        <label>
          End
          <input
            type="range"
            min={minIndex}
            max={maxIndex}
            step={1}
            value={endIndex}
            onChange={(event) => {
              const next = Number(event.target.value);
              const bounded = Math.max(next, startIndex);
              onChange?.(dates[startIndex], dates[bounded]);
            }}
          />
        </label>
      </div>
    </section>
  );
}

export default DateRangeSlider;
