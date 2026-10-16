import 'package:flutter_test/flutter_test.dart';

import 'package:diurn/api.dart';

void main() {
  test('FsEntry.fromJson parses camelCase payload', () {
    final e = FsEntry.fromJson({
      'name': 'a.jpg',
      'path': '/srv/media/a.jpg',
      'isDir': false,
    });
    expect(e.name, 'a.jpg');
    expect(e.path, '/srv/media/a.jpg');
    expect(e.isDir, isFalse);
  });

  test('media classification', () {
    expect(isVideo('/x/clip.MP4'), isTrue);
    expect(isImage('/x/pic.PNG'), isTrue);
    expect(isMedia('/x/notes.txt'), isFalse);
    expect(isMedia('/x/noext'), isFalse);
  });

  test('mediaUrl encodes the path as a query param', () {
    final url = mediaUrl('/srv/my media/a&b.jpg');
    expect(url.startsWith('$kBaseUrl/api/media?path='), isTrue);
    expect(Uri.parse(url).queryParameters['path'], '/srv/my media/a&b.jpg');
  });
}
