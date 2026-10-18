import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'lightbox.dart';
import 'viewer.dart';

const _kPrefUrl = 'server_url';
const _kPrefToken = 'server_token';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
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

/// Bootstraps: load saved server URL -> /api/config -> tabs.
/// No saved URL, unreachable server, or gear tap -> connect form.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Api? _api;
  List<String> _roots = [];
  String _savedUrl = kDefaultUrl;
  String? _savedToken;
  bool _booting = true;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    setState(() => _booting = true);
    final prefs = await SharedPreferences.getInstance();
    _savedUrl = prefs.getString(_kPrefUrl) ?? kDefaultUrl;
    _savedToken = prefs.getString(_kPrefToken);
    if (!mounted) return;
    setState(() => _booting = false);
    await _connect(_savedUrl, _savedToken);
  }

  Future<void> _connect(String base, String? token) async {
    try {
      final roots = await Api(base, token: token).config();
      if (!mounted) return;
      setState(() {
        _api = Api(base, token: token);
        _roots = roots;
      });
    } catch (_) {
      // unreachable: connect form stays visible with its own error display
    }
  }

  Future<void> _onConnected(String base, String? token, List<String> roots) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kPrefUrl, base);
    if (token == null) {
      await prefs.remove(_kPrefToken);
    } else {
      await prefs.setString(_kPrefToken, token);
    }
    if (!mounted) return;
    setState(() {
      _savedUrl = base;
      _savedToken = token;
      _api = Api(base, token: token);
      _roots = roots;
    });
  }

  Future<void> _forget() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kPrefUrl);
    await prefs.remove(_kPrefToken);
    if (!mounted) return;
    setState(() => _api = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_booting) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final api = _api;
    if (api == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('diurn')),
        body: ConnectForm(
          initial: _savedUrl,
          initialToken: _savedToken,
          onConnected: _onConnected,
        ),
      );
    }
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('diurn'),
          actions: [
            IconButton(
              icon: const Icon(Icons.settings_outlined),
              tooltip: 'Change server',
              onPressed: _forget,
            ),
          ],
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

/// Server address form. Validates against /api/config before reporting
/// success; shows the server's/network's error verbatim on failure.
class ConnectForm extends StatefulWidget {
  final String initial;
  final String? initialToken;
  final void Function(String base, String? token, List<String> roots) onConnected;
  const ConnectForm({
    super.key,
    required this.initial,
    required this.initialToken,
    required this.onConnected,
  });

  @override
  State<ConnectForm> createState() => _ConnectFormState();
}

class _ConnectFormState extends State<ConnectForm> {
  late final TextEditingController _ctrl =
      TextEditingController(text: widget.initial);
  late final TextEditingController _tokenCtrl =
      TextEditingController(text: widget.initialToken ?? '');
  bool _checking = false;
  String? _error;

  Future<void> _save() async {
    var base = _ctrl.text.trim();
    if (base.isEmpty) {
      setState(() => _error = 'Enter a server address');
      return;
    }
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = 'http://$base';
    }
    while (base.endsWith('/')) {
      base = base.substring(0, base.length - 1);
    }
    setState(() {
      _checking = true;
      _error = null;
    });
    final token = _tokenCtrl.text.trim();
    try {
      final roots = await Api(base, token: token.isEmpty ? null : token).config();
      if (!mounted) return;
      widget.onConnected(base, token.isEmpty ? null : token, roots);
    } catch (e) {
      setState(() {
        _checking = false;
        _error = '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Connect to your diurn server',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 4),
          Text(
            'The address of the machine running the Rust server.',
            style: TextStyle(color: Colors.white.withValues(alpha: 0.6)),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _ctrl,
            keyboardType: TextInputType.url,
            autocorrect: false,
            enabled: !_checking,
            onSubmitted: (_) => _save(),
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'Server URL',
              hintText: 'http://192.168.1.147:8080',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _tokenCtrl,
            autocorrect: false,
            enabled: !_checking,
            onSubmitted: (_) => _save(),
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'Token (optional)',
              hintText: 'DIURN_TOKEN set on the server, if any',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          ],
          const SizedBox(height: 16),
          _checking
              ? const Center(child: CircularProgressIndicator())
              : FilledButton(onPressed: _save, child: const Text('Connect')),
        ],
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
                builder: (_) => MediaViewerScreen(
                  api: widget.api,
                  files: files,
                  initialIndex: i,
                ),
              )),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (isImage(f.path))
                      Image.network(
                        widget.api.thumbUrl(f.path),
                        fit: BoxFit.cover,
                        // thumbnail decode failed (e.g. unsupported format)
                        // -> fall back to the full-size image
                        errorBuilder: (_, _, _) =>
                            Image.network(widget.api.mediaUrl(f.path), fit: BoxFit.cover),
                      )
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
                              builder: (_) => ViewerScreen(
                                  api: widget.api, entry: e),
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
