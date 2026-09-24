Pod::Spec.new do |s|
  s.name           = 'LucidHealth'
  # Local module, no package.json to read a version from — see the note in
  # ../../lucid-watch-link/ios/LucidWatchLink.podspec.
  s.version        = '1.0.0'
  s.summary        = "Read-only HealthKit bridge: Apple's own sleep stages and heart rate."
  s.description    = <<-DESC
    Reads HKCategoryTypeIdentifier.sleepAnalysis and heart-rate samples for a date range, so the
    morning report can compare our own REM estimate against Apple's (DESIGN §5 / WO L2.9). Read
    only: the app never writes to HealthKit from the phone, which is why no
    NSHealthUpdateUsageDescription is needed for this module (the watch has its own, for the
    mindAndBody workout it saves).
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

  s.frameworks     = 'HealthKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
