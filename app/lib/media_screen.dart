import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'api.dart';
import 'journal.dart';
import 'lightbox.dart';
import 'widgets/loading_image.dart';

/// Media tab: media_cache rows grouped by capture day (parity with the old
/// media-view: newest day on top, day headers, thumbs from the scan).
class MediaScreen extends StatefulWidget {
  final Api api;
  final ValueListenable<int>? refreshSignal;
  final VoidCallback? onOpenSettings;
  const MediaScreen({
    super.key,
    required this.api,
    this.refreshSignal,
    this.onOpenSettings,
  });

  @override
  State<MediaScreen> createState() => _MediaScreenState();
}

class _MediaScreenState extends State<MediaScreen> {
  late Future<(List<MediaFile>, String, bool, List<Entry>)> _files;
  int _retries = 0;
  Timer? _pollTimer;
  int _polls = 0;

  /// last completed load — polls swap the future, which would otherwise
  /// flash the whole tab back to a spinner every 3s
  (List<MediaFile>, String, bool, List<Entry>)? _lastData;

  @override
  void initState() {
    super.initState();
    _files = _load();
    widget.refreshSignal?.addListener(_reload);
  }

  @override
  void dispose() {
    widget.refreshSignal?.removeListener(_reload);
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<(List<MediaFile>, String, bool, List<Entry>)> _load() async {
    final (files, folder, scanning) = await widget.api.mediaFiles();
    // entries feed the per-day "view entry" button
    final entries = await widget.api.entries();
    return (files, folder, scanning, entries);
  }

  Future<void> _reload() async {
    setState(() {
      _files = _load();
    });
    final (files, folder, scanning, _) = await _files;
    if (!mounted) return;
    _pollTimer?.cancel();
    if (scanning && _polls < 600) {
      // a scan is in flight — poll every 3s until it lands (cap ≈ 30 min)
      _polls++;
      _pollTimer = Timer(const Duration(seconds: 3), _reload);
    } else if (!scanning) {
      _polls = 0;
    }
    if (files.isEmpty && folder.isNotEmpty && !scanning && _retries < 3) {
      // empty even after the scan finished — retry a few times automatically
      _retries++;
      _pollTimer = Timer(const Duration(seconds: 2), _reload);
    } else if (files.isNotEmpty) {
      _retries = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _reload,
      child: FutureBuilder<(List<MediaFile>, String, bool, List<Entry>)>(
        future: _files,
        builder: (context, snap) {
          if (snap.hasError) {
            return ListView(children: [
              const SizedBox(height: 80),
              Center(child: Text('${snap.error}')),
            ]);
          }
          final data = snap.data ?? _lastData;
          if (data == null) {
            return const Center(child: CircularProgressIndicator());
          }
          _lastData = data;
          final (files, folder, scanning, entries) = data;
          final entryByDate = {for (final e in entries) e.date: e};
          if (files.isEmpty) {
            final message = folder.isEmpty
                ? 'Media library folder is not configured'
                : scanning
                    ? 'Scanning media library — first results appear here'
                    : 'No media found in $folder\n\nPull down to refresh — the server scans in the background';
            return ListView(
              children: [
                const SizedBox(height: 120),
                Center(
                  child: Column(
                    children: [
                      if (scanning) ...[
                        const SizedBox(
                            width: 28,
                            height: 28,
                            child: CircularProgressIndicator(strokeWidth: 3)),
                        const SizedBox(height: 12),
                      ],
                      Text(message, textAlign: TextAlign.center),
                      if (folder.isEmpty) ...[
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: widget.onOpenSettings,
                          icon: const Icon(Icons.settings_outlined),
                          label: const Text('Open settings'),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            );
          }
        // group by day, keep API order (newest day first)
        final groups = <String, List<int>>{};
        for (var i = 0; i < files.length; i++) {
          (groups.putIfAbsent(files[i].date ?? 'Undated', () => [])).add(i);
        }
        return CustomScrollView(
          slivers: [
            if (scanning)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16),
                  child: LinearProgressIndicator(minHeight: 3),
                ),
              ),
            for (final day in groups.keys)
              SliverMainAxisGroup(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              day,
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
                          if (entryByDate[day] != null)
                            IconButton(
                              icon: const Icon(Icons.description_outlined),
                              tooltip: 'View entry for $day',
                              visualDensity: VisualDensity.compact,
                              onPressed: () =>
                                  Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => EntryScreen(
                                  api: widget.api,
                                  entry: entryByDate[day]!,
                                  media: files
                                      .where((f) => f.date == day)
                                      .toList(),
                                  onChanged: _reload,
                                ),
                              )),
                            ),
                        ],
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    sliver: SliverGrid.builder(
                    itemCount: groups[day]!.length,
                    gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 180,
                      mainAxisSpacing: 8,
                      crossAxisSpacing: 8,
                      childAspectRatio: 1,
                    ),
                    itemBuilder: (context, i) {
                      final idx = groups[day]![i];
                      final f = files[idx];
                      return InkWell(
                        onTap: () =>
                            Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => MediaViewerScreen(
                            api: widget.api,
                            files: files,
                            initialIndex: idx,
                          ),
                        )),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              if (f.isImage && f.hasThumb)
                                LoadingImage(
                                  url: widget.api.thumbUrl(f.path),
                                )
                              else if (f.isImage)
                                // thumb pending during a scan → shimmer;
                                // scan finished without one → full image
                                // (platform decoders cover what we can't)
                                scanning
                                    ? const ShimmerBox()
                                    : LoadingImage(
                                        url: widget.api.mediaUrl(f.path),
                                      )
                              else
                                ColoredBox(
                                  color: Theme.of(context)
                                      .colorScheme
                                      .surfaceContainerHighest,
                                  child: const Icon(Icons.movie_outlined,
                                      size: 40),
                                ),
                            ],
                          ),
                        ),
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
