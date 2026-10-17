// Facade for the in-app video player.
// - Native (Android/iOS/desktop): media_kit (libmpv, no web backend)
// - Web: video_player (media_kit doesn't support web)
export 'video_file_native.dart' if (dart.library.js_interop) 'video_file_web.dart';
