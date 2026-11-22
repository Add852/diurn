import 'package:flutter_test/flutter_test.dart';

import 'package:diurn/api.dart';
import 'package:diurn/format.dart';
import 'package:diurn/journal.dart';

Entry _entry(String date, String note) => Entry(
      id: 1,
      date: date,
      markdown: note,
      fsOnly: false,
    );

void main() {
  test('filterEntries: query matches body, date, and metadata values', () {
    final entries = [
      _entry('2026-01-10', '---\nrating: 5\n---\nA long walk in the park'),
      _entry('2026-01-11', '---\nrating: 2\n---\nStayed home, read a book'),
      _entry('2026-01-12', 'No frontmatter, mentioned Saturday plans'),
    ];
    expect(filterEntries(entries, query: 'walk').length, 1);
    expect(filterEntries(entries, query: '2026-01-11').length, 1);
    // metadata values are searchable text too
    expect(filterEntries(entries, query: 'saturday').length, 1);
    // multiple tokens: all must match (AND)
    expect(filterEntries(entries, query: 'walk park').length, 1);
    expect(filterEntries(entries, query: 'walk book').length, 0);
    // case-insensitive
    expect(filterEntries(entries, query: 'WALK').length, 1);
  });

  test('filterEntries: exact key=value filters, combined with query', () {
    final entries = [
      _entry('2026-01-10', '---\nrating: 5\n---\nwalk'),
      _entry('2026-01-11', '---\nrating: 2\n---\nwalk'),
    ];
    expect(
        filterEntries(entries, filters: {'rating': '5'}).map((e) => e.date),
        ['2026-01-10']);
    // filter AND query combine
    expect(
        filterEntries(entries,
            query: 'book', filters: {'rating': '5'}).length,
        0);
    // unknown key never matches
    expect(filterEntries(entries, filters: {'mood': 'good'}).length, 0);
  });

  test('friendly date formatting', () {
    expect(monthTitle('2026-01'), 'January 2026');
    expect(monthTitle('2026-12'), 'December 2026');
    expect(monthTitle('Undated'), 'Undated');
    expect(dayLabel('2026-01-05'), '5');
    expect(dayLabel('2026-01-15'), '15');
    expect(dayLabel('weird'), 'weird');
    // 2026-01-10 is a Saturday
    expect(longDate('2026-01-10'), 'Sat, 10 Jan 2026');
    expect(dayTitle('2026-01-10'), 'Saturday, 10 January');
    expect(dayTitle('Undated'), 'Undated');
    expect(timeLabel('2026-01-10 01:42'), '1:42 AM');
    expect(timeLabel('2026-01-10 13:05'), '1:05 PM');
    expect(timeLabel('2026-01-10 00:00'), '12:00 AM');
    expect(timeLabel('2026-01-10 12:00'), '12:00 PM');
    expect(timeLabel(null), '');
    expect(timeLabel('date-only'), '');
  });

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
