import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'connect_form.dart';
import 'form.dart';
import 'journal.dart';
import 'media_screen.dart';
import 'settings.dart';

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

  /// Today tab: the FAB becomes Write — triggers the form save.
  final ValueNotifier<int> _writeTrigger = ValueNotifier(0);

  /// Settings form has unsaved changes — ask before navigating away.
  final ValueNotifier<bool> _settingsDirty = ValueNotifier(false);

  @override
  void dispose() {
    _refreshTick.dispose();
    _saveTrigger.dispose();
    _writeTrigger.dispose();
    _settingsDirty.dispose();
    super.dispose();
  }

  /// Single navigation entry point: entering OR leaving Settings bumps the
  /// refresh signal — the tab always loads the last saved settings. Leaving
  /// with unsaved changes asks first (Save / Discard / Cancel).
  Future<void> _select(int i) async {
    if (_index == 3 && i != 3 && _settingsDirty.value && mounted) {
      final action = await showDialog<String>(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: const Text('Unsaved changes'),
          content: const Text(
              'Your settings have changes that were not saved yet. Save them '
              'before leaving?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, 'cancel'),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, 'discard'),
              child: const Text('Discard changes'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, 'save'),
              child: const Text('Save'),
            ),
          ],
        ),
      );
      if (!mounted || action == null) return; // cancel — stay on settings
      if (action == 'save') _saveTrigger.value++;
    }
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
            FormScreen(
              api: api,
              refreshSignal: _refreshTick,
              saveTrigger: _writeTrigger,
              onOpenSettings: () => setState(() => _index = 3),
            ),
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
              dirtyNotifier: _settingsDirty,
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
          : _index == 0
              ? FloatingActionButton(
                  shape: const CircleBorder(),
                  onPressed: () => _writeTrigger.value++,
                  tooltip: 'Write note',
                  child: const Icon(Icons.edit_note_outlined),
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
