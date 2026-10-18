import 'package:flutter/material.dart';

import 'video/video_file.dart';

/// Fullscreen viewer for one media URL. Images get pinch/pan via
/// InteractiveViewer; video plays through the platform player facade
/// (media_kit native / video_player web).
class ViewerScreen extends StatelessWidget {
  final String url;
  final String name;
  final bool video;

  /// Embedded in the lightbox: no AppBar of its own, fills the page.
  final bool embedded;
  const ViewerScreen({
    super.key,
    required this.url,
    required this.name,
    required this.video,
    this.embedded = false,
  });

  @override
  Widget build(BuildContext context) {
    final body = Center(
      child: video
          ? VideoFileWidget(url: url)
          : InteractiveViewer(
              maxScale: 8,
              child: Image.network(
                url,
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => const Icon(
                  Icons.broken_image_outlined,
                  color: Colors.white38,
                  size: 64,
                ),
              ),
            ),
    );
    if (embedded) return body;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(name),
      ),
      body: body,
    );
  }
}
