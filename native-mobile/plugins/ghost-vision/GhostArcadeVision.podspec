Pod::Spec.new do |s|
  s.name = 'GhostArcadeVision'
  s.version = '0.1.0'
  s.summary = 'Native camera, depth, and segmentation capability bridge for Ghost Arcade mobile.'
  s.license = 'AGPL-3.0-only'
  s.homepage = 'https://ghostarcade.live'
  s.author = 'Risk Capital Media LLC'
  s.source = { :path => '.' }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.resources = 'ios/Sources/GhostArcadeVision/PrivacyInfo.xcprivacy'
  s.ios.deployment_target = '15.0'
  s.swift_version = '5.0'
  s.dependency 'Capacitor'
end
