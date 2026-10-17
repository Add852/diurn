import 'package:flutter/material.dart';

import 'api.dart';
import 'video/video_file.dart';

/// Fullscreen viewer for one media file. Images get pinch/pan via
/// InteractiveViewer; videos play through media_kit (works on all 5 platforms).
class ViewerScreen extends StatefulWidget {
  final Api api;
  final FsEntry entry;
  const ViewerScreen({super.key, required this.api, required this.entry});

  @override
  State<ViewerScreen> createState() => _ViewerScreenState();
}

class _ViewerScreenState extends State<ViewerScreen> {
  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.entry;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(e.name),
      ),
      body: Center(
        child: isVideo(e.path)
            ? VideoFileWidget(url: widget.api.mediaUrl(e.path))
            : InteractiveViewer(
                maxScale: 8,
                child: Image.network(
                  widget.api.mediaUrl(e.path),
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const Icon(
                    Icons.broken_image_outlined,
                    color: Colors.white38,
                    size: 64,
                  ),
                ),
              ),
      ),
    );
  }
}
