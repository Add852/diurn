import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import 'api.dart';

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
  const JournalScreen({super.key, required this.api});

  @override
  State<JournalScreen> createState() => _JournalScreenState();
}

class _JournalScreenState extends State<JournalScreen> {
  late final Future<List<Entry>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.api.entries();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Entry>>(
      future: _future,
      builder: (context, snap) {
        if (snap.hasError) return Center(child: Text('${snap.error}'));
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final entries = snap.data!;
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
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                          color: Colors.white70,
                        ),
                      ),
                    ),
                  ),
                  SliverList.builder(
                    itemCount: groups[month]!.length,
                    itemBuilder: (context, i) {
                      final e = groups[month]![i];
                      final preview = e.markdown
                          .split('\n')
                          .where((l) =>
                              l.trim().isNotEmpty && !l.startsWith('---'))
                          .first;
                      return ListTile(
                        title: Text(e.date),
                        subtitle: Text(
                          preview,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: e.fsOnly
                            ? const Icon(Icons.description_outlined, size: 18)
                            : null,
                        onTap: () =>
                            Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => EntryScreen(api: widget.api, entry: e),
                        )),
                      );
                    },
                  ),
                ],
              ),
          ],
        );
      },
    );
  }
}

/// One journal entry: frontmatter grid + markdown body (EntryPreview parity).
class EntryScreen extends StatelessWidget {
  final Api api;
  final Entry entry;
  const EntryScreen({super.key, required this.api, required this.entry});

  @override
  Widget build(BuildContext context) {
    final (fm, body) = parseFrontmatter(entry.markdown);
    return Scaffold(
      appBar: AppBar(title: Text(entry.date)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (fm.isNotEmpty)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [for (final kv in fm.entries) _fmChip(kv.key, kv.value)],
            ),
          const SizedBox(height: 16),
          MarkdownBody(
            data: body,
            selectable: true,
            styleSheet: MarkdownStyleSheet.fromTheme(
              Theme.of(context).copyWith(
                textTheme: Theme.of(context).textTheme.apply(
                      bodyColor: Colors.white.withValues(alpha: 0.9),
                    ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

Widget _fmChip(String key, String value) {
  // ponytail: media-file FM values (old /api/media refs) render as text;
  // upgrade to thumbnail chips when entries embed them.
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: const Color(0xff27272a),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Text('$key: $value', style: const TextStyle(fontSize: 12)),
  );
}
