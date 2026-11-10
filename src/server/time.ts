import { Temporal } from "@js-temporal/polyfill";
import * as chrono from "chrono-node";
import type { DateAnchor } from "@/lib/types";

export function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveDates(text: string, timezone: string, now = new Date()): DateAnchor[] {
  const zoned = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timezone);
  const offset = zoned.offsetNanoseconds / 60_000_000_000;
  return chrono.casual
    .parse(text, { instant: now, timezone: offset }, { forwardDate: false })
    .slice(0, 6)
    .map((result) => {
      let date = Temporal.PlainDate.from({
        year: result.start.get("year")!,
        month: result.start.get("month")!,
        day: result.start.get("day")!,
      });
      // A yearless date in a question about history means its latest occurrence.
      if (
        !result.start.isCertain("year") &&
        Temporal.PlainDate.compare(date, zoned.toPlainDate()) > 0
      ) {
        date = result.start.isCertain("weekday")
          ? date.subtract({ days: 7 })
          : date.subtract({ years: 1 });
      }
      const start = date
        .toZonedDateTime(timezone)
        .toInstant()
        .toString({ fractionalSecondDigits: 3 });
      const end = date
        .add({ days: 1 })
        .toZonedDateTime(timezone)
        .toInstant()
        .toString({ fractionalSecondDigits: 3 });
      return { text: result.text, date: date.toString(), start, end };
    });
}

export function clockContext(timezone: string, now = new Date()) {
  const local = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timezone);
  return `Current instant: ${now.toISOString()}. User timezone: ${timezone}. Local date: ${local.toPlainDate()} (${new Intl.DateTimeFormat("en", { weekday: "long", timeZone: timezone }).format(now)}).`;
}
