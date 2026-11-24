import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'api.dart';
import 'format.dart';
import 'journal.dart';
import 'lightbox.dart';
import 'widgets/loading_image.dart';
import 'widgets/sticky_header.dart';

/// Media tab: media_cache rows grouped by capture day (parity with the old
/// media-view: newest day on top, day headers, thumbs from the scan).
class MediaScreen extends StatefulWidget {
  final Api api;
  final ValueListenable<int>? refreshSignal;

  /// Grid density percent (50-200); 100 = the default tile size.
  final ValueListenable<int>? gridScale;
  final VoidCallback? onOpenSettings;
  const MediaScreen({
    super.key,
    required this.api,
    this.refreshSignal,
    this.gridScale,
    this.onOpenSettings,
  });

  @override
  State<MediaScreen> createState() => _MediaScreenState();
}

class _MediaScreenState extends State<MediaScreen> {
  late Future<(List<MediaFile>, String, bool, List<String>)> _files;
  int _retries = 0;
  Timer? _pollTimer;
  int _polls = 0;

  /// last completed load — polls swap the future, which would otherwise
  /// flash the whole tab back to a spinner every 3s
  (List<MediaFile>, String, bool, List<String>)? _lastData;

  /// row count from the last cheap status poll — a change means the scan
  /// indexed new files and the list needs refetching
  int _lastCount = -1;

  @override
  void initState() {
    super.initState();
    _files = _load();
    widget.refreshSignal?.addListener(_reload);
    widget.gridScale?.addListener(_onScale);
  }

  void _onScale() {
    if (mounted) setState(() {});
  }

  int get _scale => widget.gridScale?.value ?? 100;

  @override
  void dispose() {
    widget.refreshSignal?.removeListener(_reload);
    widget.gridScale?.removeListener(_onScale);
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<(List<MediaFile>, String, bool, List<String>)> _load({bool refresh = false}) async {
    // parallel — these were sequential, so every load paid two round trips
    final results = await Future.wait([
      widget.api.mediaFiles(refresh: refresh),
      widget.api.entryDates(),
    ]);
    final (files, folder, scanning) = results[0] as (List<MediaFile>, String, bool);
    // dates only feed the per-day "view entry" button — the full note is
    // fetched on demand when the button is tapped
    final dates = results[1] as List<String>;
    return (files, folder, scanning, dates);
  }

  Future<void> _reload({bool refresh = false}) async {
    setState(() {
      _files = _load(refresh: refresh);
    });
    final (files, folder, scanning, _) = await _files;
    if (!mounted) return;
    _pollTimer?.cancel();
    if (scanning && _polls < 600) {
      // a scan is in flight — poll the cheap status endpoint and refetch
      // the file list only when new rows actually landed
      _polls++;
      _lastCount = files.length;
      _pollTimer = Timer(const Duration(seconds: 3), _pollStatus);
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

  /// Open the note for [day] — fetched on demand, so the media list only
  /// carries the set of days that have an entry.
  Future<void> _openEntry(String day) async {
    try {
      final entries = await widget.api.entries(date: day);
      if (entries.isEmpty || !mounted) return;
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => EntryScreen(
          api: widget.api,
          entry: entries.first,
          media: _lastData?.$1.where((f) => f.date == day).toList() ?? const [],
          onChanged: _reload,
        ),
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open the entry: $e')),
      );
    }
  }

  /// Cheap poll used while the server is scanning: asks only for
  /// {scanning,count} and refetches the (large) file list only when the
  /// scan actually indexed new rows. Polling the full list every 3s
  /// re-downloaded the entire library — megabytes per poll on a big library.
  Future<void> _pollStatus() async {
    if (!mounted) return;
    try {
      final (scanning, count) = await widget.api.mediaStatus();
      if (!mounted) return;
      if (count != _lastCount) {
        _lastCount = count;
        await _reload();
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
      // transient failure — back off and retry the full reload path
      _pollTimer = Timer(const Duration(seconds: 3), _reload);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => _reload(refresh: true),
      child: FutureBuilder<(List<MediaFile>, String, bool, List<String>)>(
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
          final (files, folder, scanning, entryDates) = data;
          final entryByDate = {for (final d in entryDates) d: true};
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
                  // pinned day header: sticks at the top while its day's
                  // tiles scroll; the next day's header pushes it out
                  SliverPersistentHeader(
                    pinned: true,
                    delegate: StickyHeaderDelegate(
                      extent: 48,
                      child: SizedBox(
                        height: 48,
                        child: Padding(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 16),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  dayTitle(day),
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
                                  icon:
                                      const Icon(Icons.description_outlined),
                                  tooltip: 'View entry for $day',
                                  visualDensity: VisualDensity.compact,
                                  // fetch the note on demand — the list only
                                  // knows which days have one
                                  onPressed: () => _openEntry(day),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    sliver: SliverGrid.builder(
                    itemCount: groups[day]!.length,
                    gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 180 * _scale / 100,
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
                              if (f.hasThumb)
                                // images and videos (ffmpeg first frame)
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
                              if (f.isVideo)
                                const Center(
                                  child: Icon(
                                    Icons.play_circle_fill,
                                    size: 44,
                                    color: Colors.white70,
                                    shadows: [
                                      Shadow(color: Colors.black38, blurRadius: 8)
                                    ],
                                  ),
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
