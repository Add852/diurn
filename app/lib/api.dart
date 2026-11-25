import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Top-level so [compute] can run it on a background isolate.
dynamic _parseLargeJson(String text) => jsonDecode(text);

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

  /// "YYYY-MM-DD HH:MM" wall-clock capture time in the profile timezone
  /// (null when only a date is known).
  final String? takenAt;
  final String type; // image | video
  final bool hasThumb;
  const MediaFile({
    required this.name,
    required this.path,
    required this.date,
    this.takenAt,
    required this.type,
    required this.hasThumb,
  });

  factory MediaFile.fromJson(Map<String, dynamic> j) => MediaFile(
        name: j['name'] as String,
        path: j['path'] as String,
        date: j['date'] as String?,
        takenAt: j['takenAt'] as String?,
        type: j['type'] as String,
        hasThumb: j['hasThumb'] as bool? ?? false,
      );

  bool get isVideo => type == 'video';
  bool get isImage => type == 'image';
}

class Api {
  final String baseUrl;
  final String? username;
  final String? password;
  Api(this.baseUrl, {this.username, this.password});

  /// base64(user:pass) — HTTP Basic for JSON calls; ?auth= fallback for
  /// <img>/<video> tags which cannot send headers.
  String? get _authParam => (username == null || password == null)
      ? null
      : base64.encode(utf8.encode('${username!}:${password!}'));

  String? debugAuthParam() => _authParam;

  Map<String, String> get _authHeaders => {
        if (_authParam != null) 'Authorization': 'Basic ${_authParam!}',
      };

  /// Media/thumbnail URLs carry ?auth= because <img>/<video> tags cannot
  /// send Authorization headers.
  String _fileUrl(String endpoint, String path) {
    return Uri.parse('$baseUrl/api/$endpoint').replace(queryParameters: {
      'path': path,
      'auth': ?_authParam,
    }).toString();
  }

  String mediaUrl(String path) => _fileUrl('media/file', path);
  String thumbUrl(String path) => _fileUrl('thumbnail', path);

  Future<dynamic> _getJson(String path, Map<String, String> query) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final http.Response res;
    try {
      res = await _client
          .get(uri, headers: _authHeaders)
          .timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw ApiException('Request timed out');
    } catch (e) {
      throw ApiException('Cannot reach server: $e');
    }
    return _decodeBodyAsync(res.statusCode, res.body);
  }

  Future<dynamic> _send(
    String method,
    String path,
    Map<String, String> query,
    Map<String, dynamic>? body,
  ) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final req = http.Request(method, uri)
      ..headers['Content-Type'] = 'application/json'
      ..headers.addAll(_authHeaders);
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
    return _decodeBodyAsync(res.statusCode, text);
  }

  /// JSON decoding is synchronous. On a big media payload it can occupy the
  /// UI isolate for several frames right after navigation; parse large bodies
  /// on a worker isolate instead.
  Future<dynamic> _decodeBodyAsync(int status, String text) async {
    if (status != 401 && text.length > 256 * 1024 && !kIsWeb) {
      try {
        return await compute(_parseLargeJson, text);
      } catch (_) {
        // fall through to the normal error-body handling
      }
    }
    return _decodeBody(status, text);
  }

  dynamic _decodeBody(int status, String text) {
    if (status == 401) {
      throw ApiException('Unauthorized — check username/password in settings');
    }
    dynamic decoded;
    if (text.isNotEmpty) {
      try {
        decoded = jsonDecode(text);
      } catch (_) {
        decoded = null; // plain-text error bodies surface verbatim below
      }
    }
    if (status == 409 && decoded is Map && decoded['exists'] == true) {
      throw EntryExistsException();
    }
    if (status >= 400) {
      final reason = decoded is Map && decoded['error'] != null
          ? '${decoded['error']}'
          : text.trim();
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

  /// Just the dates that have entries — no markdown. The media tab uses this
  /// to decide which days get an "view entry" button.
  Future<List<String>> entryDates() async {
    final v = await _getJson('/api/entries', {'dates': '1'});
    return ((v as Map)['dates'] as List).cast<String>();
  }

  /// GET /api/media — media cache rows (triggers an incremental scan).
  /// Returns (files, folder) so the UI can explain an empty grid.
  /// GET /api/media — cached list + whether a background scan is in flight.
  ///
  /// [refresh] forces the server to re-walk the folder now, ignoring its
  /// scan cooldown (pull-to-refresh).
  Future<(List<MediaFile>, String, bool)> mediaFiles({bool refresh = false}) async {
    final v = await _getJson('/api/media', {
      if (refresh) 'refresh': '1',
    });
    final list = (v['files'] as List).cast<Map<String, dynamic>>();
    return (
      list.map(MediaFile.fromJson).toList(),
      v['folder'] as String? ?? '',
      v['scanning'] as bool? ?? false,
    );
  }

  /// Cheap scan status — no file list, no scan kick. Polling this while a
  /// scan runs avoids re-downloading the whole library every few seconds.
  Future<(bool scanning, int count)> mediaStatus() async {
    final v = await _getJson('/api/media', {'status': '1'});
    return (
      v['scanning'] as bool? ?? false,
      (v['count'] as num?)?.toInt() ?? 0,
    );
  }

  /// One representative media file per capture day — the journal cards and
  /// the form strip only need a cover per day, not every file.
  Future<List<MediaFile>> mediaDays() async {
    final v = await _getJson('/api/media', {'days': '1'});
    final list = (v['files'] as List).cast<Map<String, dynamic>>();
    return list.map(MediaFile.fromJson).toList();
  }

  /// POST /api/media/cache/clear — drop cached media rows + generated thumbs.
  /// Returns the number of cleared cache rows.
  Future<int> clearMediaCache() async {
    final v = await _send('POST', '/api/media/cache/clear', {}, null);
    return (v is Map ? v['cleared'] : 0) as int? ?? 0;
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

  /// POST /api/auth/setup — first-run admin creation.
  Future<void> setup(String password, String timezone) async {
    await _send('POST', '/api/auth/setup', {}, {
      'password': password,
      'timezone': timezone,
    });
  }

  /// POST /api/auth/verify — throws on bad credentials.
  Future<void> verify(String username, String password) async {
    await _send('POST', '/api/auth/verify', {}, {
      'username': username,
      'password': password,
    });
  }

  /// POST /api/auth/reset — restore all settings + account to defaults.
  Future<void> resetDefaults() async {
    await _send('POST', '/api/auth/reset', {}, null);
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
