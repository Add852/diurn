import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

import 'api.dart';

/// Fullscreen viewer for one media file. Images get pinch/pan via
/// InteractiveViewer; videos play through media_kit (works on all 5 platforms).
class ViewerScreen extends StatefulWidget {
  final FsEntry entry;
  const ViewerScreen({super.key, required this.entry});

  @override
  State<ViewerScreen> createState() => _ViewerScreenState();
}

class _ViewerScreenState extends State<ViewerScreen> {
  late final Player _player;
  late final VideoController _controller;

  @override
  void initState() {
    super.initState();
    if (isVideo(widget.entry.path)) {
      _player = Player();
      _controller = VideoController(_player);
      _player.open(Media(mediaUrl(widget.entry.path)));
    }
  }

  @override
  void dispose() {
    if (isVideo(widget.entry.path)) _player.dispose();
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
            ? Video(controller: _controller)
            : InteractiveViewer(
                maxScale: 8,
                child: Image.network(
                  mediaUrl(e.path),
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
