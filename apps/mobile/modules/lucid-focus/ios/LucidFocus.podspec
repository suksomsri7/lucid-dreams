Pod::Spec.new do |s|
  s.name           = 'LucidFocus'
  # Local module, no package.json to read a version from — see the note in
  # ../../lucid-watch-link/ios/LucidWatchLink.podspec.
  s.version        = '1.0.0'
  s.summary        = 'Is the OS silencing us? Focus status + audio route facts for the pre-night check.'
  s.description    = <<-DESC
    Reads INFocusStatusCenter (Intents) and AVAudioSession so `readiness.ts`'s
    `dndAllowsAppAudio` input stops being a hard-coded `true`. Reports `known: false` when the
    Focus Status capability is absent or unauthorised, which is the shipped state today — the
    entitlement needs an Apple capability on the App ID and would otherwise break the first EAS
    build (reference_watch_target_entitlements).
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

  s.frameworks     = 'AVFAudio', 'Intents'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
