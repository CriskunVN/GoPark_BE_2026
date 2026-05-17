/**
 * Converts a UTC ISO string (sent from frontend) into a local Date object whose local hours/minutes match the UTC values.
 * This is crucial when saving to a `timestamp without time zone` database column to prevent PostgreSQL from applying
 * its session/server timezone shift.
 */
export function convertUTCToLocalForDb(isoStr?: string | Date): Date | undefined {
  if (!isoStr) return undefined;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return undefined;
    return new Date(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds()
    );
  } catch {
    return undefined;
  }
}

/**
 * Converts a local Date object (parsed from a `timestamp without time zone` column by the pg driver)
 * into a UTC Date object representing the exact same year, month, date, hours, and minutes.
 * This prevents the serialized JSON from applying the running Node.js process local timezone offset.
 */
export function convertLocalToUTCForRes(date?: Date): Date | undefined {
  if (!date) return undefined;
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return undefined;
    return new Date(Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds()
    ));
  } catch {
    return undefined;
  }
}
