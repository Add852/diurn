import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import 'api.dart';
import 'lightbox.dart';

/// Shadow for text sitting on photo backgrounds (journal cards, media tiles).
const _photoTextShadow = Shadow(
  color: Color(0xd9000000), // ~85% black
  blurRadius: 5,
  offset: Offset(0, 1),
);

/// Port of src/lib/frontmatter.ts: `---\nkey: value\n---\nbody` split.
(Map<String, String>, String) parseFrontmatter(String content) {
  final m = RegExp(r'^---\n([\s\S]*?)\n---\n?([\s\S]*)$').firstMatch(content);
  if (m == null) return ({}, content);
  final data = <String, String>{};
  for (final line in m.group(1)!.split('\n')) {
    final colon = line.indexOf(':');
    if (colon == -1) continue;
    data[line.substring(0, colon).trim()] = line.substring(colon + 1).trim();
  }
  return (data, m.group(2)!);
}

/// Journal tab: entries grouped by month, newest first (parity with the old
/// journal-view masonry, as a plain list).
class JournalScreen extends StatefulWidget {
  final Api api;
  final ValueListenable<int>? refreshSignal;
  const JournalScreen({super.key, required this.api, this.refreshSignal});

  @override
  State<JournalScreen> createState() => _JournalScreenState();
}

class _JournalScreenState extends State<JournalScreen> {
  late Future<(List<Entry>, Map<String, List<MediaFile>>)> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
    widget.refreshSignal?.addListener(_reload);
  }

  Future<(List<Entry>, Map<String, List<MediaFile>>)> _load() async {
    final entries = await widget.api.entries();
    final (files, _) = await widget.api.mediaFiles();
    // every day's media list feeds the card filmstrip
    final byDate = <String, List<MediaFile>>{};
    for (final f in files) {
      if (f.date != null) (byDate[f.date!] ??= []).add(f);
    }
    return (entries, byDate);
  }

  void _reload() {
    if (!mounted) return;
    setState(() {
      _future = _load();
    });
  }

  @override
  void dispose() {
    widget.refreshSignal?.removeListener(_reload);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<(List<Entry>, Map<String, List<MediaFile>>)>(
      future: _future,
      builder: (context, snap) {
        if (snap.hasError) return Center(child: Text('${snap.error}'));
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final (entries, mediaByDate) = snap.data!;
        if (entries.isEmpty) return const Center(child: Text('No entries yet'));
        // group by month, preserve API order (date DESC)
        final groups = <String, List<Entry>>{};
        for (final e in entries) {
          (groups.putIfAbsent(e.date.substring(0, 7), () => [])).add(e);
        }
        return CustomScrollView(
          slivers: [
            for (final month in groups.keys)
              SliverMainAxisGroup(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      child: Text(
                        month,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withValues(alpha: 0.7),
                        ),
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    sliver: SliverGrid.builder(
                      itemCount: groups[month]!.length,
                      gridDelegate:
                          const SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 380,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                        childAspectRatio: 1.35,
                      ),
                      itemBuilder: (context, i) {
                        final e = groups[month]![i];
                        final fm = parseFrontmatter(e.markdown).$1;
                        final metadata = fm.entries
                            .map((kv) => '${kv.key}: ${kv.value}')
                            .join('  ·  ');
                        return _EntryCard(
                          api: widget.api,
                          entry: e,
                          dayMedia: mediaByDate[e.date] ?? const [],
                          metadata: metadata,
                          onChanged: _reload,
                        );
                      },
                    ),
                  ),
                ],
              ),
          ],
        );
      },
    );
  }
}

/// Card per journal day in a compact grid: date, metadata preview and a
/// filmstrip of that day's media (tap a thumb for the day's lightbox).
class _EntryCard extends StatelessWidget {
  final Api api;
  final Entry entry;
  final List<MediaFile> dayMedia;
  final String metadata;
  final VoidCallback onChanged;
  const _EntryCard({
    required this.api,
    required this.entry,
    required this.dayMedia,
    required this.metadata,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      color: const Color(0xff18181b),
      child: InkWell(
        onTap: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => EntryScreen(
              api: api, entry: entry, onChanged: onChanged, media: dayMedia),
        )),
        child: Stack(
          fit: StackFit.expand,
          children: [
              if (dayMedia.isNotEmpty)
                Image.network(
                  dayMedia.first.hasThumb
                      ? api.thumbUrl(dayMedia.first.path)
                      : api.mediaUrl(dayMedia.first.path),
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                ),
              Container(color: Colors.black.withValues(alpha: 0.55)),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Row(
                      children: [
                        Text(entry.date,
                            style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                                color: Colors.white,
                                shadows: [_photoTextShadow])),
                        if (entry.fsOnly)
                          Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: Icon(Icons.description_outlined,
                                size: 14,
                                color: Colors.white70,
                                shadows: const [_photoTextShadow]),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    if (metadata.isNotEmpty)
                      Text(
                        metadata,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 12,
                            height: 1.25,
                            color: Colors.white.withValues(alpha: 0.85),
                            shadows: const [_photoTextShadow]),
                      )
                    else
                      Text('No metadata',
                          style: TextStyle(
                              fontSize: 12,
                              fontStyle: FontStyle.italic,
                              color: Colors.white54,
                              shadows: const [_photoTextShadow])),
                  ],
                ),
              ),
            ],
        ),
      ),
    );
  }
}

/// One journal entry: frontmatter grid + markdown body (EntryPreview parity)
/// with edit (PUT) and delete (DELETE).
class EntryScreen extends StatefulWidget {
  final Api api;
  final Entry entry;
  final VoidCallback? onChanged;

  /// That day's media — shown as a strip in the preview, tap for lightbox.
  final List<MediaFile> media;
  const EntryScreen({
    super.key,
    required this.api,
    required this.entry,
    this.onChanged,
    this.media = const [],
  });

  @override
  State<EntryScreen> createState() => _EntryScreenState();
}

class _EntryScreenState extends State<EntryScreen> {
  /// The note as currently known — updated on save so the view reflects
  /// edits immediately instead of keeping the pre-save parse.
  late String _current;
  late TextEditingController _editor;
  bool _editing = false;
  bool _saving = false;
  String? _error;
  bool _deleted = false;

  @override
  void initState() {
    super.initState();
    _current = widget.entry.markdown;
    // the editor gets the FULL note — frontmatter is editable markdown too
    _editor = TextEditingController(text: _current);
  }

  @override
  void dispose() {
    _editor.dispose();
    super.dispose();
  }

  Future<void> _saveEdit() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      debugPrint('[entry save] start ${widget.entry.date}');
      await widget.api.updateEntry(widget.entry.date, _editor.text);
      debugPrint('[entry save] done ${widget.entry.date}');
      if (!mounted) return;
      setState(() {
        _current = _editor.text;
        _editing = false;
        _saving = false;
      });
      widget.onChanged?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = '$e';
      });
    }
  }

  Future<void> _delete() async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete entry?'),
        content: Text(
            'This removes the note for ${widget.entry.date} and its file. This cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await widget.api.deleteEntry(widget.entry.date);
      if (!mounted) return;
      widget.onChanged?.call();
      setState(() => _deleted = true);
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_deleted) return const Scaffold(body: SizedBox.shrink());
    final (fm, body) = parseFrontmatter(_current);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.entry.date),
        actions: [
          IconButton(
            icon: Icon(_editing ? Icons.close : Icons.edit_outlined),
            tooltip: _editing ? 'Cancel edit' : 'Edit',
            onPressed: () => setState(() {
              _editing = !_editing;
              _error = null;
            }),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Delete',
            onPressed: _delete,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) ...[
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            const SizedBox(height: 12),
          ],
          if (_editing) ...[
            TextField(
              controller: _editor,
              minLines: 12,
              maxLines: 30,
              enabled: !_saving,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText:
                    'Full note — frontmatter (--- blocks) and markdown body',
              ),
            ),
            const SizedBox(height: 12),
            _saving
                ? const Center(child: CircularProgressIndicator())
                : FilledButton.icon(
                    onPressed: _saveEdit,
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('Save changes'),
                  ),
          ] else ...[
            if (fm.isNotEmpty)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final kv in fm.entries) _fmChip(context, kv.key, kv.value)
                ],
              ),
            const SizedBox(height: 16),
            MarkdownBody(
              data: body,
              selectable: true,
              styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)),
            ),
            if (widget.media.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('Media',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              const SizedBox(height: 8),
              SizedBox(
                height: 84,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  itemCount: widget.media.length,
                  itemBuilder: (context, i) {
                    final f = widget.media[i];
                    return GestureDetector(
                      onTap: () => Navigator.of(context).push(MaterialPageRoute(
                        builder: (_) => MediaViewerScreen(
                            api: widget.api,
                            files: widget.media,
                            initialIndex: i),
                      )),
                      child: Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.network(
                            f.hasThumb
                                ? widget.api.thumbUrl(f.path)
                                : widget.api.mediaUrl(f.path),
                            fit: BoxFit.cover,
                            width: 84,
                            height: 84,
                            errorBuilder: (_, _, _) => Container(
                              width: 84,
                              height: 84,
                              color: Theme.of(context).colorScheme.surfaceContainerHighest,
                              child: Icon(Icons.movie_outlined,
                                  size: 22,
                                  color: Theme.of(context).colorScheme.outline),
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

Widget _fmChip(BuildContext context, String key, String value) {
  // ponytail: media-file FM values (old /api/media refs) render as text;
  // upgrade to thumbnail chips when entries embed them.
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(8),
    ),
    child: Text('$key: $value', style: const TextStyle(fontSize: 12)),
  );
}
