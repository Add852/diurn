import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import 'video/video_file.dart';

/// Fullscreen viewer for one media URL. Images get pinch/pan via
/// InteractiveViewer; video plays through the platform player facade
/// (media_kit native / video_player web).
class ViewerScreen extends StatelessWidget {
  final String url;
  final String name;
  final bool video;

  /// Low-res thumbnail (if any) shown immediately while the full image
  /// loads — the classic blur-up.
  final String? previewUrl;

  /// Embedded in the lightbox: no AppBar of its own, fills the page.
  final bool embedded;
  const ViewerScreen({
    super.key,
    required this.url,
    required this.name,
    required this.video,
    this.previewUrl,
    this.embedded = false,
  });

  @override
  Widget build(BuildContext context) {
    final body = Center(
      child: video
          ? VideoFileWidget(url: url)
          : InteractiveViewer(
              maxScale: 8,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (previewUrl != null)
                    ImageFiltered(
                      imageFilter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                      child: Image.network(
                        previewUrl!,
                        fit: BoxFit.contain,
                        gaplessPlayback: true,
                        filterQuality: FilterQuality.low,
                      ),
                    ),
                  Image.network(
                    url,
                    fit: BoxFit.contain,
                    gaplessPlayback: true,
                    frameBuilder: (context, child, frame, wasSync) {
                      final loaded = wasSync || frame != null;
                      return AnimatedOpacity(
                        opacity: loaded ? 1 : 0,
                        duration: const Duration(milliseconds: 250),
                        child: child,
                      );
                    },
                    errorBuilder: (_, _, _) => const Icon(
                      Icons.broken_image_outlined,
                      color: Colors.white38,
                      size: 64,
                    ),
                  ),
                ],
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
