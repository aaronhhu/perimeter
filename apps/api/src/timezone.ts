// "Area/Location" names only, plus UTC. ICU also accepts abbreviations like "pst", but Postgres reads
// "PST" as a fixed −08:00 with no DST, so midnight and the schedule would drift an hour for half the
// year. A list of canonical names is too strict the other way: Node's ICU lists India as
// Asia/Calcutta, so the newer Asia/Kolkata would be refused.
const AREA_LOCATION = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/;

export function isTimeZone(name: string): boolean {
  if (name !== "UTC" && !AREA_LOCATION.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
