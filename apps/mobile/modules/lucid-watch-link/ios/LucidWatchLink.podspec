Pod::Spec.new do |s|
  s.name           = 'LucidWatchLink'
  # Local module: there is no package.json to read a version from (the folder is not an npm
  # package — `expo-modules-autolinking` finds it through `nativeModulesDir`), so the version
  # is a constant. Bump it only if CocoaPods ever needs to tell two copies apart.
  s.version        = '1.0.0'
  s.summary        = 'iPhone half of the Dreaming watch link: WCSession epochs + commands.'
  s.description    = <<-DESC
    Receives one 30 s epoch dictionary per 30 seconds from the watch app in targets/watch
    (sendMessage when reachable, transferUserInfo when it was not) and re-emits it to
    JavaScript. Also carries start/stop commands both ways and the phone's live status to the
    watch face. Everything it receives is treated as untrusted input and validated in
    JavaScript (APP-RUN §0.5 S8).
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

  # WatchConnectivity is a system framework; CocoaPods links it for the pod's targets.
  s.frameworks     = 'WatchConnectivity'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
