import 'package:flutter/material.dart';

import '../api.dart';

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

  @override
  void initState() {
    super.initState();
    _dir = widget.initial.isEmpty
        ? ''
        : (widget.pickFile ? _parentOf(widget.initial) : widget.initial);
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
                            .where(
                              (e) =>
                                  !e.isDir &&
                                  e.path.toLowerCase().endsWith('.md'),
                            )
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
