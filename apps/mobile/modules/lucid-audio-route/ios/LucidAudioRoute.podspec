Pod::Spec.new do |s|
  s.name           = 'LucidAudioRoute'
  # Local module, no package.json to read a version from — see the note in
  # ../../lucid-watch-link/ios/LucidWatchLink.podspec.
  s.version        = '1.0.0'
  s.summary        = 'Which output the sound is coming out of, and an event when that changes.'
  s.description    = <<-DESC
    Reads `AVAudioSession.sharedInstance().currentRoute.outputs.first` (port type + user-visible
    name) and forwards `AVAudioSession.routeChangeNotification` to JavaScript, so
    `IosAudioPlayer.getStatus().route` stops being permanently nil and the devices screen can list
    the headphones that are actually connected (WO L3.9, R1 hotfix #1). expo-audio has no
    route API at all.
  DESC
  s.license        = 'MIT'
  s.author         = 'Dreaming'
  s.homepage       = 'https://github.com/suksomsri7/lucid-dreams'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/suksomsri7/lucid-dreams.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks     = 'AVFAudio'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
