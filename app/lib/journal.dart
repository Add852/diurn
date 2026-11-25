import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import 'api.dart';
import 'format.dart';
import 'lightbox.dart';
import 'widgets/loading_image.dart';
import 'widgets/sticky_header.dart';

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

/// Pure entry-search core (testable without widget bindings): keep entries
/// where every metadata filter matches exactly (frontmatter key == value)
/// and every whitespace-separated query token appears in the date, note
/// body, or metadata values, case-insensitively.
List<Entry> filterEntries(
  List<Entry> entries, {
  String query = '',
  Map<String, String> filters = const {},
}) {
  final tokens = query
      .trim()
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((t) => t.isNotEmpty)
      .toList();
  return [
    for (final e in entries)
      if (() {
        final (fm, body) = parseFrontmatter(e.markdown);
        for (final f in filters.entries) {
          if (fm[f.key] != f.value) return false;
        }
        if (tokens.isNotEmpty) {
          final hay = '${e.date}\n$body\n${fm.values.join('\n')}'.toLowerCase();
          if (!tokens.every(hay.contains)) return false;
        }
        return true;
      }())
        e,
  ];
}

/// Journal tab: entries grouped by month, newest first (parity with the old
/// journal-view masonry, as a plain list).
class JournalScreen extends StatefulWidget {
  final Api api;
  final ValueListenable<int>? refreshSignal;

  /// Grid density percent (50-200); 100 = the default card size.
  final ValueListenable<int>? gridScale;
  const JournalScreen({
    super.key,
    required this.api,
    this.refreshSignal,
    this.gridScale,
  });

  @override
  State<JournalScreen> createState() => _JournalScreenState();
}

class _JournalScreenState extends State<JournalScreen> {
  late Future<(List<Entry>, Map<String, List<MediaFile>>, bool)> _future;
  Timer? _pollTimer;
  int _polls = 0;

  // search/filter — client-side over the already-loaded entries
  final TextEditingController _search = TextEditingController();
  String _query = '';
  final Map<String, String> _filters = {}; // frontmatter key -> value

  /// last completed load — polls swap the future, which would otherwise
  /// flash the whole tab back to a spinner every 3s
  (List<Entry>, Map<String, List<MediaFile>>, bool)? _last;

  /// frontmatter key/value counts from the last build — feeds the filter
  /// picker even while a filter is active
  Map<String, Map<String, int>> _lastKeyValues = {};

  /// media row count from the last cheap status poll — a change means the
  /// scan indexed new files and the list needs refetching
  int _lastMediaCount = -1;

  /// Frontmatter parsing/filtering is cached across rebuilds; previously
  /// every frame-worthy rebuild re-parsed every note's markdown.
  List<Entry>? _filterSource;
  String _filterQuery = '';
  String _filterSignature = '';
  (List<Entry>, Map<String, Map<String, int>>)? _filterResult;

  @override
  void initState() {
    super.initState();
    _future = _load();
    widget.refreshSignal?.addListener(_reload);
    widget.gridScale?.addListener(_onScale);
  }

  void _onScale() {
    if (mounted) setState(() {});
  }

  int get _scale => widget.gridScale?.value ?? 100;

  /// pinned search header height: field row + optional filter chips row
  double get _searchExtent => _filters.isEmpty ? 62 : 110;

  Future<(List<Entry>, Map<String, List<MediaFile>>, bool)> _load() async {
    // entries and media covers are fetched in parallel — they were
    // sequential, so every load paid two round trips back to back
    final results = await Future.wait([
      widget.api.entries(),
      widget.api.mediaDays(),
      widget.api.mediaStatus(),
    ]);
    final entries = results[0] as List<Entry>;
    final files = results[1] as List<MediaFile>;
    final scanning = (results[2] as (bool, int)).$1;
    // ONE cover photo per day — the cards only use the day's first media as
    // a background. Fetching every file made the journal tab download the
    // whole media library (megabytes on a big library) just to draw cards.
    // every day's media list feeds the card backgrounds
    final byDate = <String, List<MediaFile>>{};
    for (final f in files) {
      if (f.date != null) (byDate[f.date!] ??= []).add(f);
    }
    return (entries, byDate, scanning);
  }

  void _reload() {
    if (!mounted) return;
    setState(() {
      _future = _load();
    });
    _poll();
  }

  /// while the server scans, poll so card backgrounds arrive as they index
  Future<void> _poll() async {
    final (_, _, scanning) = await _future;
    if (!mounted) return;
    _pollTimer?.cancel();
    if (scanning && _polls < 600) {
      _polls++;
      // cheap status poll: refetching the full list (entries + media covers)
      // every 3s re-downloaded megabytes while a scan ran
      _pollTimer = Timer(const Duration(seconds: 3), _pollStatus);
    } else if (!scanning) {
      _polls = 0;
    }
  }

  /// Cheap poll while the server scans: ask only for the row count and
  /// refetch the media covers when new media actually landed. The entries
  /// themselves don't change during a media scan, so they are NOT refetched.
  Future<void> _pollStatus() async {
    if (!mounted) return;
    try {
      final (scanning, count) = await widget.api.mediaStatus();
      if (!mounted) return;
      if (count != _lastMediaCount) {
        _lastMediaCount = count;
        await _reloadCovers();
        return;
      }
      if (!scanning) {
        _polls = 0;
        return;
      }
      if (_polls < 600) {
        _polls++;
        _pollTimer = Timer(const Duration(seconds: 3), _pollStatus);
      }
    } catch (_) {
      _pollTimer = Timer(const Duration(seconds: 3), _reload);
    }
  }

  /// Refresh only the per-day media covers (card backgrounds) — keeps the
  /// existing entries in place.
  Future<void> _reloadCovers() async {
    final covers = await widget.api.mediaDays();
    if (!mounted) return;
    final byDate = <String, List<MediaFile>>{};
    for (final f in covers) {
      if (f.date != null) (byDate[f.date!] ??= []).add(f);
    }
    setState(() {
      final current = _last;
      if (current != null) {
        _last = (current.$1, byDate, current.$3);
        _future = Future.value(_last);
      }
    });
    _poll();
  }

  @override
  void dispose() {
    widget.refreshSignal?.removeListener(_reload);
    widget.gridScale?.removeListener(_onScale);
    _pollTimer?.cancel();
    _search.dispose();
    super.dispose();
  }

  /// Filter the entries by the active metadata filters + free-text query.
  /// Also returns the distinct frontmatter keys -> value counts across ALL
  /// entries, for the filter picker.
  (List<Entry>, Map<String, Map<String, int>>) _filtered(List<Entry> entries) {
    final signature =
        _filters.entries.map((e) => '${e.key}\u0000${e.value}').join('\u0001');
    if (identical(entries, _filterSource) &&
        _query == _filterQuery &&
        signature == _filterSignature &&
        _filterResult != null) {
      return _filterResult!;
    }
    final keyValues = <String, Map<String, int>>{};
    for (final e in entries) {
      final (fm, _) = parseFrontmatter(e.markdown);
      for (final k in fm.keys) {
        final v = fm[k]!;
        (keyValues[k] ??= {})[v] = (keyValues[k]?[v] ?? 0) + 1;
      }
    }
    final result =
        (filterEntries(entries, query: _query, filters: _filters), keyValues);
    _filterSource = entries;
    _filterQuery = _query;
    _filterSignature = signature;
    _filterResult = result;
    return result;
  }

  /// Bottom sheet: pick a metadata key, then a value; tapping a value
  /// toggles that filter. Values show how many entries carry each.
  Future<void> _openFilters(Map<String, Map<String, int>> keyValues) async {
    await showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (sheetCtx) {
        String? activeKey;
        return StatefulBuilder(
          builder: (sheetCtx, setSheet) {
            if (activeKey == null) {
              final keys = keyValues.keys.toList()..sort();
              return SizedBox(
                height: 400,
                child: ListView(
                  children: [
                    for (final k in keys)
                      ListTile(
                        title: Text(k),
                        trailing: _filters.containsKey(k)
                            ? const Icon(Icons.check_circle, size: 18)
                            : Text('${keyValues[k]!.length} values'),
                        onTap: () => setSheet(() => activeKey = k),
                      ),
                    if (keys.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(24),
                        child: Text('No metadata found in entries'),
                      ),
                  ],
                ),
              );
            }
            final key = activeKey!;
            final values = keyValues[key]!;
            final sorted = values.keys.toList()..sort();
            return SizedBox(
              height: 400,
              child: ListView(
                children: [
                  ListTile(
                    leading: const Icon(Icons.arrow_back),
                    title: Text(key,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    onTap: () => setSheet(() => activeKey = null),
                  ),
                  for (final v in sorted)
                    ListTile(
                      title: Text(v.isEmpty ? '(empty)' : v),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        Text('${values[v]}'),
                        if (_filters[key] == v) ...[
                          const SizedBox(width: 8),
                          const Icon(Icons.check_circle, size: 18),
                        ],
                      ]),
                      onTap: () {
                        setState(() {
                          if (_filters[key] == v) {
                            _filters.remove(key);
                          } else {
                            _filters[key] = v;
                          }
                        });
                        Navigator.pop(sheetCtx);
                      },
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _searchField(BuildContext context, int total, int shown) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _search,
                  onChanged: (v) => setState(() => _query = v),
                  decoration: InputDecoration(
                    isDense: true,
                    prefixIcon: const Icon(Icons.search, size: 20),
                    suffixIcon: _query.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: () {
                              _search.clear();
                              setState(() => _query = '');
                            },
                          ),
                    hintText: _query.isEmpty && _filters.isEmpty
                        ? 'Search notes, dates, metadata…'
                        : '$shown/$total entries',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                    ),
                  ),
                ),
              ),
              IconButton(
                icon: Icon(
                  Icons.filter_list,
                  color: _filters.isEmpty
                      ? null
                      : cs.primary,
                ),
                tooltip: 'Filter by metadata',
                onPressed: () => _openFilters(_lastKeyValues),
              ),
            ],
          ),
          if (_filters.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Wrap(
                  spacing: 6,
                  children: [
                    for (final f in _filters.entries)
                      InputChip(
                        label: Text('${f.key}: ${f.value}'),
                        visualDensity: VisualDensity.compact,
                        onDeleted: () =>
                            setState(() => _filters.remove(f.key)),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => _reload(),
      child: FutureBuilder<(List<Entry>, Map<String, List<MediaFile>>, bool)>(
        future: _future,
        builder: (context, snap) {
          final data = snap.data ?? _last;
          if (data == null) {
            if (snap.hasError) return Center(child: Text('${snap.error}'));
            return const Center(child: CircularProgressIndicator());
          }
          _last = data;
          final (entries, mediaByDate, scanning) = data;
        if (entries.isEmpty) return const Center(child: Text('No entries yet'));
        final (filtered, keyValues) = _filtered(entries);
        _lastKeyValues = keyValues;
        // group by month, preserve API order (date DESC)
        final groups = <String, List<Entry>>{};
        for (final e in filtered) {
          (groups.putIfAbsent(e.date.substring(0, 7), () => [])).add(e);
        }
        return CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            if (scanning)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16),
                  child: LinearProgressIndicator(minHeight: 3),
                ),
              ),
            // pinned: the search bar stays at the top of the tab
            SliverPersistentHeader(
              pinned: true,
              delegate: StickyHeaderDelegate(
                extent: _searchExtent,
                child: SizedBox(
                  height: _searchExtent,
                  child: _searchField(
                      context, entries.length, filtered.length),
                ),
              ),
            ),
            if (filtered.isEmpty)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.all(32),
                  child: Center(child: Text('No entries match')),
                ),
              ),
            for (final month in groups.keys)
              SliverMainAxisGroup(
                slivers: [
                  // pinned month header: sticks under the search bar while
                  // its month scrolls; the next month's header pushes it out
                  SliverPersistentHeader(
                    pinned: true,
                    delegate: StickyHeaderDelegate(
                      extent: 40,
                      child: SizedBox(
                        height: 40,
                        child: Padding(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 16),
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              monthTitle(month),
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
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    sliver: SliverGrid.builder(
                      itemCount: groups[month]!.length,
                      gridDelegate:
                          SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 380 * _scale / 100,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                        childAspectRatio: 1.35,
                      ),
                      itemBuilder: (context, i) {
                        final e = groups[month]![i];
                        final fm = parseFrontmatter(e.markdown).$1;
                        return _EntryCard(
                          api: widget.api,
                          entry: e,
                          dayMedia: mediaByDate[e.date] ?? const [],
                          scanning: scanning,
                          fm: fm,
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
      ),
    );
  }
}

/// Card per journal day in a compact grid: date, metadata preview and a
/// filmstrip of that day's media (tap a thumb for the day's lightbox).
class _EntryCard extends StatelessWidget {
  final Api api;
  final Entry entry;
  final List<MediaFile> dayMedia;

  /// while a scan runs, media without a thumbnail render as shimmer
  final bool scanning;
  final Map<String, String> fm;
  final VoidCallback onChanged;
  const _EntryCard({
    required this.api,
    required this.entry,
    required this.dayMedia,
    required this.scanning,
    required this.fm,
    required this.onChanged,
  });

  /// Metadata capsules that fit two rows of the card; the rest collapse
  /// into a "+N" capsule instead of overflowing.
  Widget _fitChips(BoxConstraints c) {
    const style = TextStyle(fontSize: 11, color: Colors.white);
    const hPad = 8.0;
    const gap = 6.0;
    const rowH = 24.0;
    const maxRows = 2;
    final maxW = c.maxWidth;

    Widget chip(String label) => Container(
          padding: const EdgeInsets.symmetric(horizontal: hPad, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.45),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: Colors.white24),
          ),
          child: Text(label, style: style),
        );

    double widthOf(String label) {
      final tp = TextPainter(
        text: TextSpan(text: label, style: style),
        textDirection: TextDirection.ltr,
      )..layout();
      return tp.width + hPad * 2 + 2; // + border
    }

    final rows = <List<Widget>>[[]];
    var x = 0.0;
    var shown = 0;
    for (final kv in fm.entries) {
      final label = '${kv.key}: ${kv.value}';
      final w = widthOf(label);
      if (w > maxW) continue; // can never fit this card
      if (x + w > maxW) {
        if (rows.length >= maxRows) break;
        rows.add([]);
        x = 0;
      }
      rows.last.add(chip(label));
      x += w + gap;
      shown++;
    }
    final hidden = fm.length - shown;
    if (hidden > 0) {
      final w = widthOf('+$hidden');
      if (x + w > maxW && rows.length < maxRows) {
        rows.add([]);
        x = 0;
      }
      if (x + w <= maxW) rows.last.add(chip('+$hidden'));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (final row in rows)
          if (row.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: SizedBox(
                height: rowH,
                child: Wrap(
                    spacing: gap,
                    alignment: WrapAlignment.end,
                    children: row),
              ),
            ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final onPhoto = dayMedia.isNotEmpty;
    final day = int.tryParse(entry.date.length >= 10
            ? entry.date.substring(8, 10)
            : '') ??
        0;
    final numeralColor = onPhoto
        ? Colors.white.withValues(alpha: 0.32)
        : cs.onSurface.withValues(alpha: 0.12);
    final suffixColor = onPhoto
        ? Colors.white.withValues(alpha: 0.55)
        : cs.onSurface.withValues(alpha: 0.28);
    // card width drives the numeral size (LayoutBuilder must sit above the
    // Stack so the numeral's Positioned stays a direct Stack child)
    return LayoutBuilder(builder: (context, card) {
    final fs = card.maxWidth * 0.46;
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      color: cs.surfaceContainerHighest,
      child: InkWell(
        onTap: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => EntryScreen(
              api: api, entry: entry, onChanged: onChanged, media: dayMedia),
        )),
        child: Stack(
          fit: StackFit.expand,
          children: [
              if (onPhoto) ...[
                if (dayMedia.first.hasThumb)
                  LoadingImage(url: api.thumbUrl(dayMedia.first.path))
                else if (scanning)
                  const ShimmerBox()
                else
                  LoadingImage(
                    url: api.mediaUrl(dayMedia.first.path),
                    errorWidget: const SizedBox.shrink(),
                  ),
                // gradient scrim: dark behind the text, clear at the top
                Container(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: [Color(0xCC000000), Color(0x00000000)],
                      stops: [0.0, 0.6],
                    ),
                  ),
                ),
              ],
              // Ghost day numeral: big, transparent, anchored bottom-left
              // and deliberately pushed past the card edge — the card's
              // clip crops it, showing just enough to read the day.
              if (day > 0)
                Positioned(
                  bottom: -fs * 0.26,
                  left: -fs * 0.14,
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: '$day',
                          style: TextStyle(
                            fontSize: fs,
                            height: 1.1,
                            fontWeight: FontWeight.w800,
                            color: numeralColor,
                            shadows: onPhoto
                                ? const [
                                    Shadow(
                                        color: Color(0x44000000),
                                        blurRadius: 12),
                                  ]
                                : null,
                          ),
                        ),
                        TextSpan(
                          text: ordinalSuffix(day),
                          style: TextStyle(
                            fontSize: fs * 0.30,
                            fontWeight: FontWeight.w700,
                            color: suffixColor,
                            shadows: onPhoto
                                ? const [
                                    Shadow(
                                        color: Color(0x44000000),
                                        blurRadius: 8),
                                  ]
                                : null,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (fm.isNotEmpty)
                      LayoutBuilder(builder: (context, c) => _fitChips(c))
                    else
                      Text('No metadata',
                          style: TextStyle(
                              fontSize: 12,
                              fontStyle: FontStyle.italic,
                              color: onPhoto
                                  ? Colors.white54
                                  : cs.onSurface.withValues(alpha: 0.4),
                              shadows: onPhoto
                                  ? const [_photoTextShadow]
                                  : null)),
                  ],
                ),
              ),
            ],
        ),
      ),
    );
    });
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
      await widget.api.updateEntry(widget.entry.date, _editor.text);
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
        title: Text(longDate(widget.entry.date)),
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
            if (widget.media.isNotEmpty) ...[
              MediaStrip(api: widget.api, files: widget.media),
              const SizedBox(height: 16),
            ],
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
          ],
        ],
      ),
    );
  }
}

Widget _fmChip(BuildContext context, String key, String value,
    {bool onPhoto = false}) {
  // ponytail: media-file FM values (old /api/media refs) render as text;
  // upgrade to thumbnail chips when entries embed them.
  return Container(
    padding: EdgeInsets.symmetric(
        horizontal: onPhoto ? 8 : 10, vertical: onPhoto ? 4 : 6),
    decoration: BoxDecoration(
      color: onPhoto
          ? Colors.black.withValues(alpha: 0.45)
          : Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(999),
      border: onPhoto ? Border.all(color: Colors.white24) : null,
    ),
    child: Text(
      '$key: $value',
      style: TextStyle(
          fontSize: onPhoto ? 11 : 12,
          color: onPhoto ? Colors.white : null),
    ),
  );
}
