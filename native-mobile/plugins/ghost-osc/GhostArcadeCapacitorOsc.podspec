Pod::Spec.new do |s|
  s.name = 'GhostArcadeCapacitorOsc'
  s.version = '0.1.0'
  s.summary = 'Native UDP OSC listener for Ghost Arcade mobile.'
  s.license = 'AGPL-3.0-only'
  s.homepage = 'https://ghostarcade.live'
  s.author = 'Risk Capital Media LLC'
  s.source = { :path => '.' }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.resources = 'ios/Sources/GhostArcadeOsc/PrivacyInfo.xcprivacy'
  s.ios.deployment_target = '14.0'
  s.swift_version = '5.0'
  s.dependency 'Capacitor'
end
