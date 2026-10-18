import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Compile-time default, used only to prefill the connect form:
///   flutter run --dart-define=DIURN_URL=http://192.168.1.20:12321
const kDefaultUrl = String.fromEnvironment(
  'DIURN_URL',
  defaultValue: 'http://127.0.0.1:12321',
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

/// POST /api/entries answered 409 — a note already exists for that date.
class EntryExistsException extends ApiException {
  EntryExistsException() : super('Entry already exists for this date');
}

/// One journal day: DB entry or fs-only {date}.md (id < 0).
class Entry {
  final int id;
  final String date;
  final String markdown;
  final bool fsOnly;
  const Entry({
    required this.id,
    required this.date,
    required this.markdown,
    required this.fsOnly,
  });

  factory Entry.fromJson(Map<String, dynamic> j) => Entry(
        id: j['id'] as int,
        date: j['date'] as String,
        markdown: j['rendered_markdown'] as String? ?? '',
        fsOnly: j['_fs_only'] as bool? ?? false,
      );
}

/// One row of the media cache (path, capture date, thumb availability).
class MediaFile {
  final String name;
  final String path;
  final String? date;
  final String type; // image | video
  final bool hasThumb;
  const MediaFile({
    required this.name,
    required this.path,
    required this.date,
    required this.type,
    required this.hasThumb,
  });

  factory MediaFile.fromJson(Map<String, dynamic> j) => MediaFile(
        name: j['name'] as String,
        path: j['path'] as String,
        date: j['date'] as String?,
        type: j['type'] as String,
        hasThumb: j['hasThumb'] as bool? ?? false,
      );

  bool get isVideo => type == 'video';
  bool get isImage => type == 'image';
}

class Api {
  final String baseUrl;
  final String? token;
  Api(this.baseUrl, {this.token});

  /// Media/thumbnail URLs carry ?token= because <img>/<video> tags cannot
  /// send Authorization headers.
  String _fileUrl(String endpoint, String path) {
    return Uri.parse('$baseUrl/api/$endpoint').replace(queryParameters: {
      'path': path,
      if (token != null) 'token': token,
    }).toString();
  }

  String mediaUrl(String path) => _fileUrl('media', path);
  String thumbUrl(String path) => _fileUrl('thumbnail', path);

  Future<dynamic> _getJson(String path, Map<String, String> query) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final http.Response res;
    try {
      res = await _client
          .get(uri, headers: {
            if (token != null) 'Authorization': 'Bearer $token',
          })
          .timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw ApiException('Request timed out');
    } catch (e) {
      throw ApiException('Cannot reach server: $e');
    }
    return _decodeBody(res.statusCode, res.body);
  }

  Future<dynamic> _send(
    String method,
    String path,
    Map<String, String> query,
    Map<String, dynamic>? body,
  ) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final req = http.Request(method, uri)
      ..headers['Content-Type'] = 'application/json';
    if (token != null) req.headers['Authorization'] = 'Bearer $token';
    if (body != null) req.body = jsonEncode(body);
    final http.StreamedResponse res;
    try {
      res = await _client.send(req).timeout(const Duration(seconds: 30));
    } on TimeoutException {
      throw ApiException('Request timed out');
    } catch (e) {
      throw ApiException('Cannot reach server: $e');
    }
    final text = await res.stream.bytesToString();
    return _decodeBody(res.statusCode, text);
  }

  dynamic _decodeBody(int status, String text) {
    if (status == 401) {
      throw ApiException('Unauthorized — check the token in settings');
    }
    final decoded = text.isEmpty ? null : jsonDecode(text);
    if (status == 409 && decoded is Map && decoded['exists'] == true) {
      throw EntryExistsException();
    }
    if (status >= 400) {
      final reason =
          decoded is Map && decoded['error'] != null ? decoded['error'] : text;
      throw ApiException('HTTP $status: $reason');
    }
    return decoded;
  }

  final http.Client _client = http.Client();

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

  /// GET /api/entries?year=&month=&date= — journal days, newest first.
  Future<List<Entry>> entries({String? year, String? month, String? date}) async {
    final v = await _getJson('/api/entries', {
      'year': ?year,
      'month': ?month,
      'date': ?date,
    });
    final list = (v as List).cast<Map<String, dynamic>>();
    return list.map(Entry.fromJson).toList();
  }

  /// GET /api/media — media cache rows (triggers an incremental scan).
  /// Returns (files, enabled, folder) so the UI can explain an empty grid.
  Future<(List<MediaFile>, bool, String)> mediaFiles() async {
    final v = await _getJson('/api/media', {});
    final list = (v['files'] as List).cast<Map<String, dynamic>>();
    return (
      list.map(MediaFile.fromJson).toList(),
      v['enabled'] as bool? ?? false,
      v['folder'] as String? ?? '',
    );
  }

  /// GET /api/form
  Future<FormInfo> form() async {
    final v = await _getJson('/api/form', {});
    return FormInfo.fromJson(v as Map<String, dynamic>);
  }

  /// POST /api/entries — throws EntryExistsException on 409.
  Future<String> createEntry(
    String date,
    Map<String, String> answers, {
    bool overwrite = false,
  }) async {
    final v = await _send('POST', '/api/entries', {}, {
      'date': date,
      if (overwrite) 'overwrite': true,
      'answers': answers,
    });
    return (v['rendered'] as String?) ?? '';
  }

  /// PUT /api/entries
  Future<void> updateEntry(String date, String markdown) async {
    await _send('PUT', '/api/entries', {}, {
      'date': date,
      'markdown': markdown,
    });
  }

  /// DELETE /api/entries?date=
  Future<void> deleteEntry(String date) async {
    await _send('DELETE', '/api/entries', {'date': date}, null);
  }

  /// GET /api/settings
  Future<Map<String, dynamic>> settings() async {
    final v = await _getJson('/api/settings', {});
    return v as Map<String, dynamic>;
  }

  /// PUT /api/settings — whitelisted profile fields + question upserts.
  Future<void> saveSettings(
    Map<String, dynamic> profile,
    List<Map<String, dynamic>> questions, {
    String? templateContent,
  }) async {
    await _send('PUT', '/api/settings', {}, {
      'profile': profile,
      'questions': questions,
      'template_content': ?templateContent,
    });
  }

  /// PUT /api/auth/account — change admin username/password.
  Future<void> updateAccount(String? username, String? password) async {
    await _send('PUT', '/api/auth/account', {}, {
      'username': ?username,
      'password': ?password,
    });
  }

  /// GET /api/template-content?path= — file content for the settings editor.
  Future<String> templateContent(String path) async {
    final v = await _getJson('/api/template-content', {'path': path});
    return v['content'] as String? ?? '';
  }

  /// GET /api/auth/status — public.
  Future<Map<String, dynamic>> authStatus() async {
    final v = await _getJson('/api/auth/status', {});
    return v as Map<String, dynamic>;
  }

  /// POST /api/auth/setup — first-run admin creation; returns session token.
  Future<String> setup(String password, String timezone) async {
    final v = await _send('POST', '/api/auth/setup', {}, {
      'password': password,
      'timezone': timezone,
    });
    return _loginToken(v);
  }

  /// POST /api/auth/login — credentials -> session token.
  Future<String> login(String username, String password) async {
    final v = await _send('POST', '/api/auth/login', {}, {
      'username': username,
      'password': password,
    });
    return _loginToken(v);
  }

  String _loginToken(dynamic v) {
    final t = v is Map ? v['token'] as String? : null;
    if (t == null || t.isEmpty) throw ApiException('No token in response');
    return t;
  }
}

/// One question of the active profile's form.
class FormQuestion {
  final String identifier;
  final String question;
  const FormQuestion({required this.identifier, required this.question});

  factory FormQuestion.fromJson(Map<String, dynamic> j) => FormQuestion(
        identifier: j['identifier'] as String,
        question: j['question'] as String,
      );
}

/// GET /api/form — today's date + asked questions.
class FormInfo {
  final String date;
  final List<FormQuestion> questions;
  const FormInfo({required this.date, required this.questions});

  factory FormInfo.fromJson(Map<String, dynamic> j) => FormInfo(
        date: j['date'] as String,
        questions: (j['questions'] as List)
            .cast<Map<String, dynamic>>()
            .map(FormQuestion.fromJson)
            .toList(),
      );
}
