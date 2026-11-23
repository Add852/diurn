import 'package:flutter/material.dart';

/// Fixed-extent delegate for pinned section headers. Use as
/// `SliverPersistentHeader(pinned: true, delegate: StickyHeaderDelegate(...))`
/// at the top of a section (e.g. inside a SliverMainAxisGroup): the header
/// pins to the viewport top while its section scrolls, and the next
/// section's header pushes it away — the visible header always names the
/// section currently on screen.
class StickyHeaderDelegate extends SliverPersistentHeaderDelegate {
  final double extent;
  final Widget child;

  StickyHeaderDelegate({required this.extent, required this.child});

  @override
  double get maxExtent => extent;

  @override
  double get minExtent => extent;

  @override
  Widget build(
          BuildContext context, double shrinkOffset, bool overlapsContent) =>
      // opaque background so scrolled content doesn't show through
      ColoredBox(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: child,
      );

  @override
  bool shouldRebuild(StickyHeaderDelegate oldDelegate) =>
      oldDelegate.extent != extent || oldDelegate.child != child;
}
