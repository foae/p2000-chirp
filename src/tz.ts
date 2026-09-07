const TZ = "Europe/Amsterdam";

function tzOffsetMs(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

export function parseWallAmsterdam(dateStr: string, timeStr: string): Date {
  let yyyy: number, mm: number, dd: number;
  if (/^\d{4}-/.test(dateStr)) {
    [yyyy, mm, dd] = dateStr.split("-").map(Number);
  } else {
    [dd, mm, yyyy] = dateStr.split("-").map(Number);
  }
  const [hh, mi, ss] = timeStr.split(":").map(Number);
  const asUTC = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss ?? 0);
  const offset1 = tzOffsetMs(new Date(asUTC));
  const offset2 = tzOffsetMs(new Date(asUTC - offset1));
  return new Date(asUTC - offset2);
}
