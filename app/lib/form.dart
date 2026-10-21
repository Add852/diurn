import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'api.dart';
import 'lightbox.dart';

/// Today tab: the no-AI form interface (GET /api/form + POST /api/entries).
/// Verbatim answers -> server renders the template -> {date}.md.
class FormScreen extends StatefulWidget {
  final Api api;
  final ValueListenable<int>? refreshSignal;

  /// FAB Write on the Today tab — triggers the form save.
  final ValueListenable<int>? saveTrigger;

  /// Shown when the profile has no questions (fresh server).
  final VoidCallback? onOpenSettings;
  const FormScreen({
    super.key,
    required this.api,
    this.refreshSignal,
    this.saveTrigger,
    this.onOpenSettings,
  });

  @override
  State<FormScreen> createState() => _FormScreenState();
}

class _FormScreenState extends State<FormScreen> {
  late Future<FormInfo> _future;
  final _answers = <String, TextEditingController>{};
  bool _saving = false;
  String? _error;
  String? _savedDate;

  /// Latest loaded form — the FAB save trigger needs the current date.
  FormInfo? _info;

  /// Chosen entry day (null = the server's "today" from GET /api/form).
  String? _date;
  List<MediaFile> _allMedia = const [];

  @override
  void initState() {
    super.initState();
    _future = _loadForm();
    _loadMedia();
    widget.refreshSignal?.addListener(_reload);
    widget.saveTrigger?.addListener(_onSaveTrigger);
  }

  /// form() futures that get replaced by a refresh while still pending would
  /// log unhandled exceptions — attach a no-op listener; FutureBuilder
  /// surfaces the error for the live future.
  Future<FormInfo> _loadForm() {
    final f = widget.api.form();
    // no-op listener so an orphaned future (refresh while pending) doesn't
    // log unhandled exceptions; FutureBuilder handles the live one's error
    f.then<void>((_) {}, onError: (_) {});
    return f;
  }

  void _onSaveTrigger() {
    final info = _info;
    if (info == null || _saving || _savedDate != null) return;
    _save(_date ?? info.date);
  }

  void _reload() {
    if (!mounted) return;
    setState(() {
      _future = _loadForm();
    });
    _loadMedia();
  }

  Future<void> _loadMedia() async {
    try {
      final (files, _, _, _) = await widget.api.mediaFiles();
      if (!mounted) return;
      setState(() => _allMedia = files);
    } catch (_) {
      // media strip is cosmetic — the form must still work without it
    }
  }

  Future<void> _pickDate(String current) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(current) ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked == null || !mounted) return;
    final date =
        '${picked.year.toString().padLeft(4, '0')}-'
        '${picked.month.toString().padLeft(2, '0')}-'
        '${picked.day.toString().padLeft(2, '0')}';
    if (date == current) return;
    setState(() {
      _date = date;
      _savedDate = null;
      for (final c in _answers.values) {
        c.clear();
      }
    });
  }

  @override
  void dispose() {
    widget.refreshSignal?.removeListener(_reload);
    widget.saveTrigger?.removeListener(_onSaveTrigger);
    for (final c in _answers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save(String date, {bool overwrite = false}) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    final answers = {
      for (final e in _answers.entries)
        if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim(),
    };
    try {
      await widget.api.createEntry(date, answers, overwrite: overwrite);
      if (!mounted) return;
      setState(() {
        _savedDate = date;
        _saving = false;
      });
    } on EntryExistsException {
      if (!mounted) return;
      setState(() => _saving = false);
      final overwriteIt = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Entry exists'),
          content: Text('A note for $date already exists. Overwrite it?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Overwrite'),
            ),
          ],
        ),
      );
      if (overwriteIt == true) await _save(date, overwrite: true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<FormInfo>(
      future: _future,
      builder: (context, snap) {
        if (snap.hasError) {
          final msg = '${snap.error}';
          final noQuestions = msg.contains('No questions configured');
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.help_outline_outlined,
                    size: 48,
                    color:
                        Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.4)),
                const SizedBox(height: 12),
                Text(
                  noQuestions
                      ? 'No questions configured yet.\nAdd them in Settings → Notes.'
                      : msg,
                  textAlign: TextAlign.center,
                ),
                if (noQuestions) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: widget.onOpenSettings,
                    icon: const Icon(Icons.settings_outlined),
                    label: const Text('Open settings'),
                  ),
                ],
              ],
            ),
          );
        }
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final info = snap.data!;
        _info = info;
        final selected = _date ?? info.date;
        final dayMedia = _allMedia.where((f) => f.date == selected).toList();
        if (_savedDate == selected) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.check_circle_outline,
                    size: 56, color: Colors.green),
                const SizedBox(height: 12),
                Text('Note saved for $_savedDate'),
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: () => setState(() {
                    _savedDate = null;
                    _date = null;
                    for (final c in _answers.values) {
                      c.clear();
                    }
                  }),
                  child: const Text('Write again'),
                ),
              ],
            ),
          );
        }
        for (final q in info.questions) {
          _answers.putIfAbsent(q.identifier, () => TextEditingController());
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Text(
                  selected,
                  style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.7)),
                ),
                IconButton(
                  icon: const Icon(Icons.calendar_month_outlined),
                  tooltip: 'Choose day',
                  onPressed: () => _pickDate(selected),
                ),
              ],
            ),
            if (dayMedia.isNotEmpty) ...[
              MediaStrip(api: widget.api, files: dayMedia),
              const SizedBox(height: 16),
            ],
            for (final q in info.questions) ...[
              Text(q.question,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              TextField(
                controller: _answers[q.identifier],
                minLines: 2,
                maxLines: 8,
                enabled: !_saving,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
            ],
            if (_saving) const LinearProgressIndicator(),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            ],
          ],
        );
      },
    );
  }
}
