import 'package:flutter/material.dart';

import 'api.dart';

/// Today tab: the no-AI form interface (GET /api/form + POST /api/entries).
/// Verbatim answers -> server renders the template -> {date}.md.
class FormScreen extends StatefulWidget {
  final Api api;
  const FormScreen({super.key, required this.api});

  @override
  State<FormScreen> createState() => _FormScreenState();
}

class _FormScreenState extends State<FormScreen> {
  late final Future<FormInfo> _future;
  final _answers = <String, TextEditingController>{};
  bool _saving = false;
  String? _error;
  String? _savedDate;

  @override
  void initState() {
    super.initState();
    _future = widget.api.form();
  }

  @override
  void dispose() {
    for (final c in _answers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save(FormInfo info, {bool overwrite = false}) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    final answers = {
      for (final e in _answers.entries)
        if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim(),
    };
    try {
      await widget.api.createEntry(info.date, answers, overwrite: overwrite);
      if (!mounted) return;
      setState(() {
        _savedDate = info.date;
        _saving = false;
      });
    } on EntryExistsException {
      if (!mounted) return;
      setState(() => _saving = false);
      final overwriteIt = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Entry exists'),
          content: Text('A note for ${info.date} already exists. Overwrite it?'),
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
      if (overwriteIt == true) await _save(info, overwrite: true);
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
        if (snap.hasError) return Center(child: Text('${snap.error}'));
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final info = snap.data!;
        if (_savedDate == info.date) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.check_circle_outline,
                    size: 56, color: Colors.green),
                const SizedBox(height: 12),
                Text('Note saved for ${info.date}'),
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: () => setState(() {
                    _savedDate = null;
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
            Text(
              info.date,
              style: const TextStyle(
                  fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white70),
            ),
            const SizedBox(height: 16),
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
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: Colors.redAccent)),
              const SizedBox(height: 12),
            ],
            _saving
                ? const Center(child: CircularProgressIndicator())
                : FilledButton.icon(
                    onPressed: () => _save(info),
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('Save note'),
                  ),
          ],
        );
      },
    );
  }
}
