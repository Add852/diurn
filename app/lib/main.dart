import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'form.dart';
import 'journal.dart';
import 'lightbox.dart';
import 'settings.dart';
import 'widgets/timezone_field.dart';

const _kPrefUrl = 'server_url';
const _kPrefUser = 'server_user';
const _kPrefPass = 'server_pass';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DiurnApp());
}

/// Appearance (theme mode + accent) lives in the server profile and is
/// applied on connect and after each settings save.
class DiurnApp extends StatefulWidget {
  const DiurnApp({super.key});

  @override
  State<DiurnApp> createState() => _DiurnAppState();
}

class _DiurnAppState extends State<DiurnApp> {
  ThemeMode _themeMode = ThemeMode.system;
  Color _accent = const Color(0xff22c55e); // green default

  /// profile = the "profile" object from GET/PUT /api/settings.
  void applyAppearance(Map<String, dynamic>? profile) {
    if (profile == null) return;
    setState(() {
      switch (profile['theme_mode'] as String?) {
        case 'dark':
          _themeMode = ThemeMode.dark;
        case 'light':
          _themeMode = ThemeMode.light;
        default:
          _themeMode = ThemeMode.system;
      }
      final hex = profile['accent_color'] as String?;
      if (hex != null && RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(hex)) {
        _accent = Color(int.parse(hex.substring(1), radix: 16) | 0xff000000);
      }
    });
  }

  ThemeData _theme(Brightness brightness) => ThemeData(
        useMaterial3: true,
        colorScheme:
            ColorScheme.fromSeed(seedColor: _accent, brightness: brightness),
        scaffoldBackgroundColor:
            brightness == Brightness.dark ? const Color(0xff09090b) : null,
        appBarTheme: AppBarTheme(
          backgroundColor:
              brightness == Brightness.dark ? const Color(0xff18181b) : null,
        ),
      );

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'diurn',
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      themeMode: _themeMode,
      home: HomeScreen(onAppearance: applyAppearance),
    );
  }
}

/// Bootstraps: load saved server URL -> /api/config -> tabs.
/// No saved URL, unreachable server, or gear tap -> connect form.
class HomeScreen extends StatefulWidget {
  /// Applies the profile's theme mode + accent (called after connect and
  /// whenever settings are saved).
  final void Function(Map<String, dynamic>? profile)? onAppearance;
  const HomeScreen({super.key, this.onAppearance});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;
  Api? _api;
  String _savedUrl = kDefaultUrl;
  String? _savedUser;
  String? _savedPass;
  String? _authMode; // 'setup' | 'password' | null
  String? _hintUser; // username hint from /api/auth/status
  bool _booting = true;

  /// Bumped when profile settings may have changed (folders, etc.) so tabs
  /// refetch — TabBarView keeps tab state alive across navigations.
  final ValueNotifier<int> _refreshTick = ValueNotifier(0);

  /// Bumped when the FAB asks the Settings tab to save itself.
  final ValueNotifier<int> _saveTrigger = ValueNotifier(0);

  @override
  void dispose() {
    _refreshTick.dispose();
    _saveTrigger.dispose();
    super.dispose();
  }

  /// Single navigation entry point: entering OR leaving Settings bumps the
  /// refresh signal — the tab always loads the last saved settings.
  void _select(int i) {
    if (i == _index) return;
    if (i == 3 || _index == 3) _refreshTick.value++;
    setState(() => _index = i);
  }

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    setState(() => _booting = true);
    final prefs = await SharedPreferences.getInstance();
    _savedUrl = prefs.getString(_kPrefUrl) ?? kDefaultUrl;
    _savedUser = prefs.getString(_kPrefUser);
    _savedPass = prefs.getString(_kPrefPass);
    if (!mounted) return;
    setState(() => _booting = false);
    await _connect(_savedUrl, _savedUser, _savedPass);
  }

  Future<void> _connect(String base, String? user, String? pass) async {
    try {
      // config doubles as the auth check (401 -> credential fallback below)
      await Api(base, username: user, password: pass).config();
      if (!mounted) return;
      // Fresh install: config is open pre-setup, but there is no profile yet —
      // route to the setup screen instead of the (broken) tabs.
      final st = await Api(base).authStatus();
      if (!mounted) return;
      if (st['needs_setup'] == true) {
        setState(() {
          _authMode = 'setup';
          _hintUser = null;
        });
        return;
      }
      setState(() {
        _api = Api(base, username: user, password: pass);
        _authMode = null;
      });
      _loadAppearance();
    } catch (e) {
      // 401 -> ask the server which credentials it wants (and whose name to show)
      if ('$e'.contains('Unauthorized') || '$e'.contains('401')) {
        try {
          final st = await Api(base).authStatus();
          if (!mounted) return;
          setState(() {
            _authMode = st['mode'] as String? ?? 'password';
            _hintUser = st['username'] as String?;
          });
        } catch (_) {}
      }
    }
  }

  Future<void> _onConnected(
      String base, String? user, String? pass, List<String> roots) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kPrefUrl, base);
    if (user == null || pass == null) {
      await prefs.remove(_kPrefUser);
      await prefs.remove(_kPrefPass);
    } else {
      await prefs.setString(_kPrefUser, user);
      await prefs.setString(_kPrefPass, pass);
    }
    if (!mounted) return;
    setState(() {
      _savedUrl = base;
      _savedUser = user;
      _savedPass = pass;
      _api = Api(base, username: user, password: pass);
    });
    _loadAppearance();
  }

  /// Theme mode + accent from the profile — applied at the app level.
  Future<void> _loadAppearance() async {
    try {
      final s = await _api!.settings();
      if (!mounted) return;
      widget.onAppearance?.call(s['profile'] as Map<String, dynamic>?);
    } catch (_) {
      // appearance is cosmetic — never block the connect flow
    }
  }

  /// Called by Settings after account update/reset.
  Future<void> _setCredentials(String? user, String? pass) async {
    final prefs = await SharedPreferences.getInstance();
    final newUser = user ?? _savedUser;
    final newPass = pass ?? _savedPass;
    if (newUser != null) await prefs.setString(_kPrefUser, newUser);
    if (newPass != null) await prefs.setString(_kPrefPass, newPass);
    if (!mounted) return;
    setState(() {
      _savedUser = newUser;
      _savedPass = newPass;
      _api = Api(_savedUrl, username: newUser, password: newPass);
    });
  }

  Future<void> _forget() async {
    // Disconnect synchronously FIRST — navigation fires refresh signals and
    // an awaited prefs write would lose that race.
    if (!mounted) return;
    setState(() => _api = null);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kPrefUrl);
    await prefs.remove(_kPrefUser);
    await prefs.remove(_kPrefPass);
  }

  @override
  Widget build(BuildContext context) {
    if (_booting) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final api = _api;
    if (api == null) {
      return Scaffold(
        body: SafeArea(
          child: ConnectForm(
            initial: _savedUrl,
            initialUser: _hintUser ?? _savedUser,
            initialPass: _savedPass,
            mode: _authMode,
            onConnected: _onConnected,
          ),
        ),
      );
    }
    return Scaffold(
      body: SafeArea(
        child: IndexedStack(
          index: _index,
          children: [
            FormScreen(api: api, refreshSignal: _refreshTick),
            JournalScreen(api: api, refreshSignal: _refreshTick),
            MediaScreen(
              api: api,
              refreshSignal: _refreshTick,
              onOpenSettings: () => setState(() => _index = 3),
            ),
            SettingsScreen(
              api: api,
              onChangeServer: _forget,
              onSaved: () => _refreshTick.value++,
              saveTrigger: _saveTrigger,
              refreshSignal: _refreshTick,
              onCredentialsChanged: _setCredentials,
              onAppearanceChanged: widget.onAppearance,
            ),
          ],
        ),
      ),
      floatingActionButton: _index == 3
          ? FloatingActionButton(
              shape: const CircleBorder(),
              onPressed: () => _saveTrigger.value++,
              tooltip: 'Save settings',
              child: const Icon(Icons.save_outlined),
            )
          : FloatingActionButton(
              shape: const CircleBorder(),
              onPressed: () => _select(0),
              tooltip: 'Add entry',
              child: const Icon(Icons.add),
            ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      bottomNavigationBar: BottomAppBar(
        shape: const CircularNotchedRectangle(),
        notchMargin: 6,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _NavItem(
              icon: Icons.edit_note_outlined,
              label: 'Today',
              selected: _index == 0,
              onTap: () => _select(0),
            ),
            _NavItem(
              icon: Icons.book_outlined,
              label: 'Journal',
              selected: _index == 1,
              onTap: () => _select(1),
            ),
            const SizedBox(width: 48), // notch gap for the FAB
            _NavItem(
              icon: Icons.photo_library_outlined,
              label: 'Media',
              selected: _index == 2,
              onTap: () => _select(2),
            ),
            _NavItem(
              icon: Icons.settings_outlined,
              label: 'Settings',
              selected: _index == 3,
              onTap: () => _select(3),
            ),
          ],
        ),
      ),
    );
  }
}

/// One destination in the bottom bar.
class _NavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final color = selected ? cs.primary : cs.onSurface.withValues(alpha: 0.45);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(fontSize: 10, color: color)),
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
  final String? initialUser;
  final String? initialPass;

  /// Which credentials the server wants: 'setup' (first run) or 'password'.
  final String? mode;
  final void Function(String base, String? user, String? pass, List<String> roots)
      onConnected;
  const ConnectForm({
    super.key,
    required this.initial,
    required this.initialUser,
    required this.initialPass,
    required this.mode,
    required this.onConnected,
  });

  @override
  State<ConnectForm> createState() => _ConnectFormState();
}

class _ConnectFormState extends State<ConnectForm> {
  late final TextEditingController _ctrl =
      TextEditingController(text: widget.initial);
  late final TextEditingController _userCtrl =
      TextEditingController(text: widget.initialUser ?? 'admin');
  late final TextEditingController _passCtrl =
      TextEditingController(text: widget.initialPass ?? '');
  final _tzCtrl = TextEditingController();
  bool _saving = false;
  String? _error;

  bool get _wantsSetup => widget.mode == 'setup';
  bool get _wantsPassword =>
      _wantsSetup || widget.mode == 'password' || widget.mode == null;

  @override
  void dispose() {
    _userCtrl.dispose();
    _passCtrl.dispose();
    _tzCtrl.dispose();
    super.dispose();
  }

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
      _saving = true;
      _error = null;
    });
    try {
      var user = _userCtrl.text.trim();
      var pass = _passCtrl.text;
      if (_wantsSetup) {
        await Api(base).setup(pass, _tzCtrl.text.trim());
        user = 'admin';
      } else if (_wantsPassword) {
        await Api(base).verify(user, pass);
      }
      final roots = await Api(base, username: user, password: pass).config();
      if (!mounted) return;
      widget.onConnected(base, user, pass, roots);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
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
            style: TextStyle(
                color: Theme.of(context)
                    .colorScheme
                    .onSurface
                    .withValues(alpha: 0.6)),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _ctrl,
            keyboardType: TextInputType.url,
            autocorrect: false,
            enabled: !_saving,
            onSubmitted: (_) => _save(),
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'Server URL',
              hintText: 'http://192.168.1.147:12321',
            ),
          ),
          if (_wantsPassword) ...[
            const SizedBox(height: 12),
            if (!_wantsSetup)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextField(
                  controller: _userCtrl,
                  autocorrect: false,
                  enabled: !_saving,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'Username',
                  ),
                ),
              ),
            TextField(
              controller: _passCtrl,
              obscureText: true,
              enabled: !_saving,
              onSubmitted: (_) => _save(),
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                labelText: _wantsSetup
                    ? 'Create admin password (min 4 chars)'
                    : 'Password',
              ),
            ),
            if (_wantsSetup) ...[
              const SizedBox(height: 12),
              TimezoneField(
                controller: _tzCtrl,
                label: 'Timezone (optional, e.g. Europe/Helsinki)',
              ),
            ],
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          ],
          const SizedBox(height: 16),
          _saving
              ? const Center(child: CircularProgressIndicator())
              : FilledButton(
                  onPressed: _save,
                  child: Text(_wantsSetup ? 'Create admin & connect' : 'Connect')),
        ],
      ),
    );
  }
}

/// Media tab: media_cache rows grouped by capture day (parity with the old
/// media-view: newest day on top, day headers, thumbs from the scan).
class MediaScreen extends StatefulWidget {
  final Api api;
  final ValueListenable<int>? refreshSignal;
  final VoidCallback? onOpenSettings;
  const MediaScreen({
    super.key,
    required this.api,
    this.refreshSignal,
    this.onOpenSettings,
  });

  @override
  State<MediaScreen> createState() => _MediaScreenState();
}

class _MediaScreenState extends State<MediaScreen> {
  late Future<(List<MediaFile>, String)> _files;
  int _retries = 0;

  @override
  void initState() {
    super.initState();
    _files = widget.api.mediaFiles();
    widget.refreshSignal?.addListener(_reload);
  }

  @override
  void dispose() {
    widget.refreshSignal?.removeListener(_reload);
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() {
      _files = widget.api.mediaFiles();
    });
    final (files, folder) = await _files;
    // Server scans in the background: an empty library usually means the
    // scan is still running — retry a few times automatically.
    if (files.isEmpty && folder.isNotEmpty && _retries < 3 && mounted) {
      _retries++;
      await Future.delayed(const Duration(seconds: 2));
      if (mounted) _reload();
    } else if (files.isNotEmpty) {
      _retries = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _reload,
      child: FutureBuilder<(List<MediaFile>, String)>(
        future: _files,
        builder: (context, snap) {
          if (snap.hasError) {
            return ListView(children: [
              const SizedBox(height: 80),
              Center(child: Text('${snap.error}')),
            ]);
          }
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final (files, folder) = snap.data!;
          if (files.isEmpty) {
            final message = folder.isEmpty
                ? 'Media library folder is not configured'
                : 'No media found in $folder\n\nPull down to refresh — the server scans in the background';
            return ListView(
              children: [
                const SizedBox(height: 120),
                Center(
                  child: Column(
                    children: [
                      Text(message, textAlign: TextAlign.center),
                      if (folder.isEmpty) ...[
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: widget.onOpenSettings,
                          icon: const Icon(Icons.settings_outlined),
                          label: const Text('Open settings'),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            );
          }
        // group by day, keep API order (newest day first)
        final groups = <String, List<int>>{};
        for (var i = 0; i < files.length; i++) {
          (groups.putIfAbsent(files[i].date ?? 'Undated', () => [])).add(i);
        }
        return CustomScrollView(
          slivers: [
            for (final day in groups.keys)
              SliverMainAxisGroup(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      child: Text(
                        day,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withValues(alpha: 0.7),
                        ),
                      ),
                    ),
                  ),
                  SliverGrid.builder(
                    itemCount: groups[day]!.length,
                    gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 180,
                      mainAxisSpacing: 8,
                      crossAxisSpacing: 8,
                      childAspectRatio: 1,
                    ),
                    itemBuilder: (context, i) {
                      final idx = groups[day]![i];
                      final f = files[idx];
                      return InkWell(
                        onTap: () =>
                            Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => MediaViewerScreen(
                            api: widget.api,
                            files: files,
                            initialIndex: idx,
                          ),
                        )),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              if (f.isImage)
                                Image.network(
                                  f.hasThumb
                                      ? widget.api.thumbUrl(f.path)
                                      : widget.api.mediaUrl(f.path),
                                  fit: BoxFit.cover,
                                  // thumb missing/undecodable -> full image
                                  errorBuilder: (_, _, _) => Image.network(
                                      widget.api.mediaUrl(f.path),
                                      fit: BoxFit.cover),
                                )
                              else
                                ColoredBox(
                                  color: Theme.of(context)
                                      .colorScheme
                                      .surfaceContainerHighest,
                                  child: const Icon(Icons.movie_outlined,
                                      size: 40),
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
                                      fontSize: 11,
                                      shadows: [Shadow(blurRadius: 4)]),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ),
          ],
        );
      },
      ),
    );
  }
}

