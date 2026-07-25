const DH_EVENT_ID_PATTERN =
  /^dh_\d+_\d+$/;

function randomSixDigit(): number {
  return Math.floor(
    100000 +
    Math.random() * 900000,
  );
}

export function createDhUniqueEventId(
  eventSequence = 0,
): string {
  const normalizedSequence =
    Number.isFinite(eventSequence) &&
    eventSequence >= 0
      ? Math.floor(eventSequence)
      : 0;

  const browserId =
    Date.now() +
    randomSixDigit();

  const pageLoadId =
    Date.now() +
    randomSixDigit();

  return (
    `dh_${browserId}_` +
    `${pageLoadId}${normalizedSequence}`
  );
}

export function isDhUniqueEventId(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= 255 &&
    DH_EVENT_ID_PATTERN.test(value)
  );
}
