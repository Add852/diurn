import 'package:flutter/material.dart';

import 'api.dart';

/// Settings screen: the no-AI slice of the old settings page — folders,
/// general (tz/day offset), and journal questions. Server validates paths
/// and preserves question ids across saves (entry_answers FKs).
class SettingsScreen extends StatefulWidget {
  final Api api;

  /// Optional escape hatch: forget this server (reopens the connect form).
  final VoidCallback? onChangeServer;
  const SettingsScreen({super.key, required this.api, this.onChangeServer});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.api.settings();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: [
          if (widget.onChangeServer != null)
            IconButton(
              icon: const Icon(Icons.dns_outlined),
              tooltip: 'Change server',
              onPressed: widget.onChangeServer,
            ),
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          return _SettingsForm(api: widget.api, data: snap.data!);
        },
      ),
    );
  }
}

class _SettingsForm extends StatefulWidget {
  final Api api;
  final Map<String, dynamic> data;
  const _SettingsForm({required this.api, required this.data});

  @override
  State<_SettingsForm> createState() => _SettingsFormState();
}

class _SettingsFormState extends State<_SettingsForm> {
  late final Map<String, dynamic> _profile;
  late List<Map<String, dynamic>> _questions;
  late final List<TextEditingController> _controllers = [];
  bool _saving = false;
  String? _error;
  String? _savedFlash;

  @override
  void initState() {
    super.initState();
    _profile = Map<String, dynamic>.from(widget.data['profile'] as Map);
    _questions = (widget.data['questions'] as List)
        .cast<Map<String, dynamic>>()
        .map(Map<String, dynamic>.from)
        .toList();
    // seed draft values so untouched fields save back unchanged
    for (final k in [
      'dailyNoteFolder',
      'templateNotePath',
      'mediaFolder',
      'timezone',
      'dayOffsetHours',
    ]) {
      if (_profile[k] != null) _fieldValues[k] = '${_profile[k]}';
    }
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
      _savedFlash = null;
    });
    final profile = {
      'name': _profile['name'],
      'daily_note_folder': _txt('dailyNoteFolder'),
      'template_note_path': _txt('templateNotePath'),
      'media_enabled': _profile['mediaEnabled'],
      'media_folder': _txt('mediaFolder'),
      'timezone': _txt('timezone'),
      'day_offset_hours': int.tryParse(_txt('dayOffsetHours')) ?? 0,
    };
    try {
      await widget.api.saveSettings(profile, _questions);
      if (!mounted) return;
      setState(() => _savedFlash = 'Saved');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _savedFlash = null;
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  final Map<String, String> _fieldValues = {};
  String _txt(String key) => _fieldValues[key] ?? '';

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _section('Folders'),
        _folderField('Daily note folder', 'dailyNoteFolder',
            _profile['dailyNoteFolder']),
        Row(
          children: [
            const Expanded(child: Text('Media library enabled')),
            Switch(
              value: _profile['mediaEnabled'] == true,
              onChanged: (v) => setState(() => _profile['mediaEnabled'] = v),
            ),
          ],
        ),
        if (_profile['mediaEnabled'] == true)
          _folderField('Media folder', 'mediaFolder', _profile['mediaFolder']),
        _folderField(
            'Template note (.md)', 'templateNotePath', _profile['templateNotePath']),
        const SizedBox(height: 16),
        _section('General'),
        _folderField('Timezone (e.g. Europe/Helsinki)', 'timezone',
            _profile['timezone']),
        _folderField(
            'Day offset hours (0-24)', 'dayOffsetHours', _profile['dayOffsetHours']),
        const SizedBox(height: 16),
        _section('Journal questions'),
        for (var i = 0; i < _questions.length; i++)
          Card(
            color: const Color(0xff18181b),
            child: ListTile(
              title: Text(_questions[i]['question'] as String? ?? ''),
              subtitle: Text(
                '${_questions[i]['identifier']} · ${_questions[i]['asked'] == true ? 'asked' : 'hidden (AI-only)'}',
                style: const TextStyle(fontSize: 12),
              ),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () => setState(() => _questions.removeAt(i)),
              ),
              onTap: () => _editQuestion(i),
            ),
          ),
        OutlinedButton.icon(
          onPressed: _addQuestion,
          icon: const Icon(Icons.add),
          label: const Text('Add question'),
        ),
        const SizedBox(height: 24),
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          const SizedBox(height: 12),
        ],
        if (_savedFlash != null) ...[
          Text(_savedFlash!,
              style: const TextStyle(color: Colors.greenAccent)),
          const SizedBox(height: 12),
        ],
        _saving
            ? const Center(child: CircularProgressIndicator())
            : FilledButton.icon(
                onPressed: _save,
                icon: const Icon(Icons.save_outlined),
                label: const Text('Save settings'),
              ),
      ],
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          title,
          style: const TextStyle(
              fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white70),
        ),
      );

  Widget _folderField(String label, String key, dynamic initial) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        initialValue: initial?.toString() ?? '',
        onChanged: (v) => _fieldValues[key] = v,
        decoration: InputDecoration(
          border: const OutlineInputBorder(),
          labelText: label,
          isDense: true,
        ),
      ),
    );
  }

  Future<void> _editQuestion(int i) async {
    final q = Map<String, dynamic>.from(_questions[i]);
    final qCtrl = TextEditingController(text: q['question'] as String? ?? '');
    bool asked = q['asked'] == true;
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialog) => AlertDialog(
          title: Text('Edit ${q['identifier']}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: qCtrl,
                decoration:
                    const InputDecoration(labelText: 'Question text'),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Expanded(child: Text('Ask in form')),
                  Switch(
                    value: asked,
                    onChanged: (v) => setDialog(() => asked = v),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, {
                ...q,
                'question': qCtrl.text.trim(),
                'asked': asked,
              }),
              child: const Text('Done'),
            ),
          ],
        ),
      ),
    );
    if (result != null) setState(() => _questions[i] = result);
  }

  Future<void> _addQuestion() async {
    final idCtrl = TextEditingController();
    final qCtrl = TextEditingController();
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add question'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: idCtrl,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'Variable name',
                hintText: 'Q3 — used as {Q3.answer} in the template',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: qCtrl,
              decoration: const InputDecoration(labelText: 'Question text'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, {
              'identifier': idCtrl.text.trim(),
              'question': qCtrl.text.trim(),
              'asked': true,
              'answer_prompt': '',
              'sort_order': _questions.length,
            }),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (result != null &&
        (result['identifier'] as String).isNotEmpty &&
        (result['question'] as String).isNotEmpty) {
      setState(() => _questions.add(result));
    }
  }
}
