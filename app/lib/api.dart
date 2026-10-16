import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Server URL, injected at build/run time:
///   flutter run --dart-define=DIURN_URL=http://192.168.1.20:8080
/// ponytail: hardcoded base URL; add a settings field once there is auth.
const kBaseUrl = String.fromEnvironment(
  'DIURN_URL',
  defaultValue: 'http://127.0.0.1:8080',
);

/// Media file extensions the server recognises (mirror of MEDIA_EXTS).
const kVideoExts = {'mp4', 'mkv', 'webm', 'mov', 'avi'};
const kImageExts = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'};

String? ext(String path) {
  final i = path.lastIndexOf('.');
  return i < 0 ? null : path.substring(i + 1).toLowerCase();
}

bool isVideo(String path) => kVideoExts.contains(ext(path));
bool isImage(String path) => kImageExts.contains(ext(path));
bool isMedia(String path) => isVideo(path) || isImage(path);

String mediaUrl(String path) =>
    '$kBaseUrl/api/media?path=${Uri.encodeQueryComponent(path)}';

class FsEntry {
  final String name;
  final String path;
  final bool isDir;
  const FsEntry({required this.name, required this.path, required this.isDir});

  factory FsEntry.fromJson(Map<String, dynamic> j) => FsEntry(
        name: j['name'] as String,
        path: j['path'] as String,
        isDir: j['isDir'] as bool,
      );
}

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

class Api {
  final http.Client _client = http.Client();

  Future<dynamic> _getJson(String path, Map<String, String> query) async {
    final uri =
        Uri.parse('$kBaseUrl$path').replace(queryParameters: query);
    final http.Response res;
    try {
      res = await _client.get(uri).timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw ApiException('Request timed out');
    } catch (e) {
      throw ApiException('Cannot reach server: $e');
    }
    if (res.statusCode != 200) {
      throw ApiException('HTTP ${res.statusCode}: ${res.body}');
    }
    return jsonDecode(res.body);
  }

  /// GET /api/config -> allowed roots
  Future<List<String>> config() async {
    final v = await _getJson('/api/config', {});
    return List<String>.from(v['roots'] as List);
  }

  /// GET /api/fs?dir=...&filter=...
  Future<List<FsEntry>> listDir(String dir, {String? filter}) async {
    final v = await _getJson('/api/fs', {
      'dir': dir,
      'filter': ?filter,
    });
    final list = (v['entries'] as List).cast<Map<String, dynamic>>();
    return list.map(FsEntry.fromJson).toList();
  }

  /// GET /api/fs?check=...&kind=...
  Future<(bool, String?)> checkPath(String path, {String? kind}) async {
    final v = await _getJson('/api/fs', {
      'check': path,
      'kind': ?kind,
    });
    return (v['ok'] as bool, v['reason'] as String?);
  }
}
