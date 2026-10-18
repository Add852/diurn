import 'package:flutter/material.dart';

import 'api.dart';
import 'viewer.dart';

/// Lightbox over the media list of one directory: swipe left/right to move
/// between items (parity with the old media-lightbox.tsx).
/// ponytail: no date captions yet — needs the journal entry naming scheme.
class MediaViewerScreen extends StatefulWidget {
  final Api api;
  final List<FsEntry> files;
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
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(
          '${_index + 1}/${files.length} · ${files[_index].name}',
          style: const TextStyle(fontSize: 15),
        ),
      ),
      body: PageView.builder(
        controller: _controller,
        itemCount: files.length,
        onPageChanged: (i) => setState(() => _index = i),
        itemBuilder: (context, i) => ViewerScreen(
          api: widget.api,
          entry: files[i],
          embedded: true,
        ),
      ),
    );
  }
}
