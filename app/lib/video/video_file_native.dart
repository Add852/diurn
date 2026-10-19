import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

/// media_kit-based player for native platforms.
class VideoFileWidget extends StatefulWidget {
  final String url;
  const VideoFileWidget({super.key, required this.url});

  @override
  State<VideoFileWidget> createState() => _VideoFileWidgetState();
}

class _VideoFileWidgetState extends State<VideoFileWidget> {
  late final Player _player;
  late final VideoController _controller;

  @override
  void initState() {
    super.initState();
    MediaKit.ensureInitialized();
    _player = Player();
    // hardware decode renders black on some Android codecs (audio only) —
    // software decode is reliable; revisit if battery becomes an issue
    _controller = VideoController(
      _player,
      configuration: const VideoControllerConfiguration(
          enableHardwareAcceleration: false),
    );
    _player.open(Media(widget.url));
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Video(controller: _controller);
  }
}
