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
        if (!_loaded && !_failed) const _Shimmer(),
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

/// Animated sweep placeholder — clearly visible movement while the bytes
/// travel (no external package).
/// Animated shimmer tile for "not yet indexed" grid slots.
class ShimmerBox extends StatelessWidget {
  const ShimmerBox({super.key});

  @override
  Widget build(BuildContext context) => const _Shimmer();
}

class _Shimmer extends StatefulWidget {
  const _Shimmer();

  @override
  State<_Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<_Shimmer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const base = Color(0xff27272a);
    const highlight = Color(0xff3f3f46);
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        final t = _c.value;
        return Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment(-1.0 + 2 * t, 0),
              end: Alignment(0.0 + 2 * t, 0),
              colors: const [base, highlight, base],
            ),
          ),
        );
      },
    );
  }
}
