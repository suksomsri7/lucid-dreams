Pod::Spec.new do |s|
  s.name           = 'LucidLiveActivity'
  # Local module, no package.json to read a version from — see the note in
  # ../../lucid-watch-link/ios/LucidWatchLink.podspec.
  s.version        = '1.0.0'
  s.summary        = "Starts, updates and ends the night's Live Activity (ActivityKit)."
  s.description    = <<-DESC
    The app half of the Live Activity. The lock-screen / Dynamic Island view itself is a
    separate binary (targets/live-activity, embedded by @bacons/apple-targets), which is why
    DreamingNightAttributes.swift is declared here as well as there — ActivityKit matches the
    two by the attributes type name, and Swift cannot share a type across a pod and an app
    extension without a shared framework target.
  DESC
  s.license        = 'MIT'
  s.author         = 'Dreaming'
  s.homepage       = 'https://github.com/suksomsri7/lucid-dreams'
  s.platforms      = {
    # ActivityKit's `ActivityConfiguration`/`Activity.request` need 16.2; 16.4 is what the Expo
    # SDK 57 modules themselves ask for, so this is not the binding constraint.
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/suksomsri7/lucid-dreams.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks     = 'ActivityKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
