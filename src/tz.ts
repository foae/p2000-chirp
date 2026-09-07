const TZ = "Europe/Amsterdam";

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

function tzOffsetMs(date: Date): number {
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

export function parseWallAmsterdam(dateStr: string, timeStr: string): Date | null {
  let yyyy: number, mm: number, dd: number;
  if (/^\d{4}-/.test(dateStr)) {
    [yyyy, mm, dd] = dateStr.split("-").map(Number);
  } else {
    [dd, mm, yyyy] = dateStr.split("-").map(Number);
  }
  const [hh, mi, ss] = timeStr.split(":").map(Number);
  const second = ss ?? 0;
  if (
    ![yyyy, mm, dd, hh, mi, second].every((n) => Number.isFinite(n)) ||
    mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh < 0 || hh > 23 || mi < 0 || mi > 59 || second < 0 || second > 59
  ) {
    return null;
  }
  const asUTC = Date.UTC(yyyy, mm - 1, dd, hh, mi, second);
  const offset1 = tzOffsetMs(new Date(asUTC));
  const offset2 = tzOffsetMs(new Date(asUTC - offset1));
  const result = new Date(asUTC - offset2);
  return Number.isNaN(result.getTime()) ? null : result;
}
