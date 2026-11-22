/// Friendly date formatting for titles, headers, and captions.
/// English-only, no intl dependency. ponytail: swap to the intl package
/// if localization ever matters.
library;

const _months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const _weekdays = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

DateTime? _parseYmd(String s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
  if (m == null) return null;
  return DateTime(
    int.parse(m.group(1)!),
    int.parse(m.group(2)!),
    int.parse(m.group(3)!),
  );
}

/// "2026-01" → "January 2026" (journal month group headers).
String monthTitle(String yearMonth) {
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(yearMonth);
  if (m == null) return yearMonth;
  final mo = int.tryParse(m.group(2)!);
  if (mo == null || mo < 1 || mo > 12) return yearMonth;
  return '${_months[mo - 1]} ${m.group(1)}';
}

/// "2026-01-10" → "10" (journal card dates; month/year live in the header).
String dayLabel(String ymd) {
  final d = _parseYmd(ymd);
  if (d == null) return ymd;
  return '${d.day}';
}

/// "2026-01-10" → "Sat, 10 Jan 2026" (entry screen app bar, lightbox).
String longDate(String ymd) {
  final d = _parseYmd(ymd);
  if (d == null) return ymd;
  final wd = _weekdays[d.weekday - 1].substring(0, 3);
  return '$wd, ${d.day} ${_months[d.month - 1].substring(0, 3)} ${d.year}';
}

/// "2026-01-10" → "Saturday, 10 January" (media day headers).
String dayTitle(String ymd) {
  final d = _parseYmd(ymd);
  if (d == null) return ymd;
  final wd = _weekdays[d.weekday - 1];
  return '$wd, ${d.day} ${_months[d.month - 1]}';
}

/// "2026-01-10 01:42" (server takenAt) → "1:42 AM"; null → ''.
String timeLabel(String? takenAt) {
  if (takenAt == null) return '';
  final m = RegExp(r'^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2})$').firstMatch(takenAt);
  if (m == null) return '';
  var h = int.parse(m.group(1)!);
  final min = m.group(2)!;
  final ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12;
  if (h == 0) h = 12;
  return '$h:$min $ampm';
}
