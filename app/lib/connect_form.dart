import 'package:flutter/material.dart';

import 'api.dart';
import 'widgets/timezone_field.dart';

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

  /// Mirrors widget.mode; flips to 'setup' when a login attempt reveals the
  /// server has no admin yet.
  String? _mode;

  @override
  void initState() {
    super.initState();
    _mode = widget.mode;
  }

  bool get _wantsSetup => _mode == 'setup';
  bool get _wantsPassword =>
      _wantsSetup || _mode == 'password' || _mode == null;

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
        try {
          await Api(base).verify(user, pass);
        } catch (e) {
          // 401 might just mean the server has no admin yet — flip to setup
          if ('$e'.contains('Unauthorized') || '$e'.contains('401')) {
            final st = await Api(base).authStatus();
            if (st['needs_setup'] == true) {
              if (!mounted) return;
              setState(() {
                _mode = 'setup';
                _saving = false;
                _error = null;
              });
              return;
            }
          }
          rethrow;
        }
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
