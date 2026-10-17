import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

/// video_player-based player for web (HTML5 video; Range streaming from
/// the Rust server works as-is).
class VideoFileWidget extends StatefulWidget {
  final String url;
  const VideoFileWidget({super.key, required this.url});

  @override
  State<VideoFileWidget> createState() => _VideoFileWidgetState();
}

class _VideoFileWidgetState extends State<VideoFileWidget> {
  late final VideoPlayerController _controller;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _controller.initialize().then((_) {
      if (!mounted) return;
      setState(() {});
      _controller.play();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_controller.value.isInitialized) {
      return const Center(child: CircularProgressIndicator());
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        AspectRatio(
          aspectRatio: _controller.value.aspectRatio,
          child: VideoPlayer(_controller),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            IconButton(
              onPressed: () => setState(() {
                _controller.value.isPlaying
                    ? _controller.pause()
                    : _controller.play();
              }),
              icon: Icon(_controller.value.isPlaying
                  ? Icons.pause
                  : Icons.play_arrow),
            ),
            Text('$_position/${_controller.value.duration}',
              style: const TextStyle(fontSize: 12),
            ),
          ],
        ),
      ],
    );
  }

  String get _position {
    final p = _controller.value.position;
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(p.inMinutes)}:${two(p.inSeconds % 60)}';
  }
}
