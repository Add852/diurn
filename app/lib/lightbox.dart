import 'package:flutter/material.dart';

import 'api.dart';
import 'viewer.dart';

/// Lightbox over a media list: swipe left/right between items (parity with
/// the old media-lightbox.tsx). Index caption shows day + name when dated.
/// ponytail: no ±1 neighbor prefetch yet; add when scrolling feels slow.
class MediaViewerScreen extends StatefulWidget {
  final Api api;
  final List<MediaFile> files;
  final int initialIndex;
  const MediaViewerScreen({
    super.key,
    required this.api,
    required this.files,
    required this.initialIndex,
  });

  @override
  State<MediaViewerScreen> createState() => _MediaViewerScreenState();
}

class _MediaViewerScreenState extends State<MediaViewerScreen> {
  late final PageController _controller =
      PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final files = widget.files;
    final f = files[_index];
    final caption = [
      if (f.date != null) f.date,
      f.name,
    ].join(' · ');
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(
          '${_index + 1}/${files.length} · $caption',
          style: const TextStyle(fontSize: 15),
        ),
      ),
      body: PageView.builder(
        controller: _controller,
        itemCount: files.length,
        onPageChanged: (i) => setState(() => _index = i),
        itemBuilder: (context, i) {
          final f = files[i];
          return ViewerScreen(
            url: widget.api.mediaUrl(f.path),
            name: f.name,
            video: f.isVideo,
            embedded: true,
          );
        },
      ),
    );
  }
}
