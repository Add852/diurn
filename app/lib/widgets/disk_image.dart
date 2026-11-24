import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// Disk-backed byte cache for media URLs, shared by every media image.
///
/// The in-memory ImageCache clears on every Android low-memory signal and
/// evicts under scroll pressure; Image.network then redownloads the bytes
/// because dart:io has no HTTP cache. Keeping the bytes on disk turns a
/// remount after eviction into a local read + decode, not a network trip.
/// Web is skipped — the browser's HTTP cache (immutable media headers) does
/// this job there. ponytail: eviction is mtime-based LRU on a size cap, run
/// on startup and every 32nd write — upgrade to a proper index if the dir
/// grows big enough for listing to hurt.
class MediaBytesCache {
  MediaBytesCache._();
  static final MediaBytesCache instance = MediaBytesCache._();

  static const maxBytes = 256 << 20;
  Directory? _dir;
  bool _pruning = false;

  /// running total of cached bytes. The prune walks the whole cache dir
  /// (2 stats per file), so it used to run every 32nd write — thousands of
  /// syscalls while scrolling. Now it only walks when the cache is actually
  /// near the cap.
  int _totalBytes = -1;

  Future<Directory?> get dir async {
    if (kIsWeb) return null;
    if (_dir != null) return _dir;
    try {
      final base = await getApplicationCacheDirectory();
      final d = Directory('${base.path}/media');
      await d.create(recursive: true);
      _dir = d;
      unawaited(_prune());
    } catch (_) {
      _dir = null; // no cache dir → fetch-only mode
    }
    return _dir;
  }

  File? _fileFor(Directory d, String url) {
    final digest = sha1.convert(utf8.encode(url)).toString();
    return File('${d.path}/$digest');
  }

  Future<Uint8List?> read(String url) async {
    final d = await dir;
    if (d == null) return null;
    try {
      return await _fileFor(d, url)!.readAsBytes();
    } catch (_) {
      return null;
    }
  }

  Future<void> write(String url, Uint8List bytes) async {
    final d = await dir;
    if (d == null) return;
    try {
      await _fileFor(d, url)!.writeAsBytes(bytes, flush: true);
      if (_totalBytes < 0) {
        _totalBytes = await _dirSize(d);
      } else {
        _totalBytes += bytes.length;
      }
      if (_totalBytes > maxBytes) unawaited(_prune());
    } catch (_) {
      // cache write failures must never break rendering
    }
  }

  Future<int> _dirSize(Directory d) async {
    var total = 0;
    try {
      await for (final e in d.list()) {
        if (e is! File) continue;
        try {
          total += await e.length();
        } catch (_) {}
      }
    } catch (_) {}
    return total;
  }

  /// Delete oldest files until the dir fits in maxBytes.
  Future<void> _prune() async {
    if (_pruning) return;
    _pruning = true;
    try {
      final d = await dir;
      if (d == null) return;
      final files = <File, ({int size, DateTime mtime})>{};
      var total = 0;
      await for (final e in d.list()) {
        if (e is! File) continue;
        try {
          final s = await e.length();
          final m = await e.lastModified();
          files[e] = (size: s, mtime: m);
          total += s;
        } catch (_) {}
      }
      if (total <= maxBytes) {
        _totalBytes = total;
        return;
      }
      final oldest = files.keys.toList()
        ..sort((a, b) => files[a]!.mtime.compareTo(files[b]!.mtime));
      for (final f in oldest) {
        if (total <= maxBytes) break;
        total -= files[f]!.size;
        try {
          await f.delete();
        } catch (_) {}
      }
      _totalBytes = total;
    } catch (_) {
      // pruning is best-effort
    } finally {
      _pruning = false;
    }
  }
}

/// Shared HTTP client for media bytes — one keep-alive connection instead of
/// a new TCP + TLS handshake per image.
final http.Client _client = http.Client();

/// ImageProvider that serves bytes through [MediaBytesCache].
/// Drop-in for Image.network's provider; cacheWidth etc. still apply via
/// the Image widget's ResizeImage wrapping.
class MediaImageProvider extends ImageProvider<MediaImageProvider> {
  final String url;
  final double scale;
  const MediaImageProvider(this.url, {this.scale = 1.0});

  @override
  Future<MediaImageProvider> obtainKey(ImageConfiguration configuration) =>
      SynchronousFuture<MediaImageProvider>(this);

  @override
  ImageStreamCompleter loadImage(
    MediaImageProvider key,
    ImageDecoderCallback decode,
  ) {
    return MultiFrameImageStreamCompleter(
      codec: _load(key, decode),
      scale: key.scale,
    );
  }

  Future<ui.Codec> _load(
    MediaImageProvider key,
    ImageDecoderCallback decode,
  ) async {
    Uint8List? bytes = await MediaBytesCache.instance.read(key.url);
    if (bytes == null) {
      // one shared client for every image: http.get() opens (and closes) a
      // fresh connection per call, so a screen full of tiles paid a TCP +
      // TLS handshake each. keep-alive reuses one.
      final res = await _client.get(Uri.parse(key.url));
      if (res.statusCode != 200) {
        throw StateError('HTTP ${res.statusCode} for ${key.url}');
      }
      bytes = res.bodyBytes;
      unawaited(MediaBytesCache.instance.write(key.url, bytes));
    }
    final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
    return decode(buffer);
  }

  @override
  bool operator ==(Object other) =>
      other is MediaImageProvider && other.url == url && other.scale == scale;

  @override
  int get hashCode => Object.hash(url, scale);

  @override
  String toString() => 'MediaImageProvider("$url")';
}
