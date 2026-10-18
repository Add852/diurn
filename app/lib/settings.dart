import 'dart:async';
import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';

/// Settings: three tabs (General / Notes / Account). One form state covers
/// all tabs; the shell's FAB triggers save via [saveTrigger].
class SettingsScreen extends StatefulWidget {
  final Api api;
  final VoidCallback? onChangeServer;
  final VoidCallback? onSaved;
  final ValueListenable<int>? saveTrigger;
  final ValueListenable<int>? refreshSignal;

  const SettingsScreen({
    super.key,
    required this.api,
    this.onChangeServer,
    this.onSaved,
    this.saveTrigger,
    this.refreshSignal,
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
            onChangeServer: widget.onChangeServer,
            saveTrigger: widget.saveTrigger,
            refreshSignal: widget.refreshSignal,
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
  final VoidCallback? onChangeServer;
  final ValueListenable<int>? saveTrigger;
  final ValueListenable<int>? refreshSignal;
  const _SettingsForm({
    required this.api,
    required this.data,
    this.onSaved,
    this.onChangeServer,
    this.saveTrigger,
    this.refreshSignal,
  });

  @override
  State<_SettingsForm> createState() => _SettingsFormState();
}

class _SettingsFormState extends State<_SettingsForm> {
  late final Map<String, dynamic> _profile;
  late List<Map<String, dynamic>> _questions;
  final _fields = <String, TextEditingController>{};
  final _tzFocus = FocusNode();
  late final TextEditingController _templateCtrl = TextEditingController(
    text: widget.data['template_content'] as String? ?? '',
  );
  bool _saving = false;
  String? _error;
  String? _savedFlash;
  Timer? _flashTimer;

  void _flash(String msg) {
    setState(() {
      _savedFlash = msg;
      _error = null;
    });
    _flashTimer?.cancel();
    _flashTimer = Timer(const Duration(seconds: 4), () {
      if (mounted) setState(() => _savedFlash = null);
    });
  }

  void _fail(String msg) {
    setState(() {
      _error = msg;
      _savedFlash = null;
    });
    _flashTimer?.cancel();
    _flashTimer = Timer(const Duration(seconds: 6), () {
      if (mounted) setState(() => _error = null);
    });
  }

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
    widget.saveTrigger?.addListener(_save);
    widget.refreshSignal?.addListener(_discardDraft);
  }

  /// Leaving the tab (or a save) reloads from the server — unsaved drafts
  /// don't survive navigation.
  Future<void> _discardDraft() async {
    final fresh = await widget.api.settings();
    if (!mounted) return;
    setState(() {
      _applyFresh(fresh);
      _error = null;
      _savedFlash = null;
    });
  }

  void _applyFresh(Map<String, dynamic> fresh) {
    _profile.clear();
    _profile.addAll(fresh['profile'] as Map<String, dynamic>);
    _questions = (fresh['questions'] as List)
        .cast<Map<String, dynamic>>()
        .map(Map<String, dynamic>.from)
        .toList();
    _templateCtrl.text = fresh['template_content'] as String? ?? '';
    final freshProfile = _profile;
    for (final key in _fields.keys.toList()) {
      _fields[key]!.text = '${freshProfile[key] ?? ''}';
    }
  }

  @override
  void dispose() {
    for (final c in _fields.values) {
      c.dispose();
    }
    _tzFocus.dispose();
    _templateCtrl.dispose();
    _flashTimer?.cancel();
    widget.saveTrigger?.removeListener(_save);
    widget.refreshSignal?.removeListener(_discardDraft);
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
      _savedFlash = null;
    });
    final profile = {
      'name': _profile['name'],
      'daily_note_folder': _txt('daily_note_folder'),
      'template_note_path': _txt('template_note_path'),
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
      _flash('Settings saved');
      widget.onSaved?.call();
    } catch (e) {
      if (!mounted) return;
      _fail('$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveAccount() async {
    final username = _txt('accountUsername');
    final password = _txt('accountPassword');
    if (username.isEmpty && password.isEmpty) {
      _fail('Nothing to update — enter a username or new password');
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.updateAccount(
        username.isEmpty ? null : username,
        password.isEmpty ? null : password,
      );
      if (!mounted) return;
      _flash('Account updated');
      _fields['accountPassword']?.clear();
    } catch (e) {
      if (!mounted) return;
      _fail('$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _exportSettings() async {
    try {
      final data = await widget.api.settings();
      final json = const JsonEncoder.withIndent('  ').convert(data);
      final location = await getSaveLocation(suggestedName: 'diurn-settings.json');
      if (location == null) return; // cancelled
      await XFile.fromData(utf8.encode(json), mimeType: 'application/json')
          .saveTo(location.path);
      if (!mounted) return;
      _flash('Exported to ${location.path}');
    } catch (e) {
      // picker unsupported (some platforms) -> clipboard fallback
      if (!mounted) return;
      final data = await widget.api.settings();
      await Clipboard.setData(ClipboardData(
          text: const JsonEncoder.withIndent('  ').convert(data)));
      if (!mounted) return;
      _flash('File picker unavailable — JSON copied to clipboard ($e)');
    }
  }

  Future<void> _importSettings() async {
    const typeGroup = XTypeGroup(label: 'JSON', extensions: ['json']);
    final picked = await openFile(acceptedTypeGroups: [typeGroup]);
    if (picked == null) return; // cancelled
    final text = await picked.readAsString();
    await _applyImport(text);
  }

  Future<void> _importFromDialog() async {
    final text = await showDialog<String>(
      context: context,
      builder: (context) {
        final ctrl = TextEditingController();
        return AlertDialog(
          title: const Text('Import settings'),
          content: TextField(
            controller: ctrl,
            maxLines: 8,
            autocorrect: false,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'Paste the exported settings JSON',
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(context, ctrl.text),
                child: const Text('Import')),
          ],
        );
      },
    );
    if (text == null || text.trim().isEmpty) return;
    await _applyImport(text);
  }

  Future<void> _applyImport(String text) async {
    Map<String, dynamic> incoming;
    try {
      incoming = jsonDecode(text) as Map<String, dynamic>;
    } catch (e) {
      _fail('Invalid JSON: $e');
      return;
    }
    try {
      final profile = (incoming['profile'] as Map?)?.cast<String, dynamic>();
      final questions = (incoming['questions'] as List?)
          ?.cast<Map<String, dynamic>>()
          .map(Map<String, dynamic>.from)
          .toList();
      await widget.api.saveSettings(
        profile ?? {},
        questions ?? [],
        templateContent: incoming['template_content'] as String?,
      );
      if (!mounted) return;
      _flash('Imported — fields refreshed');
      await _discardDraft();
    } catch (e) {
      if (!mounted) return;
      _fail('$e');
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
    if (picked == null) return;
    setState(() => _fields[key]?.text = picked);
    if (key == 'template_note_path') await _loadTemplate(picked);
  }

  Future<void> _loadTemplate(String path) async {
    if (path.isEmpty) return;
    try {
      final content = await widget.api.templateContent(path);
      if (!mounted) return;
      setState(() => _templateCtrl.text = content);
    } catch (_) {
      // unreadable file: keep the editor as-is; save will surface the error
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (_error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          ),
        if (_savedFlash != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(_savedFlash!,
                style: const TextStyle(color: Colors.greenAccent)),
          ),
        Expanded(
          child: DefaultTabController(
            length: 3,
            child: Column(
              children: [
                const TabBar(
                  tabs: [
                    Tab(text: 'General'),
                    Tab(text: 'Notes'),
                    Tab(text: 'Account'),
                  ],
                ),
                Expanded(
                  child: TabBarView(
                    children: [_generalTab(), _notesTab(), _accountTab()],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _generalTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _section('Folders'),
        _pathField('Daily note folder', 'daily_note_folder', pickFile: false),
        _pathField('Media library folder', 'media_folder', pickFile: false),
        const SizedBox(height: 16),
        _section('General'),
        _tzField('Timezone', 'timezone'),
        _textField('Day offset hours (0-24)', 'day_offset_hours',
            number: true),
      ],
    );
  }

  Widget _notesTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
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
        const SizedBox(height: 20),
        _section('Note template'),
        _pathField('Template note (.md)', 'template_note_path',
            pickFile: true),
        if (_txt('template_note_path').isNotEmpty) ...[
          Row(
            children: [
              const Expanded(
                child: Text('Template content',
                    style:
                        TextStyle(fontSize: 13, color: Colors.white70)),
              ),
              IconButton(
                icon: const Icon(Icons.refresh, size: 20),
                tooltip: 'Reload from file',
                onPressed: () => _loadTemplate(_txt('template_note_path')),
              ),
            ],
          ),
          const SizedBox(height: 6),
          TextFormField(
            controller: _templateCtrl,
            minLines: 6,
            maxLines: 16,
            style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
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
      ],
    );
  }

  Widget _accountTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _section('Admin account'),
        _textField('Username', 'accountUsername'),
        _textField('New password (min 4, empty = keep)', 'accountPassword',
            obscure: true),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _saving ? null : _saveAccount,
          icon: const Icon(Icons.key_outlined),
          label: const Text('Update account'),
        ),
        const SizedBox(height: 20),
        _section('Server'),
        ListTile(
          leading: const Icon(Icons.dns_outlined),
          title: const Text('Change server'),
          subtitle: Text(kDefaultUrl, style: const TextStyle(fontSize: 12)),
          onTap: () => widget.onChangeServer?.call(),
        ),
        const SizedBox(height: 20),
        _section('Import / export'),
        ListTile(
          leading: const Icon(Icons.copy_outlined),
          title: const Text('Export settings'),
          subtitle: const Text('Copies all settings as JSON to the clipboard',
              style: TextStyle(fontSize: 12)),
          onTap: _exportSettings,
        ),
        ListTile(
          leading: const Icon(Icons.file_open_outlined),
          title: const Text('Import from file'),
          subtitle: const Text('Pick a previously exported settings JSON',
              style: TextStyle(fontSize: 12)),
          onTap: _importSettings,
        ),
        ListTile(
          leading: const Icon(Icons.paste_outlined),
          title: const Text('Import pasted JSON'),
          subtitle: const Text('Paste settings JSON manually',
              style: TextStyle(fontSize: 12)),
          onTap: _importFromDialog,
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

  Widget _textField(String label, String key,
      {bool obscure = false, bool number = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: _ctrl(key),
        obscureText: obscure,
        keyboardType: number ? TextInputType.number : null,
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
            icon: Icon(
                pickFile ? Icons.description_outlined : Icons.folder_open),
            tooltip: pickFile ? 'Browse server files' : 'Browse server folders',
            onPressed: () => _pickPath(key, pickFile: pickFile),
          ),
        ],
      ),
    );
  }

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
  State<ServerPathPickerDialog> createState() =>
      _ServerPathPickerDialogState();
}

class _ServerPathPickerDialogState extends State<ServerPathPickerDialog> {
  late String _dir;
  late Future<List<FsEntry>> _future;
  String? _selectedFile;

  @override
  void initState() {
    super.initState();
    _dir = widget.initial.isEmpty ? '' : (widget.pickFile
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
              ? (_selectedFile == null
                  ? null
                  : () => Navigator.pop(context, _selectedFile))
              : () => Navigator.pop(context, _dir),
          child: Text(widget.pickFile ? 'Use file' : 'Use folder'),
        ),
      ],
    );
  }
}
