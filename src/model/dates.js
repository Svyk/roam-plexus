const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const prefixIndex = (names, token) => {
  if (token.length < 3) return -1;
  return names.findIndex((n) => n.startsWith(token));
};

function monthDay(now, month, day) {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const y = now.getFullYear();
  const d = new Date(y, month, day);
  return d.getMonth() === month && d.getDate() === day ? d : null;
}

export function parseNaturalDate(text, now = new Date()) {
  if (typeof text !== "string" || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (s === "today") return new Date(y, m, d);
  if (s === "tomorrow") return new Date(y, m, d + 1);
  if (s === "yesterday") return new Date(y, m, d - 1);

  const wd = /^(?:next )?([a-z]+)$/.exec(s);
  if (wd) {
    const idx = prefixIndex(WEEKDAYS, wd[1]);
    if (idx >= 0) {
      const ahead = ((idx - now.getDay() + 6) % 7) + 1;
      return new Date(y, m, d + ahead);
    }
  }

  const ord = "(?:st|nd|rd|th)?";
  const a = new RegExp(`^([a-z]+) (\\d{1,2})${ord}$`).exec(s);
  if (a) {
    const mi = prefixIndex(MONTHS, a[1]);
    return mi >= 0 ? monthDay(now, mi, Number(a[2])) : null;
  }
  const b = new RegExp(`^(\\d{1,2})${ord} ([a-z]+)$`).exec(s);
  if (b) {
    const mi = prefixIndex(MONTHS, b[2]);
    return mi >= 0 ? monthDay(now, mi, Number(b[1])) : null;
  }
  return null;
}

export function isDateAbbrev(text) {
  const s = String(text ?? "").trim().toLowerCase();
  return s.length === 3 && (WEEKDAYS.some((n) => n.startsWith(s)) || MONTHS.some((n) => n.startsWith(s)));
}
