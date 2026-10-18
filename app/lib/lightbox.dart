import 'package:flutter/material.dart';

import 'api.dart';
import 'viewer.dart';

/// Horizontal strip of one day's media; tap a thumb for the lightbox.
class MediaStrip extends StatelessWidget {
  final Api api;
  final List<MediaFile> files;
  final double size;
  const MediaStrip({
    super.key,
    required this.api,
    required this.files,
    this.size = 84,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: size,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: files.length,
        itemBuilder: (context, i) {
          final f = files[i];
          return GestureDetector(
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) =>
                  MediaViewerScreen(api: api, files: files, initialIndex: i),
            )),
            child: Padding(
              padding: EdgeInsets.only(right: 8),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(
                  f.hasThumb ? api.thumbUrl(f.path) : api.mediaUrl(f.path),
                  fit: BoxFit.cover,
                  width: size,
                  height: size,
                  errorBuilder: (_, _, _) => Container(
                    width: size,
                    height: size,
                    color: Theme.of(context).colorScheme.surfaceContainerHighest,
                    child: Icon(Icons.movie_outlined,
                        size: size / 3.8,
                        color: Theme.of(context).colorScheme.outline),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

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
      body: Stack(
        children: [
          PageView.builder(
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
          // explicit prev/next over the swipe gesture
          if (_index > 0)
            Positioned(
              left: 8,
              top: 0,
              bottom: 0,
              child: Center(
                child: _navButton(Icons.chevron_left, () {
                  _controller.previousPage(
                      duration: const Duration(milliseconds: 250),
                      curve: Curves.easeOut);
                }),
              ),
            ),
          if (_index < files.length - 1)
            Positioned(
              right: 8,
              top: 0,
              bottom: 0,
              child: Center(
                child: _navButton(Icons.chevron_right, () {
                  _controller.nextPage(
                      duration: const Duration(milliseconds: 250),
                      curve: Curves.easeOut);
                }),
              ),
            ),
        ],
      ),
    );
  }

  Widget _navButton(IconData icon, VoidCallback onTap) {
    return IconButton.filledTonal(
      onPressed: onTap,
      icon: Icon(icon, size: 32),
      style: IconButton.styleFrom(
        backgroundColor: Colors.black.withValues(alpha: 0.45),
        foregroundColor: Colors.white,
      ),
    );
  }
}
