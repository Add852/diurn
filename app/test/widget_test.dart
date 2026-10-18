import 'package:flutter_test/flutter_test.dart';

import 'package:diurn/api.dart';
import 'package:diurn/journal.dart';

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
    final api = Api('http://192.168.1.147:12321');
    final url = api.mediaUrl('/srv/my media/a&b.jpg');
    expect(url.startsWith('http://192.168.1.147:12321/api/media/file?path='), isTrue);
    expect(Uri.parse(url).queryParameters['path'], '/srv/my media/a&b.jpg');
  });

  test('frontmatter split (port of frontmatter.ts)', () {
    final (fm, body) = parseFrontmatter(
        '---\nweight: 2\nrating: 3\nday: Saturday\n---\n\n### Question\n- answer');
    expect(fm, {'weight': '2', 'rating': '3', 'day': 'Saturday'});
    expect(body, '\n### Question\n- answer');

    final (empty, plain) = parseFrontmatter('no frontmatter here');
    expect(empty, isEmpty);
    expect(plain, 'no frontmatter here');
  });

  test('Entry and MediaFile parse server JSON', () {
    final e = Entry.fromJson({
      'id': -3,
      'date': '2026-10-17',
      'rendered_markdown': 'note',
      '_fs_only': true,
    });
    expect(e.fsOnly, isTrue);
    expect(e.id, -3);

    final f = MediaFile.fromJson({
      'name': 'pic.jpg',
      'path': '/srv/pic.jpg',
      'date': '2026-10-17',
      'type': 'image',
      'hasThumb': true,
    });
    expect(f.isImage, isTrue);
    expect(f.isVideo, isFalse);
    expect(f.hasThumb, isTrue);
  });
}
