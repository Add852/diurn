import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';

import 'api.dart';
import 'viewer.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();
  runApp(const DiurnApp());
}

class DiurnApp extends StatelessWidget {
  const DiurnApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'diurn',
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xff09090b), // zinc-950
        appBarTheme: const AppBarTheme(backgroundColor: Color(0xff18181b)),
      ),
      home: const HomeScreen(),
    );
  }
}

/// Bootstraps /api/config, then shows Media + Browse tabs rooted at roots[0].
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Api? _api;
  List<String> _roots = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    final api = Api();
    try {
      final roots = await api.config();
      if (roots.isEmpty) throw ApiException('server has no configured roots');
      setState(() {
        _api = api;
        _roots = roots;
      });
    } catch (e) {
      setState(() => _error = 'Cannot reach server at $kBaseUrl\n\n$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(_error!, textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(onPressed: _load, child: const Text('Retry')),
              ],
            ),
          ),
        ),
      );
    }
    if (_api == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final api = _api!;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('diurn'),
          bottom: const TabBar(
            tabs: [Tab(text: 'Media'), Tab(text: 'Browse')],
          ),
        ),
        body: TabBarView(
          children: [
            MediaGridScreen(api: api, root: _roots.first),
            BrowserScreen(api: api, initialDir: _roots.first),
          ],
        ),
      ),
    );
  }
}

class MediaGridScreen extends StatefulWidget {
  final Api api;
  final String root;
  const MediaGridScreen({super.key, required this.api, required this.root});

  @override
  State<MediaGridScreen> createState() => _MediaGridScreenState();
}

class _MediaGridScreenState extends State<MediaGridScreen> {
  late final Future<List<FsEntry>> _files;

  @override
  void initState() {
    super.initState();
    _files = widget.api
        .listDir(widget.root, filter: 'media')
        .then((e) => e.where((f) => !f.isDir && isMedia(f.path)).toList());
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<FsEntry>>(
      future: _files,
      builder: (context, snap) {
        if (snap.hasError) {
          return Center(child: Text('${snap.error}'));
        }
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final files = snap.data!;
        if (files.isEmpty) {
          return const Center(child: Text('No media found in root'));
        }
        return GridView.builder(
          padding: const EdgeInsets.all(8),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 180,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
          ),
          itemCount: files.length,
          itemBuilder: (context, i) {
            final f = files[i];
            return InkWell(
              onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => ViewerScreen(entry: f),
              )),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (isImage(f.path))
                      Image.network(mediaUrl(f.path), fit: BoxFit.cover)
                    else
                      const ColoredBox(
                        color: Color(0xff27272a),
                        child: Icon(Icons.movie_outlined, size: 40),
                      ),
                    Positioned(
                      left: 6,
                      right: 6,
                      bottom: 6,
                      child: Text(
                        f.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11, shadows: [Shadow(blurRadius: 4)]),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

/// Simple directory browser mirroring the old settings dir-picker flow.
class BrowserScreen extends StatefulWidget {
  final Api api;
  final String initialDir;
  const BrowserScreen({
    super.key,
    required this.api,
    required this.initialDir,
  });

  @override
  State<BrowserScreen> createState() => _BrowserScreenState();
}

class _BrowserScreenState extends State<BrowserScreen> {
  late String _dir;
  late Future<List<FsEntry>> _future;

  @override
  void initState() {
    super.initState();
    _dir = widget.initialDir;
    _future = widget.api.listDir(_dir);
  }

  void _open(String dir) {
    setState(() {
      _dir = dir;
      _future = widget.api.listDir(dir);
    });
  }

  void _up() {
    final i = _dir.lastIndexOf('/');
    if (i > 0) _open(_dir.substring(0, i));
  }

  @override
  Widget build(BuildContext context) {
    final canUp = _dir.length > widget.initialDir.length;
    return Scaffold(
      appBar: AppBar(
        leading: canUp ? BackButton(onPressed: _up) : null,
        title: Text(_dir.split('/').where((s) => s.isNotEmpty).last),
      ),
      body: FutureBuilder<List<FsEntry>>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final entries = snap.data!;
          return ListView.builder(
            itemCount: entries.length,
            itemBuilder: (context, i) {
              final e = entries[i];
              final media = isMedia(e.path);
              return ListTile(
                leading: Icon(
                  e.isDir
                      ? Icons.folder_outlined
                      : media
                          ? (isVideo(e.path)
                              ? Icons.movie_outlined
                              : Icons.image_outlined)
                          : Icons.insert_drive_file_outlined,
                ),
                title: Text(e.name),
                onTap: e.isDir
                    ? () => _open(e.path)
                    : media
                        ? () => Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) => ViewerScreen(entry: e),
                            ))
                        : null,
              );
            },
          );
        },
      ),
    );
  }
}
