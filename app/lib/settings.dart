import 'dart:async';
import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import 'api.dart';
import 'widgets/server_path_picker.dart';
import 'widgets/timezone_field.dart';

/// Settings: three tabs (General / Notes / Account). One form state covers
/// all tabs; the shell's FAB triggers save via [saveTrigger].
class SettingsScreen extends StatefulWidget {
  final Api api;
  final VoidCallback? onChangeServer;

  /// Called with the new (username, password) after account update/reset.
  final void Function(String? username, String? password)? onCredentialsChanged;

  /// Called with the saved profile after a settings save (theme + accent).
  final void Function(Map<String, dynamic> profile)? onAppearanceChanged;

  /// True while the form has unsaved changes — the shell asks before
  /// navigating away.
  final ValueNotifier<bool>? dirtyNotifier;
  final VoidCallback? onSaved;
  final ValueListenable<int>? saveTrigger;
  final ValueListenable<int>? refreshSignal;

  const SettingsScreen({
    super.key,
    required this.api,
    this.onChangeServer,
    this.onCredentialsChanged,
    this.onAppearanceChanged,
    this.dirtyNotifier,
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
    // pane of the main shell — no Scaffold/AppBar of its own
    return FutureBuilder<Map<String, dynamic>>(
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
          onCredentialsChanged: widget.onCredentialsChanged,
          onAppearanceChanged: widget.onAppearanceChanged,
          dirtyNotifier: widget.dirtyNotifier,
          saveTrigger: widget.saveTrigger,
          refreshSignal: widget.refreshSignal,
        );
      },
    );
  }
}

class _SettingsForm extends StatefulWidget {
  final Api api;
  final Map<String, dynamic> data;
  final VoidCallback? onSaved;
  final VoidCallback? onChangeServer;
  final void Function(String? username, String? password)? onCredentialsChanged;
  final void Function(Map<String, dynamic> profile)? onAppearanceChanged;
  final ValueNotifier<bool>? dirtyNotifier;
  final ValueListenable<int>? saveTrigger;
  final ValueListenable<int>? refreshSignal;
  const _SettingsForm({
    required this.api,
    required this.data,
    this.onSaved,
    this.onChangeServer,
    this.onCredentialsChanged,
    this.onAppearanceChanged,
    this.dirtyNotifier,
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
  late final TextEditingController _templateCtrl = TextEditingController(
    text: widget.data['template_content'] as String? ?? '',
  )..addListener(() => _setDirty(true));
  late final TextEditingController _usernameCtrl = TextEditingController(
    text: (widget.data['user'] as Map?)?['username'] as String? ?? 'admin',
  );
  bool _saving = false;
  String? _error;
  String? _savedFlash;
  Timer? _flashTimer;

  /// suppresses dirty-marking while server values are loaded into fields
  bool _applyingFresh = false;

  void _setDirty(bool v) {
    if (_applyingFresh) return;
    widget.dirtyNotifier?.value = v;
  }

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

  TextEditingController _ctrl(String key) => _fields.putIfAbsent(key, () {
    final c = TextEditingController(text: '${_profile[key] ?? ''}');
    c.addListener(() => _setDirty(true));
    return c;
  });

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
    _applyingFresh = true;
    _setDirty(false);
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
    _applyingFresh = false;
  }

  @override
  void dispose() {
    for (final c in _fields.values) {
      c.dispose();
    }
    _templateCtrl.dispose();
    _usernameCtrl.dispose();
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
      'theme_mode': _profile['theme_mode'] ?? 'system',
      'accent_color': _profile['accent_color'] ?? '#22c55e',
    };
    try {
      await widget.api.saveSettings(
        profile,
        _questions,
        templateContent: _templateCtrl.text,
      );
      if (!mounted) return;
      _setDirty(false);
      _flash('Settings saved');
      widget.onSaved?.call();
      widget.onAppearanceChanged?.call(profile);
    } catch (e) {
      if (!mounted) return;
      _fail('$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _clearMediaCache() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear media cache?'),
        content: const Text(
            'Removes cached media entries and generated thumbnails. Journal '
            'notes and the original files are untouched — everything '
            're-indexes on the next visit to the Media tab.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Clear')),
        ],
      ),
    );
    if (yes != true) return;
    setState(() => _saving = true);
    try {
      final n = await widget.api.clearMediaCache();
      if (!mounted) return;
      _flash('Cleared $n cached media entries');
    } catch (e) {
      if (!mounted) return;
      _fail('$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveAccount() async {
    final username = _usernameCtrl.text;
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
      // the shell must send the new credentials from now on
      widget.onCredentialsChanged?.call(
        username.isEmpty ? null : username,
        password.isEmpty ? null : password,
      );
    } catch (e) {
      if (!mounted) return;
      _fail('$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _restoreDefaults() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Restore defaults?'),
        content: const Text(
          'This resets every setting (folders, questions, template) and the '
          'admin account to admin / root. Journal entries and files are '
          'kept. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Restore'),
          ),
        ],
      ),
    );
    if (yes != true) return;
    setState(() => _saving = true);
    try {
      await widget.api.resetDefaults();
      if (!mounted) return;
      widget.onCredentialsChanged?.call('admin', 'root');
      _flash('Defaults restored');
      await _discardDraft();
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
      if (defaultTargetPlatform == TargetPlatform.android) {
        // Android has no system save dialog — hand the file to the share
        // sheet ("Save to Files", Drive, or any target app).
        final result = await SharePlus.instance.share(
          ShareParams(
            files: [
              XFile.fromData(
                utf8.encode(json),
                mimeType: 'application/json',
                name: 'diurn-settings.json',
              ),
            ],
            subject: 'diurn settings',
          ),
        );
        if (!mounted) return;
        _flash(result.status == ShareResultStatus.success
            ? 'Exported via share sheet'
            : 'Share dismissed');
        return;
      }
      final location = await getSaveLocation(
        suggestedName: 'diurn-settings.json',
      );
      if (location == null) return; // cancelled
      await XFile.fromData(
        utf8.encode(json),
        mimeType: 'application/json',
      ).saveTo(location.path);
      if (!mounted) return;
      _flash('Exported to ${location.path}');
    } catch (e) {
      // picker unsupported (some platforms) -> clipboard fallback
      if (!mounted) return;
      final data = await widget.api.settings();
      await Clipboard.setData(
        ClipboardData(text: const JsonEncoder.withIndent('  ').convert(data)),
      );
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

  Future<void> _applyImport(String text) async {
    Map<String, dynamic> incoming;
    try {
      incoming = jsonDecode(text) as Map<String, dynamic>;
    } catch (e) {
      _fail('Invalid JSON: $e');
      return;
    }
    final profile =
        (incoming['profile'] as Map?)?.cast<String, dynamic>() ?? {};
    final questions = (incoming['questions'] as List?)
            ?.cast<Map<String, dynamic>>()
            .map(Map<String, dynamic>.from)
            .toList() ??
        [];
    final templateContent = incoming['template_content'] as String?;
    final templatePath = profile['template_note_path'] as String? ?? '';

    // Staged import: path-independent fields always apply; folders and the
    // template are best-effort because they may not exist on this server.
    final applied = <String>[];
    final skipped = <String>[];

    // 1. questions + safe profile fields (no paths involved)
    try {
      final safe = <String, dynamic>{
        if (profile['name'] != null) 'name': profile['name'],
        if (profile['timezone'] != null) 'timezone': profile['timezone'],
        if (profile['day_offset_hours'] != null)
          'day_offset_hours': profile['day_offset_hours'],
        if (profile['theme_mode'] != null) 'theme_mode': profile['theme_mode'],
        if (profile['accent_color'] != null)
          'accent_color': profile['accent_color'],
      };
      await widget.api.saveSettings(safe, questions);
      applied.addAll([
        'questions',
        for (final k in [
          'name',
          'timezone',
          'day_offset_hours',
          'theme_mode',
          'accent_color',
        ])
          if (safe[k] != null) k,
      ]);
    } catch (e) {
      if (!mounted) return;
      _fail('Import failed: $e');
      return;
    }

    // 2. folders (daily note + media) — kept out of stage 1 so a missing
    // folder can't block the fields above
    if ((profile['daily_note_folder'] as String? ?? '').isNotEmpty ||
        (profile['media_folder'] as String? ?? '').isNotEmpty) {
      try {
        await widget.api.saveSettings({
          ...profile,
          'template_note_path': '',
        }, questions);
        applied.add('folders');
      } catch (e) {
        skipped.add('folders — $e');
      }
    }

    // 3. template path + content in one save (the server creates the file
    // when the parent folder exists)
    if (templatePath.isNotEmpty ||
        (templateContent != null && templateContent.isNotEmpty)) {
      try {
        await widget.api.saveSettings(
          {...profile, 'template_note_path': templatePath},
          questions,
          templateContent: templateContent,
        );
        applied.add('template');
      } catch (e) {
        skipped.add('template — $e');
      }
    }

    if (!mounted) return;
    _flash('Imported: ${applied.join(', ')}'
        '${skipped.isEmpty ? '' : '\nSkipped: ${skipped.join(' | ')}'}');
    await _discardDraft();
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
            child: Text(
              _error!,
              style: const TextStyle(color: Colors.redAccent),
            ),
          ),
        if (_savedFlash != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(
              _savedFlash!,
              style: const TextStyle(color: Colors.greenAccent),
            ),
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
                    Tab(text: 'Admin'),
                  ],
                ),
                Expanded(
                  child: TabBarView(
                    children: [_generalTab(), _notesTab(), _adminTab()],
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
        _textField('Day offset hours (0-24)', 'day_offset_hours', number: true),
        const SizedBox(height: 16),
        _section('Appearance'),
        _themeModeField(),
        const SizedBox(height: 8),
        const Text('Accent color'),
        _accentField(),
      ],
    );
  }

  void _setThemeMode(String mode) {
    setState(() {
      _profile['theme_mode'] = mode;
      _setDirty(true);
    });
  }

  void _setAccent(String hex) {
    setState(() {
      _profile['accent_color'] = hex;
      _setDirty(true);
    });
  }

  Widget _themeModeField() {
    final mode = (_profile['theme_mode'] as String?) ?? 'system';
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: SegmentedButton<String>(
        segments: const [
          ButtonSegment(
            value: 'system',
            label: Text('System'),
            icon: Icon(Icons.brightness_auto_outlined),
          ),
          ButtonSegment(
            value: 'dark',
            label: Text('Dark'),
            icon: Icon(Icons.dark_mode_outlined),
          ),
          ButtonSegment(
            value: 'light',
            label: Text('Light'),
            icon: Icon(Icons.light_mode_outlined),
          ),
        ],
        selected: {mode},
        onSelectionChanged: (s) =>
            setState(() => _setThemeMode(s.first)),
      ),
    );
  }

  static const _accentChoices = <String, Color>{
    '#22c55e': Color(0xff22c55e), // green — default
    '#3b82f6': Color(0xff3b82f6),
    '#06b6d4': Color(0xff06b6d4),
    '#14b8a6': Color(0xff14b8a6),
    '#a855f7': Color(0xffa855f7),
    '#ec4899': Color(0xffec4899),
    '#ef4444': Color(0xffef4444),
    '#f97316': Color(0xfff97316),
    '#eab308': Color(0xffeab308),
  };

  Widget _accentField() {
    final current = ((_profile['accent_color'] as String?) ?? '#22c55e')
        .toLowerCase();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          for (final e in _accentChoices.entries)
            InkWell(
              onTap: () => _setAccent(e.key),
              customBorder: const CircleBorder(),
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: e.value,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: current == e.key
                        ? Theme.of(context).colorScheme.onSurface
                        : Colors.transparent,
                    width: 2,
                  ),
                ),
                child: current == e.key
                    ? const Icon(Icons.check, size: 18, color: Colors.white)
                    : null,
              ),
            ),
        ],
      ),
    );
  }

  Widget _notesTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _section('Questions'),
        if (_questions.isEmpty)
          const Text(
            'No questions yet — add one below.',
            style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic),
          ),
        ReorderableListView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          buildDefaultDragHandles: false,
          itemCount: _questions.length,
          onReorderItem: (oldI, newI) {
            setState(() {
              final q = _questions.removeAt(oldI);
              _questions.insert(newI, q);
              for (var i = 0; i < _questions.length; i++) {
                _questions[i]['sort_order'] = i;
              }
              _setDirty(true);
            });
          },
          itemBuilder: (context, i) => Card(
            key: ValueKey(
              'q-${_questions[i]['id'] ?? 'new-${_questions[i]['identifier']}'}',
            ),
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: ListTile(
              title: Text(_questions[i]['question'] as String? ?? ''),
              subtitle: Text(
                '${_questions[i]['identifier']} · ${_questions[i]['asked'] == true ? 'asked' : 'hidden (AI-only)'}',
                style: const TextStyle(fontSize: 12),
              ),
              trailing: ReorderableDragStartListener(
                index: i,
                child: const Icon(Icons.drag_indicator),
              ),
              onTap: () => _questionDialog(index: i),
            ),
          ),
        ),
        OutlinedButton.icon(
          onPressed: _questionDialog,
          icon: const Icon(Icons.add),
          label: const Text('Add question'),
        ),
        const SizedBox(height: 20),
        _section('Entry template'),
        _pathField('Template note (.md)', 'template_note_path', pickFile: true),
        if (_txt('template_note_path').isNotEmpty) ...[
          Row(
            children: [
              Expanded(
                child: Text(
                  'Template content',
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurface
                        .withValues(alpha: 0.7),
                  ),
                ),
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
          const SizedBox(height: 8),
          Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              title: const Text(
                'Template guide',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              ),
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Question placeholders', style: _guideHeading),
                ),
                _guideRow(
                  '{Q1.answer}',
                  'the answer to question Q1 (empty when unanswered)',
                ),
                _guideRow('{Q1.question}', 'the question text itself'),
                _guideRow(
                  '{Q1.asked}',
                  'true / false — whether it was asked in the form',
                ),
                // _guideRow(
                //   '{Q1.prompt}',
                //   'the AI refinement prompt (blank for now)',
                // ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Use the variable names from the questions above — unknown names stay as literal text.',
                    style: _guideNote,
                  ),
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Note date — \$date("format")',
                    style: _guideHeading,
                  ),
                ),
                _guideRow(r'$date("dddd")', 'Friday'),
                _guideRow(r'$date("MMMM d, yyyy")', 'October 18, 2026'),
                _guideRow(r'$date("yyyy-MM-dd")', '2026-10-18'),
                _guideRow(r'$date("d.M.yy")', '18.10.26'),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Specifiers: d day · ddd weekday short · dddd weekday · '
                    'M month · MMM short · MMMM full · yy / yyyy year. '
                    "Repeating a letter pads it (dd → 05). Wrap literal "
                    "letters in 'quotes', escape with \\.",
                    style: _guideNote,
                  ),
                ),
              ],
            ),
          ),
        ] else
          Text(
            'Set a template note path above to edit the template.',
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onSurface
                  .withValues(alpha: 0.38),
            ),
          ),
      ],
    );
  }

  TextStyle get _guideHeading => TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w700,
    color: Theme.of(context).colorScheme.primary,
  );

  TextStyle get _guideNote => TextStyle(
    fontSize: 12,
    height: 1.4,
    color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
  );

  Widget _guideRow(String token, String meaning) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          token,
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(child: Text(meaning, style: _guideNote)),
      ],
    ),
  );

  Widget _adminTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _section('Admin account'),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextFormField(
            controller: _usernameCtrl,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'Username',
              isDense: true,
            ),
          ),
        ),
        _textField(
          'New password (min 4, empty = keep)',
          'accountPassword',
          obscure: true,
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _saving ? null : _saveAccount,
          icon: const Icon(Icons.key_outlined),
          label: const Text('Update account'),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _saving ? null : _restoreDefaults,
          icon: const Icon(Icons.restart_alt_outlined),
          label: const Text('Restore defaults'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _saving ? null : _clearMediaCache,
          icon: const Icon(Icons.image_not_supported_outlined),
          label: const Text('Clear media cache'),
        ),
        const SizedBox(height: 20),
        _section('Server'),
        ListTile(
          leading: const Icon(Icons.dns_outlined),
          title: const Text('Change server'),
          subtitle: Text(widget.api.baseUrl,
              style: const TextStyle(fontSize: 12)),
          onTap: () => widget.onChangeServer?.call(),
        ),
        const SizedBox(height: 20),
        _section('Import / export'),
        ListTile(
          leading: const Icon(Icons.copy_outlined),
          title: const Text('Export settings'),
          subtitle: const Text(
            'Copies all settings as JSON to the clipboard',
            style: TextStyle(fontSize: 12),
          ),
          onTap: _exportSettings,
        ),
        ListTile(
          leading: const Icon(Icons.file_open_outlined),
          title: const Text('Import from file'),
          subtitle: const Text(
            'Pick a previously exported settings JSON',
            style: TextStyle(fontSize: 12),
          ),
          onTap: _importSettings,
        ),
      ],
    );
  }

  Widget _section(String title) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      title,
      style: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
      ),
    ),
  );

  Widget _textField(
    String label,
    String key, {
    bool obscure = false,
    bool number = false,
  }) {
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
              pickFile ? Icons.description_outlined : Icons.folder_open,
            ),
            tooltip: pickFile ? 'Browse server files' : 'Browse server folders',
            onPressed: () => _pickPath(key, pickFile: pickFile),
          ),
        ],
      ),
    );
  }

  Widget _tzField(String label, String key) {
    return TimezoneField(controller: _ctrl(key), label: label);
  }

  /// One dialog for both adding and editing a question. Editing keeps the
  /// row id (entry_answers FKs survive); the identifier stays editable.
  Future<void> _questionDialog({int? index}) async {
    final existing = index == null ? null : _questions[index];
    final idCtrl = TextEditingController(
      text: existing?['identifier'] as String? ?? '',
    );
    final qCtrl = TextEditingController(
      text: existing?['question'] as String? ?? '',
    );
    bool asked = existing?['asked'] != false;
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialog) => AlertDialog(
          title: Row(
            children: [
              Expanded(
                child: Text(
                  existing == null ? 'Add question' : 'Edit question',
                ),
              ),
              if (existing != null)
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  color: Colors.redAccent,
                  tooltip: 'Delete question',
                  onPressed: () => Navigator.pop(context, {'__delete': true}),
                ),
            ],
          ),
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
            if (existing != null) const SizedBox(width: 8),
            FilledButton(
              onPressed: () => Navigator.pop(context, {
                ...?existing,
                'identifier': idCtrl.text.trim(),
                'question': qCtrl.text.trim(),
                'asked': asked,
              }),
              child: Text(existing == null ? 'Add' : 'Done'),
            ),
          ],
        ),
      ),
    );
    if (result == null) return;
    if (!mounted) return; // the first dialog's async gap
    if (result['__delete'] == true) {
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Remove question?'),
          content: Text(
            'This removes ${existing?['identifier']} from the form. Saved answers of past entries are kept.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              style: FilledButton.styleFrom(backgroundColor: Colors.red),
              child: const Text('Remove'),
            ),
          ],
        ),
      );
      if (yes == true && mounted) {
        setState(() {
          _questions.removeAt(index!);
          _setDirty(true);
        });
      }
      return;
    }
    if ((result['identifier'] as String).isEmpty ||
        (result['question'] as String).isEmpty) {
      return;
    }
    setState(() {
      if (index == null) {
        _questions.add({
          ...result,
          'answer_prompt': '',
          'sort_order': _questions.length,
        });
      } else {
        _questions[index] = result;
      }
      _setDirty(true);
    });
  }
}
