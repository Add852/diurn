import 'package:flutter/material.dart';

import '../format.dart';

/// Month calendar with a dot on days that already have an entry. The stock
/// showDatePicker cannot decorate individual days; this keeps that feature
/// dependency-free.
Future<DateTime?> showEntryDatePicker(
  BuildContext context, {
  required DateTime initialDate,
  required Set<String> entryDates,
  DateTime? firstDate,
  DateTime? lastDate,
}) {
  return showDialog<DateTime>(
    context: context,
    builder: (_) => _EntryDatePicker(
      initialDate: initialDate,
      entryDates: entryDates,
      firstDate: firstDate ?? DateTime(2000),
      lastDate: lastDate ?? DateTime.now().add(const Duration(days: 365)),
    ),
  );
}

class _EntryDatePicker extends StatefulWidget {
  final DateTime initialDate;
  final Set<String> entryDates;
  final DateTime firstDate;
  final DateTime lastDate;

  const _EntryDatePicker({
    required this.initialDate,
    required this.entryDates,
    required this.firstDate,
    required this.lastDate,
  });

  @override
  State<_EntryDatePicker> createState() => _EntryDatePickerState();
}

class _EntryDatePickerState extends State<_EntryDatePicker> {
  late DateTime _month = DateTime(widget.initialDate.year, widget.initialDate.month);
  late DateTime _selected = widget.initialDate;

  static String _ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  bool get _canGoBack =>
      DateTime(_month.year, _month.month - 1).isAfter(
            DateTime(widget.firstDate.year, widget.firstDate.month - 1),
          );

  bool get _canGoForward =>
      DateTime(_month.year, _month.month + 1).isBefore(
            DateTime(widget.lastDate.year, widget.lastDate.month + 1),
          );

  void _moveMonth(int delta) {
    setState(() => _month = DateTime(_month.year, _month.month + delta));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final first = DateTime(_month.year, _month.month);
    final leadingBlanks = first.weekday - DateTime.monday;
    final days = DateUtils.getDaysInMonth(_month.year, _month.month);
    final today = DateUtils.dateOnly(DateTime.now());
    final ym = '${_month.year}-${_month.month.toString().padLeft(2, '0')}';

    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: _canGoBack ? () => _moveMonth(-1) : null,
                    icon: const Icon(Icons.chevron_left),
                  ),
                  Expanded(
                    child: Text(
                      monthTitle(ym),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, fontSize: 16),
                    ),
                  ),
                  IconButton(
                    onPressed: _canGoForward ? () => _moveMonth(1) : null,
                    icon: const Icon(Icons.chevron_right),
                  ),
                ],
              ),
              Row(
                children: [
                  for (final label in const ['M', 'T', 'W', 'T', 'F', 'S', 'S'])
                    Expanded(child: Center(child: Text(label))),
                ],
              ),
              const SizedBox(height: 4),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: leadingBlanks + days,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 7,
                ),
                itemBuilder: (context, i) {
                  if (i < leadingBlanks) return const SizedBox.shrink();
                  final day = i - leadingBlanks + 1;
                  final date = DateTime(_month.year, _month.month, day);
                  if (date.isBefore(DateUtils.dateOnly(widget.firstDate)) ||
                      date.isAfter(DateUtils.dateOnly(widget.lastDate))) {
                    return const SizedBox.shrink();
                  }
                  final ymd = _ymd(date);
                  final selected = DateUtils.isSameDay(date, _selected);
                  final hasEntry = widget.entryDates.contains(ymd);
                  return InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () => setState(() => _selected = date),
                    child: Semantics(
                      label: hasEntry ? '$ymd, has an entry' : ymd,
                      selected: selected,
                      child: Container(
                        margin: const EdgeInsets.all(3),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: selected ? cs.primaryContainer : null,
                          border: DateUtils.isSameDay(date, today) && !selected
                              ? Border.all(color: cs.primary)
                              : null,
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text('$day'),
                            SizedBox(
                              height: 5,
                              child: hasEntry
                                  ? Container(
                                      width: 5,
                                      height: 5,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: selected
                                            ? cs.onPrimaryContainer
                                            : cs.primary,
                                      ),
                                    )
                                  : null,
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
              Row(
                children: [
                  Icon(Icons.circle, size: 6, color: cs.primary),
                  const SizedBox(width: 6),
                  const Expanded(
                    child: Text('Has an entry',
                        style: TextStyle(fontSize: 12)),
                  ),
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancel'),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.pop(context, _selected),
                    child: const Text('OK'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
