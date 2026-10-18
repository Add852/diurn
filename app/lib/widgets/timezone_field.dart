import 'package:flutter/material.dart';

/// Curated common IANA zones; any value is accepted (server falls back to
/// UTC dates when a zone name is unknown).
const kTimezones = [
  'UTC', 'Europe/Helsinki', 'Europe/Stockholm', 'Europe/Berlin',
  'Europe/Paris', 'Europe/London', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Phoenix', 'America/Toronto',
  'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires', 'Asia/Tokyo', 'Asia/Seoul',
  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Bangkok',
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Jerusalem', 'Australia/Sydney',
  'Australia/Melbourne', 'Australia/Perth', 'Pacific/Auckland',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
];

/// Timezone autocomplete: type-to-filter over [kTimezones], free text allowed.
/// Owns its focus node; the controller is passed in so callers can read it.
class TimezoneField extends StatefulWidget {
  final TextEditingController controller;
  final String label;
  const TimezoneField({
    super.key,
    required this.controller,
    this.label = 'Timezone',
  });

  @override
  State<TimezoneField> createState() => _TimezoneFieldState();
}

class _TimezoneFieldState extends State<TimezoneField> {
  final FocusNode _focus = FocusNode();

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: RawAutocomplete<String>(
        textEditingController: widget.controller,
        focusNode: _focus,
        optionsBuilder: (TextEditingValue v) => kTimezones.where(
          (z) => z.toLowerCase().contains(v.text.toLowerCase()),
        ),
        fieldViewBuilder: (context, ctrl, focus, onSubmit) => TextFormField(
          controller: ctrl,
          focusNode: focus,
          onFieldSubmitted: (_) => onSubmit(),
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            labelText: widget.label,
            isDense: true,
          ),
        ),
        optionsViewBuilder: (context, onSelected, options) => Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            color: const Color(0xff27272a),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 240, maxWidth: 340),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final z in options)
                    ListTile(
                      dense: true,
                      title: Text(z, style: const TextStyle(fontSize: 13)),
                      onTap: () => onSelected(z),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
