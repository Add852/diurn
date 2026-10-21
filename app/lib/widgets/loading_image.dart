import 'package:flutter/material.dart';

/// Network image with a loading placeholder: muted background + spinner
/// until the first frame arrives, then a quick fade-in.
class LoadingImage extends StatefulWidget {
  final String url;
  final BoxFit fit;

  /// Shown in place of the spinner on decode/server failure.
  final Widget? errorWidget;

  const LoadingImage({
    super.key,
    required this.url,
    this.fit = BoxFit.cover,
    this.errorWidget,
  });

  @override
  State<LoadingImage> createState() => _LoadingImageState();
}

class _LoadingImageState extends State<LoadingImage> {
  bool _loaded = false;
  bool _failed = false;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        if (!_loaded && !_failed)
          const ColoredBox(
            color: Color(0x3327272a),
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ),
        if (_failed)
          Center(
            child: widget.errorWidget ??
                Icon(Icons.broken_image_outlined,
                    size: 32,
                    color: Theme.of(context).colorScheme.outline),
          )
        else
          Positioned.fill(
            child: Image.network(
              widget.url,
              fit: widget.fit,
              frameBuilder: (context, child, frame, wasSynchronous) {
                final done = wasSynchronous || frame != null;
                if (done != _loaded) {
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    if (mounted) setState(() => _loaded = done);
                  });
                }
                return AnimatedOpacity(
                  opacity: done ? 1 : 0,
                  duration: const Duration(milliseconds: 250),
                  child: child,
                );
              },
              errorBuilder: (_, _, _) {
                if (!_failed) {
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    if (mounted) setState(() => _failed = true);
                  });
                }
                return const SizedBox.shrink();
              },
            ),
          ),
      ],
    );
  }
}
