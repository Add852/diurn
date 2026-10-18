import 'package:flutter/material.dart';

import 'api.dart';

/// Settings screen: the no-AI slice of the old settings page — folders,
/// general (tz/day offset), and journal questions. Server validates paths
/// and preserves question ids across saves (entry_answers FKs).
class SettingsScreen extends StatefulWidget {
  final Api api;

  /// Escape hatch: forget this server (reopens the connect form).
  final VoidCallback? onChangeServer;

  /// Called after a successful save so the shell can refresh cached roots.
  final VoidCallback? onSaved;

  const SettingsScreen({
    super.key,
    required this.api,
    this.onChangeServer,
    this.onSaved,
  });

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
              onPressed: () {
                // pop first so the connect form is actually visible
                Navigator.of(context).pop();
                widget.onChangeServer!();
              },
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
          return _SettingsForm(
            api: widget.api,
            data: snap.data!,
            onSaved: widget.onSaved,
          );
        },
      ),
    );
  }
}

class _SettingsForm extends StatefulWidget {
  final Api api;
  final Map<String, dynamic> data;
  final VoidCallback? onSaved;
  const _SettingsForm({required this.api, required this.data, this.onSaved});

  @override
  State<_SettingsForm> createState() => _SettingsFormState();
}

class _SettingsFormState extends State<_SettingsForm> {
  // Server sends snake_case; keep those keys verbatim to avoid round-trip bugs.
  late final Map<String, dynamic> _profile;
  late List<Map<String, dynamic>> _questions;
  final _fields = <String, TextEditingController>{};
  final _tzFocus = FocusNode();
  late final TextEditingController _templateCtrl =
      TextEditingController(text: widget.data['template_content'] as String? ?? '');
  bool _saving = false;
  String? _error;
  String? _savedFlash;

  TextEditingController _ctrl(String key) =>
      _fields.putIfAbsent(key, () => TextEditingController(
            text: '${_profile[key] ?? ''}',
          ));

  String _txt(String key) => _fields[key]?.text ?? '${_profile[key] ?? ''}';

  @override
  void initState() {
    super.initState();
    _profile = Map<String, dynamic>.from(widget.data['profile'] as Map);
    _questions = (widget.data['questions'] as List)
        .cast<Map<String, dynamic>>()
        .map(Map<String, dynamic>.from)
        .toList();
  }

  @override
  void dispose() {
    for (final c in _fields.values) {
      c.dispose();
    }
    _tzFocus.dispose();
    _templateCtrl.dispose();
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
      'daily_note_folder': _txt('daily_note_folder'),
      'template_note_path': _txt('template_note_path'),
      'media_enabled': _profile['media_enabled'],
      'media_folder': _txt('media_folder'),
      'timezone': _txt('timezone'),
      'day_offset_hours': int.tryParse(_txt('day_offset_hours')) ?? 0,
    };
    try {
      await widget.api.saveSettings(
        profile,
        _questions,
        templateContent: _templateCtrl.text,
      );
      if (!mounted) return;
      setState(() => _savedFlash = 'Saved');
      widget.onSaved?.call();
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

  Future<void> _saveAccount() async {
    final username = _txt('accountUsername');
    final password = _txt('accountPassword');
    if (username.isEmpty && password.isEmpty) {
      setState(() => _error = 'Nothing to update — enter a username or new password');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
      _savedFlash = null;
    });
    try {
      await widget.api.updateAccount(
        username.isEmpty ? null : username,
        password.isEmpty ? null : password,
      );
      if (!mounted) return;
      setState(() {
        _savedFlash = 'Account updated';
        _fields['accountPassword']?.clear();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickPath(String key, {required bool pickFile}) async {
    final current = _txt(key);
    final picked = await showDialog<String>(
      context: context,
      builder: (_) => ServerPathPickerDialog(
        api: widget.api,
        pickFile: pickFile,
        initial: current,
      ),
    );
    if (picked != null) {
      setState(() => _fields[key]?.text = picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _section('Folders'),
        _pathField('Daily note folder', 'daily_note_folder', pickFile: false),
        Row(
          children: [
            const Expanded(child: Text('Media library enabled')),
            Switch(
              value: _profile['media_enabled'] == true,
              onChanged: (v) => setState(() => _profile['media_enabled'] = v),
            ),
          ],
        ),
        if (_profile['media_enabled'] == true)
          _pathField('Media folder', 'media_folder', pickFile: false),
        _pathField('Template note (.md)', 'template_note_path', pickFile: true),
        if ((_txt('template_note_path')).isNotEmpty) ...[
          const Text('Template content',
              style: TextStyle(fontSize: 13, color: Colors.white70)),
          const SizedBox(height: 6),
          TextFormField(
            controller: _templateCtrl,
            minLines: 6,
            maxLines: 16,
            style: const TextStyle(
                fontSize: 12, fontFamily: 'monospace'),
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'Markdown template — {Q1.answer}, \$date("dddd") …',
            ),
          ),
        ] else
          const Text(
            'Set a template note path above to edit the template.',
            style: TextStyle(fontSize: 12, color: Colors.white38),
          ),
        const SizedBox(height: 16),
        _section('General'),
        _tzField('Timezone', 'timezone'),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextFormField(
            controller: _ctrl('day_offset_hours'),
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'Day offset hours (0-24)',
              isDense: true,
            ),
          ),
        ),
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
        const SizedBox(height: 16),
        _section('Account'),
        _textField('Username', 'accountUsername'),
        _textField('New password (min 4, empty = keep)', 'accountPassword'),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _saving ? null : _saveAccount,
          icon: const Icon(Icons.key_outlined),
          label: const Text('Update account'),
        ),
        const SizedBox(height: 24),
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          const SizedBox(height: 12),
        ],
        if (_savedFlash != null) ...[
          Text(_savedFlash!, style: const TextStyle(color: Colors.greenAccent)),
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

  Widget _textField(String label, String key) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: _ctrl(key),
        obscureText: key == 'accountPassword',
        decoration: InputDecoration(
          border: const OutlineInputBorder(),
          labelText: label,
          isDense: true,
        ),
      ),
    );
  }

  Widget _pathField(String label, String key, {required bool pickFile}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextFormField(
              controller: _ctrl(key),
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                labelText: label,
                isDense: true,
              ),
            ),
          ),
          IconButton(
            icon: Icon(pickFile ? Icons.description_outlined : Icons.folder_open),
            tooltip: pickFile ? 'Browse server files' : 'Browse server folders',
            onPressed: () => _pickPath(key, pickFile: pickFile),
          ),
        ],
      ),
    );
  }

  /// IANA zone autocomplete — type to filter; curated common list, any value
  /// accepted (server falls back to UTC date when unknown).
  Widget _tzField(String label, String key) {
    const zones = [
      'UTC', 'Europe/Helsinki', 'Europe/Stockholm', 'Europe/Berlin',
      'Europe/Paris', 'Europe/London', 'Europe/Madrid', 'Europe/Rome',
      'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
      'America/New_York', 'America/Chicago', 'America/Denver',
      'America/Los_Angeles', 'America/Phoenix', 'America/Toronto',
      'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
      'America/Argentina/Buenos_Aires', 'Asia/Tokyo', 'Asia/Seoul',
      'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Bangkok',
      'Asia/Kolkata', 'Asia/Dubai', 'Asia/Jerusalem', 'Australia/Sydney',
      'Australia/Melbourne', 'Australia/Perth', 'Pacific/Auckland',
      'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
    ];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: RawAutocomplete<String>(
        textEditingController: _ctrl(key),
        focusNode: _tzFocus,
        optionsBuilder: (TextEditingValue v) => zones.where(
          (z) => z.toLowerCase().contains(v.text.toLowerCase()),
        ),
        fieldViewBuilder: (context, ctrl, focus, onSubmit) => TextFormField(
          controller: ctrl,
          focusNode: focus,
          onFieldSubmitted: (_) => onSubmit(),
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            labelText: label,
            isDense: true,
          ),
        ),
        optionsViewBuilder: (context, onSelected, options) => Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            color: const Color(0xff27272a),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 240, maxWidth: 340),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final z in options)
                    ListTile(
                      dense: true,
                      title: Text(z, style: const TextStyle(fontSize: 13)),
                      onTap: () => onSelected(z),
                    ),
                ],
              ),
            ),
          ),
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
                decoration: const InputDecoration(labelText: 'Question text'),
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

/// Server-side path picker over /api/fs. Native OS pickers browse the phone's
/// storage — these folders live on the server, so browse server dirs instead
/// (same approach as the old settings autocomplete).
class ServerPathPickerDialog extends StatefulWidget {
  final Api api;
  final bool pickFile;
  final String initial;
  const ServerPathPickerDialog({
    super.key,
    required this.api,
    required this.pickFile,
    required this.initial,
  });

  @override
  State<ServerPathPickerDialog> createState() => _ServerPathPickerDialogState();
}

class _ServerPathPickerDialogState extends State<ServerPathPickerDialog> {
  late String _dir;
  late Future<List<FsEntry>> _future;
  String? _selectedFile;
  String? _error;

  @override
  void initState() {
    super.initState();
    _dir = widget.initial.isEmpty
        ? ''
        : (widget.pickFile
            ? _parentOf(widget.initial)
            : widget.initial);
    _load();
  }

  static String _parentOf(String p) {
    final i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.substring(0, i);
  }

  void _load() {
    setState(() {
      _error = null;
      _selectedFile = null;
      _future = _loadOrRoot();
    });
  }

  Future<List<FsEntry>> _loadOrRoot() async {
    try {
      if (_dir.isEmpty) {
        final roots = await widget.api.config();
        if (roots.isEmpty) throw ApiException('No roots configured');
        _dir = roots.first;
      }
      return await widget.api.listDir(_dir);
    } catch (e) {
      _error = '$e';
      rethrow;
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.pickFile ? 'Pick template note' : 'Pick folder'),
      content: SizedBox(
        width: 420,
        height: 420,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_upward),
                  onPressed: _dir.isEmpty || _dir == '/'
                      ? null
                      : () {
                          _dir = _parentOf(_dir);
                          _load();
                        },
                ),
                Expanded(
                  child: Text(
                    _dir,
                    style: const TextStyle(fontSize: 12),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            Expanded(
              child: FutureBuilder<List<FsEntry>>(
                future: _future,
                builder: (context, snap) {
                  if (_error != null) {
                    return Center(child: Text(_error!));
                  }
                  if (snap.hasError) {
                    return Center(child: Text('${snap.error}'));
                  }
                  if (!snap.hasData) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final entries = snap.data!;
                  final dirs = entries.where((e) => e.isDir).toList();
                  final files = widget.pickFile
                      ? entries
                          .where((e) =>
                              !e.isDir &&
                              e.path.toLowerCase().endsWith('.md'))
                          .toList()
                      : const <FsEntry>[];
                  if (dirs.isEmpty && files.isEmpty) {
                    return const Center(child: Text('Empty'));
                  }
                  return ListView(
                    children: [
                      for (final d in dirs)
                        ListTile(
                          dense: true,
                          leading: const Icon(Icons.folder_outlined),
                          title: Text(d.name),
                          onTap: () {
                            _dir = d.path;
                            _load();
                          },
                        ),
                      for (final f in files)
                        ListTile(
                          dense: true,
                          leading: const Icon(Icons.description_outlined),
                          title: Text(f.name),
                          selected: _selectedFile == f.path,
                          onTap: () => setState(() => _selectedFile = f.path),
                        ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: widget.pickFile
              ? (_selectedFile == null ? null : () => Navigator.pop(context, _selectedFile))
              : () => Navigator.pop(context, _dir),
          child: Text(widget.pickFile ? 'Use file' : 'Use folder'),
        ),
      ],
    );
  }
}
